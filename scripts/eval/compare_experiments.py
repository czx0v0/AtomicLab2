"""
多实验对比脚本：从 experiments_manifest.jsonl 聚合多次实验，产出对比表与分类型明细，
并对主指标（correctness / hit@k）给出 bootstrap 95% 置信区间，支撑"选型/消融是否显著"的判断。

用法：
    python compare_experiments.py --manifest experiments_manifest.jsonl \
        --out-md comparison.md --out-csv comparison.csv

可选：
    --run-names b0,b1,b3,b4    仅对比指定 run_name
    --baseline b2_vector       指定基线 run_name，自动计算相对提升（Δcorrectness / Δhit@k 等）
    --ci-iters 1000            bootstrap 重采样次数
"""

from __future__ import annotations

import argparse
import csv
import json
import random
from pathlib import Path
from typing import Any, Dict, List, Tuple

from compute_metrics import (
    compute_metrics,
    dedupe_records,
    load_records,
    rouge_l,
)

MAIN_METRICS = [
    "correctness_pct",
    "hit_at_k_pct",
    "context_precision_pct",
    "context_recall_pct",
    "faithfulness_avg_pct",
    "hallucination_rate_pct",
    "citation_accuracy_pct",
    "rouge_l_pct",
    "token_f1_pct",
    "success_rate_pct",
]


def _to_float(v: Any, default: float = 0.0) -> float:
    try:
        return float(v)
    except (TypeError, ValueError):
        return default


def load_manifest(path: Path) -> List[Dict[str, Any]]:
    items: List[Dict[str, Any]] = []
    if not path.exists():
        raise FileNotFoundError(f"manifest 不存在: {path}")
    with path.open("r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            items.append(json.loads(line))
    return items


def _per_question_values(records: List[Dict[str, Any]]) -> Dict[str, List[float]]:
    """从去重后的记录中提取每题标量，供 bootstrap 与分类型聚合。"""
    out: Dict[str, List[float]] = {
        "correctness": [],
        "retrieval_hit": [],
        "context_precision": [],
        "context_recall": [],
        "faithfulness": [],
        "hallucinated": [],
        "citation_accuracy": [],
        "rouge_l": [],
    }
    for r in records:
        out["correctness"].append(_to_float(r.get("correctness"), 0.0))
        out["retrieval_hit"].append(1.0 if int(_to_float(r.get("retrieval_hit"), 0.0)) == 1 else 0.0)
        out["context_precision"].append(1.0 if int(_to_float(r.get("context_precision"), 0.0)) == 1 else 0.0)
        out["context_recall"].append(_to_float(r.get("context_recall"), 0.0))
        out["faithfulness"].append(_to_float(r.get("faithfulness"), 0.0))
        out["hallucinated"].append(1.0 if int(_to_float(r.get("hallucinated"), 0.0)) == 1 else 0.0)
        out["citation_accuracy"].append(_to_float(r.get("citation_accuracy"), 1.0))
        out["rouge_l"].append(rouge_l(str(r.get("answer", "")), str(r.get("ground_truth", ""))))
    return out


def _bootstrap_ci(values: List[float], iters: int = 1000, seed: int = 42, alpha: float = 0.05) -> Tuple[float, float]:
    """对均值做 bootstrap 分位区间。返回 (lower, upper)。"""
    if not values:
        return (0.0, 0.0)
    rng = random.Random(seed)
    n = len(values)
    means: List[float] = []
    for _ in range(iters):
        sample = [values[rng.randrange(n)] for _ in range(n)]
        means.append(sum(sample) / n)
    means.sort()
    lo = means[int(alpha / 2 * iters)]
    hi = means[int((1 - alpha / 2) * iters)]
    return (lo, hi)


def _mean_pct(values: List[float]) -> float:
    if not values:
        return 0.0
    return sum(values) / len(values) * 100.0


def _run_summary(entry: Dict[str, Any]) -> Dict[str, Any]:
    report_path = Path(str(entry.get("report_path", "")))
    if not str(report_path) or not report_path.exists():
        raise FileNotFoundError(f"report 不存在: {report_path}")
    records = dedupe_records(load_records(report_path, "auto"), "latest")
    pq = _per_question_values(records)
    corr_ci = _bootstrap_ci(pq["correctness"], iters=1000)
    hit_ci = _bootstrap_ci(pq["retrieval_hit"], iters=1000)
    return {
        "run_name": str(entry.get("run_name", "")),
        "run_id": str(entry.get("run_id", "")),
        "retrieval_mode": str(entry.get("retrieval_mode", "") or "full"),
        "rerank_mode": str(entry.get("rerank_mode", "") or "none"),
        "top_k": entry.get("top_k"),
        "max_rounds": entry.get("max_rounds"),
        "no_sys_instr": bool(entry.get("no_sys_instr", False)),
        "n": len(records),
        "correctness_pct": _mean_pct(pq["correctness"]),
        "correctness_ci_lo": corr_ci[0] * 100.0,
        "correctness_ci_hi": corr_ci[1] * 100.0,
        "hit_at_k_pct": _mean_pct(pq["retrieval_hit"]),
        "hit_at_k_ci_lo": hit_ci[0] * 100.0,
        "hit_at_k_ci_hi": hit_ci[1] * 100.0,
        "context_precision_pct": _mean_pct(pq["context_precision"]),
        "context_recall_pct": _mean_pct(pq["context_recall"]),
        "faithfulness_avg_pct": _mean_pct(pq["faithfulness"]),
        "hallucination_rate_pct": _mean_pct(pq["hallucinated"]),
        "citation_accuracy_pct": _mean_pct(pq["citation_accuracy"]),
        "rouge_l_pct": _mean_pct(pq["rouge_l"]),
        "metrics": compute_metrics(records),
    }


def _annotate_deltas(summaries: List[Dict[str, Any]], baseline_name: str) -> None:
    """为每个实验计算相对 baseline 的提升（百分点差值）。"""
    base = None
    for s in summaries:
        if s["run_name"] == baseline_name:
            base = s
            break
    if base is None:
        print(f"[warn] 未找到 baseline run_name='{baseline_name}'，跳过相对提升列。")
        return
    for s in summaries:
        for k in ("correctness_pct", "hit_at_k_pct", "context_recall_pct", "faithfulness_avg_pct"):
            s[f"delta_{k}"] = round(s[k] - base[k], 2)


def _render_markdown(summaries: List[Dict[str, Any]], baseline_name: str) -> str:
    lines = [
        "# 实验对比报告",
        "",
        "主指标为 **correctness**（答案正确性）与 **hit@k**（Top-K 命中率），附 bootstrap 95% 置信区间。",
    ]
    if baseline_name:
        lines.append(f"相对提升列为各实验相对基线 `{baseline_name}` 的百分点差值（Δ）。")
    lines.extend(
        [
            "",
            "## 总体对比",
            "",
            "| run_name | mode | rerank | top_k | rounds | n | correctness (95% CI) | hit@k (95% CI) | ctx_recall | faithfulness | hallucination | rouge_l |",
            "|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
        ]
    )
    if baseline_name:
        # 在表头后追加 delta 说明行由每个单元格内联展示
        pass
    for s in summaries:
        corr = f"{s['correctness_pct']:.2f} ({s['correctness_ci_lo']:.2f}~{s['correctness_ci_hi']:.2f})"
        hit = f"{s['hit_at_k_pct']:.2f} ({s['hit_at_k_ci_lo']:.2f}~{s['hit_at_k_ci_hi']:.2f})"
        if baseline_name and f"delta_correctness_pct" in s:
            corr += f" (Δ{s['delta_correctness_pct']:+.1f})"
            hit += f" (Δ{s['delta_hit_at_k_pct']:+.1f})"
        lines.append(
            f"| {s['run_name']} | {s['retrieval_mode']} | {s['rerank_mode']} | {s['top_k']} | {s['max_rounds']} | {s['n']} | "
            f"{corr} | {hit} | {s['context_recall_pct']:.2f} | "
            f"{s['faithfulness_avg_pct']:.2f} | {s['hallucination_rate_pct']:.2f} | {s['rouge_l_pct']:.2f} |"
        )

    # 分类型 correctness 明细
    lines.extend(["", "## 分类型 correctness（%）", ""])
    types: List[str] = []
    for s in summaries:
        for t in s["metrics"]["by_type"]:
            if t not in types:
                types.append(t)
    header = "| run_name | " + " | ".join(types) + " |"
    lines.append(header)
    lines.append("|---|" + "---:|" * len(types))
    for s in summaries:
        by_type = s["metrics"]["by_type"]
        cells = [s["run_name"]]
        for t in types:
            m = by_type.get(t)
            cells.append(f"{m['correctness_pct']:.2f}" if m else "-")
        lines.append("| " + " | ".join(cells) + " |")
    lines.append("")
    return "\n".join(lines)


def _write_csv(summaries: List[Dict[str, Any]], out_csv: Path) -> None:
    fieldnames = [
        "run_name", "run_id", "retrieval_mode", "rerank_mode", "top_k", "max_rounds", "no_sys_instr", "n",
        "correctness_pct", "correctness_ci_lo", "correctness_ci_hi",
        "hit_at_k_pct", "hit_at_k_ci_lo", "hit_at_k_ci_hi",
        "context_precision_pct", "context_recall_pct", "faithfulness_avg_pct",
        "hallucination_rate_pct", "citation_accuracy_pct", "rouge_l_pct",
        "delta_correctness_pct", "delta_hit_at_k_pct", "delta_context_recall_pct", "delta_faithfulness_avg_pct",
    ]
    out_csv.parent.mkdir(parents=True, exist_ok=True)
    with out_csv.open("w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        for s in summaries:
            writer.writerow({k: s.get(k, "") for k in fieldnames})


def main() -> None:
    parser = argparse.ArgumentParser(description="多实验对比与 bootstrap 置信区间")
    parser.add_argument("--manifest", required=True, help="experiments_manifest.jsonl 路径")
    parser.add_argument("--run-names", default="", help="逗号分隔的 run_name 白名单（空=全部）")
    parser.add_argument("--baseline", default="", help="基线 run_name，自动计算相对提升列")
    parser.add_argument("--out-md", default="", help="输出 Markdown 对比报告路径")
    parser.add_argument("--out-csv", default="", help="输出 CSV 对比表路径")
    args = parser.parse_args()

    manifest_path = Path(args.manifest).resolve()
    entries = load_manifest(manifest_path)

    whitelist = {x.strip() for x in args.run_names.split(",") if x.strip()}
    summaries: List[Dict[str, Any]] = []
    for entry in entries:
        rn = str(entry.get("run_name", ""))
        if whitelist and rn not in whitelist:
            continue
        try:
            summaries.append(_run_summary(entry))
        except FileNotFoundError as e:
            print(f"[skip] {rn}: {e}")

    if not summaries:
        raise ValueError("未找到可对比的实验记录（检查 manifest 与 report_path）")

    if args.baseline:
        _annotate_deltas(summaries, args.baseline)

    md = _render_markdown(summaries, args.baseline)
    print(md)

    if args.out_md:
        out_md = Path(args.out_md).resolve()
        out_md.parent.mkdir(parents=True, exist_ok=True)
        out_md.write_text(md, encoding="utf-8")
        print(f"\n对比报告已写入: {out_md}")

    if args.out_csv:
        _write_csv(summaries, Path(args.out_csv).resolve())
        print(f"对比 CSV 已写入: {Path(args.out_csv).resolve()}")


if __name__ == "__main__":
    main()
