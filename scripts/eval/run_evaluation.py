from __future__ import annotations

import argparse
import csv
import json
import os
from collections import defaultdict
from pathlib import Path
from typing import Any, Dict, List, Set

import httpx
from openai import OpenAI
from dotenv import load_dotenv
from tenacity import retry, stop_after_attempt, wait_exponential
from tqdm import tqdm

SYSTEM_INSTRUCTION = (
    "\n\n[评测系统指令：请严格且仅根据检索到的本地知识库内容回答。"
    "如果知识库中没有相关信息，请直接回复'文献未提及'，绝对禁止使用通用常识编造。]"
)

JUDGE_SYSTEM_PROMPT = (
    "你是严苛的RAG评测裁判。你将收到 question、ground_truth、answer、retrieved_contexts。\n"
    "请只输出一个 JSON 对象，不要输出任何额外文本。\n"
    "字段要求：\n"
    '- "context_precision": 0 或 1。仅当 retrieved_contexts 对回答关键事实形成直接支持时给 1，否则给 0。\n'
    '- "faithfulness": 0 到 1 之间的小数。衡量 answer 是否忠于 retrieved_contexts，不允许凭常识补全。\n'
    '- "reason": 简短中文理由（1-2句）。\n'
)

CSV_FIELDNAMES = [
    "index",
    "type",
    "question",
    "ground_truth",
    "answer",
    "context_precision",
    "faithfulness",
    "judge_reason",
    "retrieved_contexts_json",
    "status",
    "error_type",
]


def _load_env_with_fallback() -> None:
    here = Path(__file__).resolve()
    # scripts/eval/run_evaluation.py -> modelspace-deploy
    modelspace_root = here.parents[2]
    repo_root = modelspace_root.parent
    candidates = [modelspace_root / ".env", repo_root / ".env"]
    for env_path in candidates:
        if env_path.exists():
            load_dotenv(env_path, override=False)
            print(f"[eval] 已加载环境变量文件: {env_path}")
            return
    print("[eval] 未找到 .env，将仅使用当前进程环境变量")


def _load_dataset(path: Path) -> List[Dict[str, Any]]:
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, list):
        raise ValueError(f"数据集格式错误，期望 list: {path}")
    return data


def _normalize_row_status(raw: str | None) -> str:
    s = (raw or "").strip().lower()
    if not s:
        return "ok"
    return s


def _load_completed_questions(csv_path: Path, count_failed_as_done: bool) -> Set[str]:
    """按题目在报告中的最后一行判定是否已完成：仅 status=ok 视为成功（旧 CSV 无 status 列视为 ok）。

    count_failed_as_done 为 True 时，最后一行为 failed 也视为已完成（兼容旧「任意一行即跳过」语义）。
    """
    if not csv_path.exists():
        return set()
    last_status_by_question: Dict[str, str] = {}
    with csv_path.open("r", encoding="utf-8", newline="") as f:
        reader = csv.DictReader(f)
        for row in reader:
            q = (row.get("question") or "").strip()
            if not q:
                continue
            st = _normalize_row_status(row.get("status"))
            last_status_by_question[q] = st

    done: Set[str] = set()
    for q, st in last_status_by_question.items():
        if st == "ok":
            done.add(q)
        elif count_failed_as_done and st == "failed":
            done.add(q)
    return done


def _ensure_csv_header(csv_path: Path) -> None:
    if csv_path.exists() and csv_path.stat().st_size > 0:
        return
    csv_path.parent.mkdir(parents=True, exist_ok=True)
    with csv_path.open("w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=CSV_FIELDNAMES)
        writer.writeheader()


def ask_local_backend(
    api_url: str,
    question: str,
    top_k: int,
    max_rounds: int,
    timeout: httpx.Timeout,
    max_retries: int,
    retry_wait_max: int,
) -> Dict[str, Any]:
    payload = {
        "question": question + SYSTEM_INSTRUCTION,
        "top_k": top_k,
        "max_rounds": max_rounds,
    }
    attempts = max(1, int(max_retries))
    wait_max = max(1, int(retry_wait_max))
    last_exc: Exception | None = None
    for i in range(attempts):
        try:
            with httpx.Client(timeout=timeout) as client:
                resp = client.post(api_url, json=payload)
                resp.raise_for_status()
                return resp.json()
        except (httpx.HTTPError, ValueError) as exc:
            last_exc = exc
            if i >= attempts - 1:
                break
            sleep_secs = min(2**i, wait_max)
            tqdm.write(f"[warn] 请求失败，将在 {sleep_secs}s 后重试: {type(exc).__name__}: {exc}")
            import time

            time.sleep(sleep_secs)
    assert last_exc is not None
    raise last_exc


@retry(wait=wait_exponential(multiplier=1, min=1, max=10), stop=stop_after_attempt(3), reraise=True)
def judge_with_r1(
    client: OpenAI,
    model: str,
    question: str,
    ground_truth: str,
    answer: str,
    retrieved_contexts: List[Dict[str, Any]],
) -> Dict[str, Any]:
    user_payload = {
        "question": question,
        "ground_truth": ground_truth,
        "answer": answer,
        "retrieved_contexts": retrieved_contexts,
    }
    resp = client.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": JUDGE_SYSTEM_PROMPT},
            {"role": "user", "content": json.dumps(user_payload, ensure_ascii=False)},
        ],
        temperature=0,
        response_format={"type": "json_object"},
    )
    content = (resp.choices[0].message.content or "").strip()
    parsed = json.loads(content)
    cp = int(parsed.get("context_precision", 0))
    faith = float(parsed.get("faithfulness", 0.0))
    cp = 1 if cp == 1 else 0
    faith = max(0.0, min(1.0, faith))
    return {
        "context_precision": cp,
        "faithfulness": faith,
        "reason": str(parsed.get("reason", "")).strip(),
    }


def _normalize_contexts(chat_resp: Dict[str, Any]) -> List[Dict[str, Any]]:
    contexts = chat_resp.get("retrieved_contexts")
    if isinstance(contexts, list):
        return contexts
    sources = chat_resp.get("sources")
    if isinstance(sources, list):
        return sources
    return []


def _append_result(csv_path: Path, row: Dict[str, Any]) -> None:
    with csv_path.open("a", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=CSV_FIELDNAMES)
        writer.writerow(row)


def _print_markdown_summary(csv_path: Path) -> None:
    """按 question 去重：同一题多行时仅以文件顺序最后一行计入汇总，避免重复拉偏平均分。"""
    last_row_by_question: Dict[str, Dict[str, str]] = {}
    with csv_path.open("r", encoding="utf-8", newline="") as f:
        reader = csv.DictReader(f)
        for row in reader:
            q = (row.get("question") or "").strip()
            if not q:
                continue
            last_row_by_question[q] = {k: (v if v is not None else "") for k, v in row.items()}

    buckets: Dict[str, Dict[str, float]] = defaultdict(
        lambda: {"count": 0, "context_precision_sum": 0.0, "faithfulness_sum": 0.0}
    )
    overall = {"count": 0, "context_precision_sum": 0.0, "faithfulness_sum": 0.0}

    for row in last_row_by_question.values():
        t = (row.get("type") or "unknown").strip()
        cp = float(row.get("context_precision") or 0.0)
        faith = float(row.get("faithfulness") or 0.0)
        buckets[t]["count"] += 1
        buckets[t]["context_precision_sum"] += cp
        buckets[t]["faithfulness_sum"] += faith
        overall["count"] += 1
        overall["context_precision_sum"] += cp
        overall["faithfulness_sum"] += faith

    print("\n## Evaluation Summary")
    print("| type | n | context_precision_avg | faithfulness_avg |")
    print("|---|---:|---:|---:|")
    for t in sorted(buckets.keys()):
        n = int(buckets[t]["count"])
        cp_avg = buckets[t]["context_precision_sum"] / n if n else 0.0
        f_avg = buckets[t]["faithfulness_sum"] / n if n else 0.0
        print(f"| {t} | {n} | {cp_avg:.4f} | {f_avg:.4f} |")

    if overall["count"]:
        n_all = int(overall["count"])
        cp_all = overall["context_precision_sum"] / n_all
        f_all = overall["faithfulness_sum"] / n_all
        print(f"| overall | {n_all} | {cp_all:.4f} | {f_all:.4f} |")


def main() -> None:
    _load_env_with_fallback()

    parser = argparse.ArgumentParser(description="工业级量化评测流水线（Qwen考生 + R1裁判）")
    parser.add_argument(
        "--dataset",
        default=str(Path(__file__).parent / "dataset.json"),
        help="评测数据集 JSON 路径",
    )
    parser.add_argument(
        "--report",
        default=str(Path(__file__).parent / "evaluation_report.csv"),
        help="评测结果 CSV 路径",
    )
    parser.add_argument("--chat-url", default="http://localhost:8000/api/chat", help="本地后端聊天接口")
    parser.add_argument("--top-k", type=int, default=5, help="检索 top_k")
    parser.add_argument("--max-rounds", type=int, default=2, help="后端工具迭代轮次")
    parser.add_argument("--timeout", type=float, default=60.0, help="兼容入口：HTTP 连接/读超时默认秒数")
    parser.add_argument("--connect-timeout", type=float, default=0.0, help="HTTP 连接超时（秒，0 表示继承 --timeout）")
    parser.add_argument("--read-timeout", type=float, default=0.0, help="HTTP 读取超时（秒，0 表示继承 --timeout）")
    parser.add_argument("--write-timeout", type=float, default=0.0, help="HTTP 写入超时（秒，0 表示继承 --timeout）")
    parser.add_argument("--pool-timeout", type=float, default=0.0, help="HTTP 连接池超时（秒，0 表示继承 --timeout）")
    parser.add_argument("--chat-retries", type=int, default=3, help="后端问答请求最大重试次数（至少 1）")
    parser.add_argument("--chat-retry-wait-max", type=int, default=10, help="后端问答重试最大退避秒数")
    parser.add_argument("--start-index", type=int, default=1, help="从第几题开始评测（1-based）")
    parser.add_argument("--fail-fast", action="store_true", help="遇到单题失败即终止（默认失败后继续）")
    parser.add_argument(
        "--count-failed-as-done",
        action="store_true",
        help="将报告中最后一行为 failed 的题目也视为已完成并跳过（默认仅 ok 视为完成，失败可重试）",
    )
    parser.add_argument("--limit", type=int, default=0, help="仅评测前 N 题（0 表示全部）")
    args = parser.parse_args()

    dataset_path = Path(args.dataset).resolve()
    report_path = Path(args.report).resolve()
    rows = _load_dataset(dataset_path)
    if args.limit and args.limit > 0:
        rows = rows[: args.limit]

    deepseek_api_key = os.getenv("DEEPSEEK_API_KEY", "").strip()
    if not deepseek_api_key:
        raise RuntimeError("缺少 DEEPSEEK_API_KEY，无法调用 deepseek-reasoner 进行裁判打分。")

    judge_client = OpenAI(api_key=deepseek_api_key, base_url="https://api.deepseek.com/v1")
    judge_model = "deepseek-reasoner"

    _ensure_csv_header(report_path)
    completed = _load_completed_questions(report_path, count_failed_as_done=bool(args.count_failed_as_done))
    timeout_base = max(0.1, float(args.timeout))
    connect_timeout = args.connect_timeout if args.connect_timeout > 0 else timeout_base
    read_timeout = args.read_timeout if args.read_timeout > 0 else timeout_base
    write_timeout = args.write_timeout if args.write_timeout > 0 else timeout_base
    pool_timeout = args.pool_timeout if args.pool_timeout > 0 else timeout_base
    chat_timeout = httpx.Timeout(
        connect=connect_timeout,
        read=read_timeout,
        write=write_timeout,
        pool=pool_timeout,
    )
    start_index = max(1, int(args.start_index))
    stats = {"ok": 0, "failed": 0, "skip_done": 0, "skip_before_start": 0}

    progress = tqdm(rows, desc="Evaluating", unit="q")
    for idx, item in enumerate(progress, start=1):
        if idx < start_index:
            stats["skip_before_start"] += 1
            progress.set_postfix_str("skip=before_start")
            continue

        question = str(item.get("question", "")).strip()
        ground_truth = str(item.get("ground_truth", "")).strip()
        q_type = str(item.get("type", "unknown")).strip()

        if not question:
            continue
        if question in completed:
            stats["skip_done"] += 1
            progress.set_postfix_str("skip=done")
            continue

        try:
            chat_resp = ask_local_backend(
                api_url=args.chat_url,
                question=question,
                top_k=args.top_k,
                max_rounds=args.max_rounds,
                timeout=chat_timeout,
                max_retries=args.chat_retries,
                retry_wait_max=args.chat_retry_wait_max,
            )
            answer = str(chat_resp.get("answer", "")).strip()
            retrieved_contexts = _normalize_contexts(chat_resp)

            judge = judge_with_r1(
                client=judge_client,
                model=judge_model,
                question=question,
                ground_truth=ground_truth,
                answer=answer,
                retrieved_contexts=retrieved_contexts,
            )
            row = {
                "index": idx,
                "type": q_type,
                "question": question,
                "ground_truth": ground_truth,
                "answer": answer,
                "context_precision": judge["context_precision"],
                "faithfulness": f"{judge['faithfulness']:.4f}",
                "judge_reason": judge["reason"],
                "retrieved_contexts_json": json.dumps(retrieved_contexts, ensure_ascii=False),
                "status": "ok",
                "error_type": "",
            }
            _append_result(report_path, row)
            completed.add(question)
            stats["ok"] += 1
            progress.set_postfix(
                cp=judge["context_precision"],
                faith=f"{judge['faithfulness']:.2f}",
                failed=stats["failed"],
            )
        except Exception as exc:
            stats["failed"] += 1
            err_type = type(exc).__name__
            row = {
                "index": idx,
                "type": q_type,
                "question": question,
                "ground_truth": ground_truth,
                "answer": "",
                "context_precision": 0,
                "faithfulness": f"{0.0:.4f}",
                "judge_reason": f"执行失败: {err_type}: {exc}",
                "retrieved_contexts_json": "[]",
                "status": "failed",
                "error_type": err_type,
            }
            _append_result(report_path, row)
            if args.count_failed_as_done:
                completed.add(question)
            progress.set_postfix_str(f"failed={stats['failed']}, last={err_type}")
            if args.fail_fast:
                raise

    _print_markdown_summary(report_path)
    print(
        f"\n执行统计: ok={stats['ok']}, failed={stats['failed']}, "
        f"skip_done={stats['skip_done']}, skip_before_start={stats['skip_before_start']}"
    )
    print(f"\n报告已写入: {report_path}")


if __name__ == "__main__":
    main()

