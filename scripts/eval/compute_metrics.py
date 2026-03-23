from __future__ import annotations

import argparse
import csv
import json
import re
from collections import defaultdict
from pathlib import Path
from typing import Any, Dict, Iterable, List


def _normalize_text(s: str) -> str:
    # 保留中英文与数字，去除空白和标点，便于稳健 EM/F1。
    return "".join(re.findall(r"[A-Za-z0-9\u4e00-\u9fff]+", (s or "").lower()))


def _char_tokens(s: str) -> List[str]:
    return list(_normalize_text(s))


def exact_match(answer: str, ground_truth: str) -> float:
    return 1.0 if _normalize_text(answer) == _normalize_text(ground_truth) else 0.0


def token_f1(answer: str, ground_truth: str) -> float:
    a = _char_tokens(answer)
    g = _char_tokens(ground_truth)
    if not a and not g:
        return 1.0
    if not a or not g:
        return 0.0
    from collections import Counter

    ac = Counter(a)
    gc = Counter(g)
    overlap = sum(min(ac[k], gc[k]) for k in ac.keys() & gc.keys())
    if overlap == 0:
        return 0.0
    precision = overlap / len(a)
    recall = overlap / len(g)
    return 2 * precision * recall / (precision + recall)


def _to_float(v: Any, default: float = 0.0) -> float:
    try:
        return float(v)
    except Exception:
        return default


def _load_csv(path: Path) -> List[Dict[str, Any]]:
    rows: List[Dict[str, Any]] = []
    with path.open("r", encoding="utf-8", newline="") as f:
        reader = csv.DictReader(f)
        for row in reader:
            rows.append({k: (v if v is not None else "") for k, v in row.items()})
    return rows


def _load_jsonl(path: Path) -> List[Dict[str, Any]]:
    rows: List[Dict[str, Any]] = []
    with path.open("r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            rows.append(json.loads(line))
    return rows


def load_records(path: Path, input_format: str) -> List[Dict[str, Any]]:
    fmt = input_format
    if fmt == "auto":
        fmt = "jsonl" if path.suffix.lower() == ".jsonl" else "csv"
    if fmt == "csv":
        return _load_csv(path)
    if fmt == "jsonl":
        return _load_jsonl(path)
    raise ValueError(f"不支持的输入格式: {input_format}")


def dedupe_records(records: List[Dict[str, Any]], mode: str) -> List[Dict[str, Any]]:
    if mode == "none":
        return records
    if mode != "latest":
        raise ValueError(f"不支持的去重模式: {mode}")
    latest: Dict[str, Dict[str, Any]] = {}
    for row in records:
        q = str(row.get("question", "")).strip()
        if not q:
            continue
        latest[q] = row
    return list(latest.values())


def _status_ok(row: Dict[str, Any]) -> bool:
    status = str(row.get("status", "")).strip().lower()
    if status:
        return status == "ok"
    reason = str(row.get("judge_reason", "")).strip()
    return not reason.startswith("执行失败:")


def compute_metrics(records: List[Dict[str, Any]]) -> Dict[str, Any]:
    buckets: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
    for r in records:
        t = str(r.get("type", "unknown")).strip() or "unknown"
        buckets[t].append(r)

    def _calc(rows: Iterable[Dict[str, Any]]) -> Dict[str, float]:
        rows = list(rows)
        n = len(rows)
        if n == 0:
            return {
                "n": 0,
                "accuracy_cp_pct": 0.0,
                "faithfulness_avg_pct": 0.0,
                "success_rate_pct": 0.0,
                "em_pct": 0.0,
                "token_f1_pct": 0.0,
            }
        cp = [1.0 if int(_to_float(r.get("context_precision"), 0.0)) == 1 else 0.0 for r in rows]
        faith = [_to_float(r.get("faithfulness"), 0.0) for r in rows]
        succ = [1.0 if _status_ok(r) else 0.0 for r in rows]
        em = [exact_match(str(r.get("answer", "")), str(r.get("ground_truth", ""))) for r in rows]
        f1 = [token_f1(str(r.get("answer", "")), str(r.get("ground_truth", ""))) for r in rows]
        return {
            "n": n,
            "accuracy_cp_pct": round(sum(cp) / n * 100.0, 2),
            "faithfulness_avg_pct": round(sum(faith) / n * 100.0, 2),
            "success_rate_pct": round(sum(succ) / n * 100.0, 2),
            "em_pct": round(sum(em) / n * 100.0, 2),
            "token_f1_pct": round(sum(f1) / n * 100.0, 2),
        }

    by_type = {t: _calc(rows) for t, rows in sorted(buckets.items(), key=lambda x: x[0])}
    overall = _calc(records)
    return {"overall": overall, "by_type": by_type}


def _resolve_report_from_manifest(manifest_path: Path, run_name: str, run_id: str) -> Path:
    if not manifest_path.exists():
        raise FileNotFoundError(f"manifest 不存在: {manifest_path}")
    chosen: Dict[str, Any] | None = None
    with manifest_path.open("r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            entry = json.loads(line)
            if run_id and str(entry.get("run_id", "")).strip() != run_id:
                continue
            if run_name and str(entry.get("run_name", "")).strip() != run_name:
                continue
            chosen = entry
    if chosen is None:
        raise ValueError("manifest 中未找到匹配 run_name/run_id 的记录")
    report_path = str(chosen.get("report_path", "")).strip()
    if not report_path:
        raise ValueError("manifest 记录缺少 report_path")
    return Path(report_path).resolve()


def render_markdown(metrics: Dict[str, Any], source_path: Path, dedupe: str) -> str:
    lines = [
        "# Evaluation Metrics",
        "",
        f"- source: `{source_path}`",
        f"- dedupe: `{dedupe}`",
        "",
        "## Overall",
        "",
        "| metric | value |",
        "|---|---:|",
    ]
    ov = metrics["overall"]
    lines.extend(
        [
            f"| n | {ov['n']} |",
            f"| accuracy_cp_pct | {ov['accuracy_cp_pct']:.2f} |",
            f"| faithfulness_avg_pct | {ov['faithfulness_avg_pct']:.2f} |",
            f"| success_rate_pct | {ov['success_rate_pct']:.2f} |",
            f"| em_pct | {ov['em_pct']:.2f} |",
            f"| token_f1_pct | {ov['token_f1_pct']:.2f} |",
            "",
            "## By Type",
            "",
            "| type | n | accuracy_cp_pct | faithfulness_avg_pct | success_rate_pct | em_pct | token_f1_pct |",
            "|---|---:|---:|---:|---:|---:|---:|",
        ]
    )
    for t, m in metrics["by_type"].items():
        lines.append(
            f"| {t} | {m['n']} | {m['accuracy_cp_pct']:.2f} | {m['faithfulness_avg_pct']:.2f} | "
            f"{m['success_rate_pct']:.2f} | {m['em_pct']:.2f} | {m['token_f1_pct']:.2f} |"
        )
    lines.append("")
    return "\n".join(lines)


def main() -> None:
    parser = argparse.ArgumentParser(description="根据评测结果生成量化指标与报告")
    parser.add_argument("--report", default="", help="评测结果文件路径（csv 或 jsonl）")
    parser.add_argument("--manifest", default="", help="实验 manifest 路径（可结合 --run-name/--run-id 自动定位 report）")
    parser.add_argument("--run-name", default="", help="实验名过滤（manifest 模式）")
    parser.add_argument("--run-id", default="", help="实验 run_id 过滤（manifest 模式）")
    parser.add_argument("--input-format", choices=["auto", "csv", "jsonl"], default="auto", help="输入格式")
    parser.add_argument("--dedupe", choices=["latest", "none"], default="latest", help="是否按 question 去重")
    parser.add_argument("--out-md", default="", help="输出 Markdown 报告路径")
    parser.add_argument("--out-json", default="", help="输出 JSON 指标路径")
    args = parser.parse_args()

    report_path: Path
    if args.report:
        report_path = Path(args.report).resolve()
    elif args.manifest:
        report_path = _resolve_report_from_manifest(
            manifest_path=Path(args.manifest).resolve(),
            run_name=args.run_name,
            run_id=args.run_id,
        )
    else:
        raise ValueError("必须至少提供 --report 或 --manifest")

    records = load_records(report_path, args.input_format)
    records = dedupe_records(records, args.dedupe)
    metrics = compute_metrics(records)
    payload = {
        "source": str(report_path),
        "dedupe": args.dedupe,
        "metrics": metrics,
    }

    print(json.dumps(payload, ensure_ascii=False, indent=2))

    if args.out_json:
        out_json = Path(args.out_json).resolve()
        out_json.parent.mkdir(parents=True, exist_ok=True)
        out_json.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"指标 JSON 已写入: {out_json}")

    if args.out_md:
        out_md = Path(args.out_md).resolve()
        out_md.parent.mkdir(parents=True, exist_ok=True)
        out_md.write_text(render_markdown(metrics, report_path, args.dedupe), encoding="utf-8")
        print(f"指标 Markdown 已写入: {out_md}")


if __name__ == "__main__":
    main()

