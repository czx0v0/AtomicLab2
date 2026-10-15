from __future__ import annotations

import argparse
import csv
import json
import os
from datetime import datetime, timezone
from collections import defaultdict
from pathlib import Path
from typing import Any, Dict, List, Set
from uuid import uuid4

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
    "你是严苛的RAG评测裁判，采用 RAGAS 风格的多维评测。"
    "你将收到 question、ground_truth、answer、retrieved_contexts。\n"
    "请只输出一个 JSON 对象，不要输出任何额外文本。字段要求：\n"
    '- "correctness": 0 到 1 之间的小数。衡量 answer 相对 ground_truth 的事实正确性：'
    "1.0=完全正确且覆盖关键事实；0.6~0.8=部分正确但缺关键点或含小错；0=错误或答非所问。\n"
    '- "context_precision": 0 或 1。仅当 retrieved_contexts 对回答关键事实形成直接支持时给 1，否则给 0。\n'
    '- "context_recall": 0 到 1 之间的小数。衡量 ground_truth 的关键事实被 retrieved_contexts 覆盖的比例：'
    "1.0=关键事实全部被检索上下文覆盖；0=完全未覆盖。\n"
    '- "retrieval_hit": 0 或 1。仅当 retrieved_contexts 命中了 ground_truth 的核心事实（足以据此答对）时给 1，否则给 0。用于计算 Top-K 命中率。\n'
    '- "faithfulness": 0 到 1 之间的小数。衡量 answer 是否忠于 retrieved_contexts，不允许凭常识补全。\n'
    '- "hallucinated": 0 或 1。answer 中出现既不在 retrieved_contexts 又不在 ground_truth 里的具体断言（数字/结论/来源）时给 1，否则给 0。\n'
    '- "citation_accuracy": 0 到 1 之间的小数。answer 中的角标 [n] 指向的证据是否真正支持其所在句子的论断（无角标时按 1 处理）。\n'
    '- "reason": 简短中文理由（1-2句，说明 correctness 的得分/扣分点）。\n'
)

CSV_FIELDNAMES = [
    "index",
    "type",
    "question",
    "ground_truth",
    "answer",
    "correctness",
    "context_precision",
    "context_recall",
    "retrieval_hit",
    "faithfulness",
    "hallucinated",
    "citation_accuracy",
    "judge_reason",
    "retrieved_contexts_json",
    "agent_traces_json",
    "elapsed_ms",
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


def _effective_row_status(row: Dict[str, Any], has_status_column: bool) -> str:
    """有 status 列时以列为准（空视为 ok）；无列时根据 judge_reason 前缀推断执行失败行。"""
    if has_status_column:
        return _normalize_row_status(row.get("status"))
    reason = (row.get("judge_reason") or "").strip()
    if reason.startswith("执行失败:"):
        return "failed"
    return "ok"


def _load_completed_questions(csv_path: Path, count_failed_as_done: bool) -> Set[str]:
    """按题目在报告中的最后一行判定是否已完成：仅最终状态为 ok 视为成功。

    旧版 CSV 无 status 列时：judge_reason 以「执行失败:」开头的行视为 failed，其余视为 ok。
    count_failed_as_done 为 True 时，最后一行为 failed 也视为已完成。
    """
    if not csv_path.exists():
        return set()
    last_status_by_question: Dict[str, str] = {}
    with csv_path.open("r", encoding="utf-8", newline="") as f:
        reader = csv.DictReader(f)
        fieldnames = reader.fieldnames or []
        has_status_column = "status" in fieldnames
        for row in reader:
            q = (row.get("question") or "").strip()
            if not q:
                continue
            st = _effective_row_status(row, has_status_column)
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
    retrieval_mode: str = "full",
    rerank_mode: str = "none",
) -> Dict[str, Any]:
    payload = {
        "question": question,
        "top_k": top_k,
        "max_rounds": max_rounds,
        "retrieval_mode": retrieval_mode,
        "rerank_mode": rerank_mode,
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


def _synthesize_direct(question: str, contexts: List[Dict[str, Any]]) -> str:
    """进程内直连时的答案合成：严格基于检索资料，用 deepseek-chat 生成。"""
    api_key = os.getenv("DEEPSEEK_API_KEY", "").strip()
    if not api_key:
        return "（无 DEEPSEEK_API_KEY，跳过合成）"
    try:
        from openai import OpenAI

        client = OpenAI(
            api_key=api_key,
            base_url=os.getenv("DEEPSEEK_API_BASE", "https://api.deepseek.com"),
        )
        ctx = "\n\n".join(
            f"[{i+1}] {c.get('summary','')}" for i, c in enumerate(contexts[:12])
        ) or "（无检索资料）"
        prompt = (
            "你是学术问答助手。请严格依据下方【资料】回答【问题】，"
            "资料中没有的信息请明确说明未知，不要编造。\n\n"
            f"【资料】\n{ctx}\n\n【问题】{question}"
        )
        resp = client.chat.completions.create(
            model=os.getenv("DEEPSEEK_CHAT_MODEL", "deepseek-chat"),
            messages=[{"role": "user", "content": prompt}],
            temperature=0.2,
            max_tokens=1200,
        )
        return (resp.choices[0].message.content or "").strip()
    except Exception as e:
        return f"（合成失败: {type(e).__name__}）"


def _direct_chat(
    question: str,
    top_k: int,
    max_rounds: int,
    retrieval_mode: str,
    rerank_mode: str,
) -> Dict[str, Any]:
    """进程内直连后端检索管线 + 合成，不起 HTTP 服务。

    用于干净的检索选型/消融评测：直接调用 _search_pipeline，
    绕过 Router function-calling / 外部 arXiv / baseline_global_merge 噪声。
    """
    import sys as _sys

    repo_root = str(Path(__file__).resolve().parents[2])
    # 锚定 CWD：后端检索代码用 data/ 相对路径，必须从仓库根解析
    os.chdir(repo_root)
    eng = str(Path(repo_root) / "aether_engine")
    if eng not in _sys.path:
        _sys.path.insert(0, eng)
    from api.search import _search_pipeline

    result = _search_pipeline(
        query=question,
        top_k=max(3, top_k),
        max_rounds=max_rounds,
        session_id=None,
        retrieval_mode=retrieval_mode,
        rerank_mode=rerank_mode,
    )
    contexts = result.get("results") or []
    answer = _synthesize_direct(question, contexts)
    return {
        "answer": answer,
        "retrieved_contexts": contexts,
        "agent_traces": [],
        "elapsed_ms": -1,
    }


def _check_direct_kb(data_root: Path) -> None:
    """direct 模式建库预检：确认目标数据根下的向量库已建好，否则给出明确指引。"""
    chroma_db = data_root / "chroma_store" / "chroma.sqlite3"
    if chroma_db.exists():
        return
    raise SystemExit(
        f"\n[预检失败] 数据根 {data_root} 下没有向量库（缺 {chroma_db}）。\n"
        f"请先构建干净评测库：\n"
        f"  python scripts/build_eval_kb.py --type {data_root.name}\n"
        f"（或全部：python scripts/build_eval_kb.py）\n"
        f"再重跑评测，并让 --data-root 指向 data/eval_runtime/<type>。"
    )


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

    def _clamp(v: Any, lo: float = 0.0, hi: float = 1.0) -> float:
        try:
            return max(lo, min(hi, float(v)))
        except (TypeError, ValueError):
            return lo

    cp = 1 if int(parsed.get("context_precision", 0)) == 1 else 0
    hallu = 1 if int(parsed.get("hallucinated", 0)) == 1 else 0
    hit = 1 if int(parsed.get("retrieval_hit", 0)) == 1 else 0
    return {
        "correctness": _clamp(parsed.get("correctness", 0.0)),
        "context_precision": cp,
        "context_recall": _clamp(parsed.get("context_recall", 0.0)),
        "retrieval_hit": hit,
        "faithfulness": _clamp(parsed.get("faithfulness", 0.0)),
        "hallucinated": hallu,
        "citation_accuracy": _clamp(parsed.get("citation_accuracy", 1.0)),
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


def _default_jsonl_path(csv_report: Path) -> Path:
    if csv_report.suffix.lower() == ".csv":
        return csv_report.with_suffix(".jsonl")
    return csv_report.parent / (csv_report.name + ".jsonl")


def _append_jsonl(jsonl_path: Path, record: Dict[str, Any]) -> None:
    jsonl_path.parent.mkdir(parents=True, exist_ok=True)
    line = json.dumps(record, ensure_ascii=False) + "\n"
    with jsonl_path.open("a", encoding="utf-8") as f:
        f.write(line)


def _default_manifest_path(csv_report: Path) -> Path:
    return csv_report.parent / "experiments_manifest.jsonl"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _append_manifest_entry(manifest_path: Path, entry: Dict[str, Any]) -> None:
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    with manifest_path.open("a", encoding="utf-8") as f:
        f.write(json.dumps(entry, ensure_ascii=False) + "\n")


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

    def _f(row: Dict[str, str], key: str) -> float:
        raw = row.get(key)
        try:
            return float(raw)
        except (TypeError, ValueError):
            return 0.0

    buckets: Dict[str, Dict[str, float]] = defaultdict(
        lambda: {
            "count": 0,
            "correctness_sum": 0.0,
            "context_precision_sum": 0.0,
            "context_recall_sum": 0.0,
            "retrieval_hit_sum": 0.0,
            "faithfulness_sum": 0.0,
            "hallucinated_sum": 0.0,
        }
    )
    overall = {
        "count": 0,
        "correctness_sum": 0.0,
        "context_precision_sum": 0.0,
        "context_recall_sum": 0.0,
        "retrieval_hit_sum": 0.0,
        "faithfulness_sum": 0.0,
        "hallucinated_sum": 0.0,
    }

    for row in last_row_by_question.values():
        t = (row.get("type") or "unknown").strip()
        corr = _f(row, "correctness")
        cp = _f(row, "context_precision")
        recall = _f(row, "context_recall")
        hit = _f(row, "retrieval_hit")
        faith = _f(row, "faithfulness")
        hallu = _f(row, "hallucinated")
        b = buckets[t]
        b["count"] += 1
        b["correctness_sum"] += corr
        b["context_precision_sum"] += cp
        b["context_recall_sum"] += recall
        b["retrieval_hit_sum"] += hit
        b["faithfulness_sum"] += faith
        b["hallucinated_sum"] += hallu
        overall["count"] += 1
        overall["correctness_sum"] += corr
        overall["context_precision_sum"] += cp
        overall["context_recall_sum"] += recall
        overall["retrieval_hit_sum"] += hit
        overall["faithfulness_sum"] += faith
        overall["hallucinated_sum"] += hallu

    print("\n## Evaluation Summary")
    print("| type | n | correctness | hit@k | context_precision | context_recall | faithfulness | hallucination_rate |")
    print("|---|---:|---:|---:|---:|---:|---:|---:|")
    for t in sorted(buckets.keys()):
        b = buckets[t]
        n = int(b["count"]) or 1
        print(
            f"| {t} | {b['count']} | {b['correctness_sum']/n:.4f} | {b['retrieval_hit_sum']/n:.4f} | "
            f"{b['context_precision_sum']/n:.4f} | {b['context_recall_sum']/n:.4f} | "
            f"{b['faithfulness_sum']/n:.4f} | {b['hallucinated_sum']/n:.4f} |"
        )

    if overall["count"]:
        n_all = int(overall["count"])
        print(
            f"| overall | {n_all} | {overall['correctness_sum']/n_all:.4f} | "
            f"{overall['retrieval_hit_sum']/n_all:.4f} | "
            f"{overall['context_precision_sum']/n_all:.4f} | {overall['context_recall_sum']/n_all:.4f} | "
            f"{overall['faithfulness_sum']/n_all:.4f} | {overall['hallucinated_sum']/n_all:.4f} |"
        )


def main() -> None:
    _load_env_with_fallback()

    parser = argparse.ArgumentParser(description="工业级量化评测流水线（Qwen考生 + R1裁判）")
    parser.add_argument(
        "--dataset",
        default=str(Path(__file__).parent / "dataset.json"),
        help="评测数据集 JSON 路径",
    )
    parser.add_argument(
        "--type",
        default="",
        help="仅评测指定 type（如 single-hop / multi-hop / comparative / adversarial），空=全部",
    )
    parser.add_argument(
        "--report",
        default=str(Path(__file__).parent / "evaluation_report.csv"),
        help="评测结果 CSV 路径",
    )
    parser.add_argument("--chat-url", default="http://localhost:8000/api/chat", help="本地后端聊天接口")
    parser.add_argument(
        "--mode",
        choices=["http", "direct"],
        default="http",
        help="评测方式：http=打后端 /api/chat（测完整生产链路）；"
        "direct=进程内直接调用检索管线+合成，不起服务（干净检索选型/消融，绕开 Router 噪声）",
    )
    parser.add_argument(
        "--data-root",
        default="data",
        help="direct 模式的数据根目录（默认 data；干净评测指向 data/eval_runtime/<type>）",
    )
    parser.add_argument("--top-k", type=int, default=5, help="检索 top_k（真实透传，仅保底 3）")
    parser.add_argument("--max-rounds", type=int, default=2, help="后端工具迭代轮次")
    parser.add_argument(
        "--retrieval-mode",
        default="full",
        help="检索模式（评测/消融）：full / closed_book / bm25_only / vector_only / "
        "naive_hybrid / no_graph / no_expansion / doc_only / note_only",
    )
    parser.add_argument(
        "--rerank-mode",
        default="none",
        help="重排序（评测/消融）：none / cross_encoder / llm",
    )
    parser.add_argument(
        "--no-sys-instr",
        action="store_true",
        help="不向考生问题追加 SYSTEM_INSTRUCTION（评测自然忠实度时使用；closed_book 自动不追加）",
    )
    parser.add_argument(
        "--verbose",
        action="store_true",
        help="打印检索/合成详细 INFO 日志（direct 模式下可看到每轮通道统计）",
    )
    parser.add_argument(
        "--no-auto-metrics",
        action="store_true",
        help="评测结束后不自动生成 *.metrics.json / *.metrics.md（默认会自动生成）",
    )
    parser.add_argument(
        "--fresh",
        action="store_true",
        help="删除已有 report（csv/jsonl）后全新重跑，忽略断点续跑",
    )
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
    parser.add_argument(
        "--output-format",
        choices=["csv", "jsonl"],
        default="csv",
        help="csv 仅写 CSV；jsonl 仍写 CSV（断点续跑仅以 CSV 为准）并追加 JSON Lines 侧车，便于多行文本与结构化上下文",
    )
    parser.add_argument(
        "--jsonl-report",
        default="",
        help="JSONL 路径；仅在 --output-format jsonl 时生效，默认同目录下与 CSV 同名 .jsonl",
    )
    parser.add_argument("--run-name", default="baseline", help="实验名称标签（如 baseline、topk8_read180）")
    parser.add_argument("--manifest", default="", help="实验参数清单 JSONL 路径；默认与 report 同目录 experiments_manifest.jsonl")
    parser.add_argument("--limit", type=int, default=0, help="仅评测前 N 题（0 表示全部）")
    args = parser.parse_args()

    # 配置日志：--verbose 时打印检索/合成 INFO（direct 模式可见每轮通道统计），否则仅 WARNING+
    import logging

    logging.basicConfig(
        level=logging.INFO if args.verbose else logging.WARNING,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )
    logging.getLogger("aether").setLevel(logging.INFO if args.verbose else logging.WARNING)

    dataset_path = Path(args.dataset).resolve()
    report_path = Path(args.report).resolve()
    manifest_path = Path(args.manifest).resolve() if args.manifest.strip() else _default_manifest_path(report_path)
    run_id = uuid4().hex[:12]
    run_started_at = _now_iso()
    jsonl_path: Path | None = None
    if args.output_format == "jsonl":
        jsonl_path = (
            Path(args.jsonl_report.strip()).resolve()
            if args.jsonl_report.strip()
            else _default_jsonl_path(report_path)
        )

    # --fresh：删除已有 report + jsonl，强制全新重跑
    if args.fresh:
        for p in (report_path, jsonl_path):
            if p and p.exists():
                p.unlink()
                print(f"[fresh] 已删除旧结果: {p}")
        for p in (report_path.with_name(report_path.stem + ".metrics.json"),
                  report_path.with_name(report_path.stem + ".metrics.md")):
            if p.exists():
                p.unlink()
    rows = _load_dataset(dataset_path)
    # 按 type 过滤（single-hop / multi-hop / ...）
    if args.type.strip():
        rows = [r for r in rows if str(r.get("type", "")).strip() == args.type.strip()]
        if not rows:
            raise ValueError(f"数据集中无 type='{args.type}' 的题目")
    if args.limit and args.limit > 0:
        rows = rows[: args.limit]

    # direct 模式：切数据根目录（干净评测指向 data/eval_runtime/<type>）
    if args.mode == "direct":
        os.environ["DATA_DIR"] = args.data_root
        _check_direct_kb(Path(args.data_root))

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

        # 闭卷模式自动不加 SYSTEM_INSTRUCTION（无知识库可依）；--no-sys-instr 可强制任何模式不加
        append_sys_instr = not bool(args.no_sys_instr) and args.retrieval_mode != "closed_book"
        payload_question = question + SYSTEM_INSTRUCTION if append_sys_instr else question

        try:
            if args.mode == "direct":
                # 进程内直连：干净检索评测，不起后端
                chat_resp = _direct_chat(
                    question=question,
                    top_k=args.top_k,
                    max_rounds=args.max_rounds,
                    retrieval_mode=args.retrieval_mode,
                    rerank_mode=args.rerank_mode,
                )
            else:
                chat_resp = ask_local_backend(
                    api_url=args.chat_url,
                    question=payload_question,
                    top_k=args.top_k,
                    max_rounds=args.max_rounds,
                    timeout=chat_timeout,
                    max_retries=args.chat_retries,
                    retry_wait_max=args.chat_retry_wait_max,
                    retrieval_mode=args.retrieval_mode,
                    rerank_mode=args.rerank_mode,
                )
            answer = str(chat_resp.get("answer", "")).strip()
            retrieved_contexts = _normalize_contexts(chat_resp)
            agent_traces = chat_resp.get("agent_traces") or chat_resp.get("steps") or []
            elapsed_ms = chat_resp.get("elapsed_ms")
            try:
                elapsed_ms = int(elapsed_ms) if elapsed_ms is not None else -1
            except (TypeError, ValueError):
                elapsed_ms = -1

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
                "correctness": f"{judge['correctness']:.4f}",
                "context_precision": judge["context_precision"],
                "context_recall": f"{judge['context_recall']:.4f}",
                "retrieval_hit": judge["retrieval_hit"],
                "faithfulness": f"{judge['faithfulness']:.4f}",
                "hallucinated": judge["hallucinated"],
                "citation_accuracy": f"{judge['citation_accuracy']:.4f}",
                "judge_reason": judge["reason"],
                "retrieved_contexts_json": json.dumps(retrieved_contexts, ensure_ascii=False),
                "agent_traces_json": json.dumps(agent_traces, ensure_ascii=False),
                "elapsed_ms": elapsed_ms,
                "status": "ok",
                "error_type": "",
            }
            _append_result(report_path, row)
            if jsonl_path is not None:
                _append_jsonl(
                    jsonl_path,
                    {
                        "index": idx,
                        "type": q_type,
                        "question": question,
                        "ground_truth": ground_truth,
                        "answer": answer,
                        "correctness": judge["correctness"],
                        "context_precision": judge["context_precision"],
                        "context_recall": judge["context_recall"],
                        "retrieval_hit": judge["retrieval_hit"],
                        "faithfulness": judge["faithfulness"],
                        "hallucinated": judge["hallucinated"],
                        "citation_accuracy": judge["citation_accuracy"],
                        "judge_reason": judge["reason"],
                        "retrieved_contexts": retrieved_contexts,
                        "agent_traces": agent_traces,
                        "elapsed_ms": elapsed_ms,
                        "status": "ok",
                        "error_type": "",
                    },
                )
            completed.add(question)
            stats["ok"] += 1
            progress.set_postfix(
                corr=f"{judge['correctness']:.2f}",
                cp=judge["context_precision"],
                hallu=judge["hallucinated"],
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
                "correctness": f"{0.0:.4f}",
                "context_precision": 0,
                "context_recall": f"{0.0:.4f}",
                "retrieval_hit": 0,
                "faithfulness": f"{0.0:.4f}",
                "hallucinated": 0,
                "citation_accuracy": f"{0.0:.4f}",
                "judge_reason": f"执行失败: {err_type}: {exc}",
                "retrieved_contexts_json": "[]",
                "agent_traces_json": "[]",
                "elapsed_ms": -1,
                "status": "failed",
                "error_type": err_type,
            }
            _append_result(report_path, row)
            if jsonl_path is not None:
                _append_jsonl(
                    jsonl_path,
                    {
                        "index": idx,
                        "type": q_type,
                        "question": question,
                        "ground_truth": ground_truth,
                        "answer": "",
                        "correctness": 0.0,
                        "context_precision": 0,
                        "context_recall": 0.0,
                        "retrieval_hit": 0,
                        "faithfulness": 0.0,
                        "hallucinated": 0,
                        "citation_accuracy": 0.0,
                        "judge_reason": row["judge_reason"],
                        "retrieved_contexts": [],
                        "agent_traces": [],
                        "elapsed_ms": -1,
                        "status": "failed",
                        "error_type": err_type,
                    },
                )
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
    if jsonl_path is not None:
        print(f"JSONL 侧车已写入: {jsonl_path}")
    run_ended_at = _now_iso()
    manifest_entry = {
        "run_id": run_id,
        "run_name": args.run_name,
        "started_at": run_started_at,
        "ended_at": run_ended_at,
        "dataset_path": str(dataset_path),
        "report_path": str(report_path),
        "output_format": args.output_format,
        "jsonl_report_path": str(jsonl_path) if jsonl_path else "",
        "chat_url": args.chat_url,
        "mode": args.mode,
        "data_root": args.data_root if args.mode == "direct" else "",
        "type_filter": args.type,
        "top_k": args.top_k,
        "max_rounds": args.max_rounds,
        "retrieval_mode": args.retrieval_mode,
        "rerank_mode": args.rerank_mode,
        "no_sys_instr": bool(args.no_sys_instr),
        "judge_model": judge_model,
        "timeout": args.timeout,
        "connect_timeout": args.connect_timeout,
        "read_timeout": args.read_timeout,
        "write_timeout": args.write_timeout,
        "pool_timeout": args.pool_timeout,
        "chat_retries": args.chat_retries,
        "chat_retry_wait_max": args.chat_retry_wait_max,
        "start_index": args.start_index,
        "count_failed_as_done": bool(args.count_failed_as_done),
        "fail_fast": bool(args.fail_fast),
        "limit": args.limit,
        "stats": stats,
    }
    _append_manifest_entry(manifest_path, manifest_entry)
    print(f"实验参数清单已写入: {manifest_path}")

    # 自动生成指标文件（JSON + Markdown），放在 report 同目录；--no-auto-metrics 可关闭
    if not args.no_auto_metrics:
        try:
            import sys as _sys

            _eval_dir = str(Path(__file__).resolve().parent)
            if _eval_dir not in _sys.path:
                _sys.path.insert(0, _eval_dir)
            from compute_metrics import (
                compute_metrics,
                dedupe_records,
                load_records,
                render_markdown,
            )

            records = dedupe_records(load_records(report_path, "csv"), "latest")
            m = compute_metrics(records)
            metrics_json = report_path.with_name(report_path.stem + ".metrics.json")
            metrics_md = report_path.with_name(report_path.stem + ".metrics.md")
            metrics_json.write_text(
                json.dumps(
                    {"source": str(report_path), "dedupe": "latest", "metrics": m},
                    ensure_ascii=False,
                    indent=2,
                ),
                encoding="utf-8",
            )
            metrics_md.write_text(render_markdown(m, report_path, "latest"), encoding="utf-8")
            print(f"\n指标 JSON 已写入: {metrics_json}")
            print(f"指标 Markdown 已写入: {metrics_md}")
        except Exception as e:
            print(f"\n[警告] 自动生成指标文件失败（可手动跑 compute_metrics.py）: {e}")


if __name__ == "__main__":
    main()

