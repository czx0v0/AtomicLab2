"""
生成「自包含 HTML」评测报告：跨实验对比表 + 图表（PNG 内嵌 base64，双击即可看，无需联网）。

用法：
    python scripts/plot_results.py \
        --manifest scripts/eval/experiments_manifest.jsonl \
        --out scripts/eval/report.html

可选：
    --run-names single_vector,single_full,...  只画指定 run
    --baseline single_vector                    标出基线（用于 Δ 提示）
"""
from __future__ import annotations

import argparse
import base64
import io
import json
import sys
from pathlib import Path
from typing import Any, Dict, List

import matplotlib

matplotlib.use("Agg")  # 无界面后端，只生成图片
import matplotlib.pyplot as plt

# 中文字体（避免全角括号/中文 glyph 缺失告警）
plt.rcParams["font.sans-serif"] = ["Microsoft YaHei", "SimHei", "DejaVu Sans"]
plt.rcParams["axes.unicode_minus"] = False

_PNG_DIR: Path | None = None  # 若设置，图表同时落盘为独立 PNG

_EVAL_DIR = Path(__file__).resolve().parent / "eval"
sys.path.insert(0, str(_EVAL_DIR))
from compute_metrics import compute_metrics, dedupe_records, load_records


def _load_manifest(path: Path) -> List[Dict[str, Any]]:
    items: List[Dict[str, Any]] = []
    if not path.exists():
        raise FileNotFoundError(f"manifest 不存在: {path}")
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line:
            items.append(json.loads(line))
    return items


def _summaries(manifest: Path, whitelist: List[str]) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    for e in _load_manifest(manifest):
        rn = str(e.get("run_name", ""))
        if whitelist and rn not in whitelist:
            continue
        rp = Path(str(e.get("report_path", "")))
        if not rp.exists():
            continue
        records = dedupe_records(load_records(rp, "auto"), "latest")
        m = compute_metrics(records)
        out.append(
            {
                "run_name": rn,
                "mode": e.get("mode", ""),
                "retrieval_mode": e.get("retrieval_mode", "") or "full",
                "rerank_mode": e.get("rerank_mode", "") or "none",
                "data_root": e.get("data_root", "") or "",
                "type_filter": e.get("type_filter", "") or "",
                "n": m["overall"]["n"],
                **{k: m["overall"][k] for k in
                   ("correctness_pct", "hit_at_k_pct", "context_precision_pct",
                    "context_recall_pct", "faithfulness_avg_pct",
                    "hallucination_rate_pct", "citation_accuracy_pct", "rouge_l_pct")},
                "by_type": m["by_type"],
            }
        )
    return out


def _fig_b64(fig, name: str = "") -> str:
    buf = io.BytesIO()
    fig.savefig(buf, format="png", dpi=120, bbox_inches="tight")
    if _PNG_DIR and name:
        fig.savefig(str(_PNG_DIR / f"{name}.png"), dpi=120, bbox_inches="tight")
    buf.seek(0)
    b64 = base64.b64encode(buf.read()).decode("ascii")
    plt.close(fig)
    return b64


def _bar_chart(summaries: List[Dict[str, Any]], baseline: str) -> str:
    names = [s["run_name"] for s in summaries]
    x = list(range(len(names)))
    fig, ax = plt.subplots(figsize=(max(8, len(names) * 1.1), 4.8))
    w = 0.38
    ax.bar([i - w / 2 for i in x], [s["correctness_pct"] for s in summaries], w, label="correctness", color="#4C8BF5")
    ax.bar([i + w / 2 for i in x], [s["hit_at_k_pct"] for s in summaries], w, label="hit@k", color="#F5A623")
    ax.set_xticks(x)
    ax.set_xticklabels(names, rotation=30, ha="right", fontsize=8)
    ax.set_ylabel("%")
    ax.set_title("答案正确率 vs Top-K 命中率")
    ax.legend()
    ax.grid(axis="y", alpha=0.3)
    return _fig_b64(fig, "bar_correctness_hit")


def _per_type_chart(summaries: List[Dict[str, Any]]) -> str:
    types: List[str] = []
    for s in summaries:
        for t in s["by_type"]:
            if t not in types:
                types.append(t)
    names = [s["run_name"] for s in summaries]
    x = list(range(len(names)))
    n_types = len(types)
    width = 0.8 / max(1, n_types)
    fig, ax = plt.subplots(figsize=(max(8, len(names) * 1.3), 4.8))
    colors = plt.cm.tab10.colors
    for j, t in enumerate(types):
        vals = [s["by_type"].get(t, {}).get("correctness_pct", 0.0) for s in summaries]
        ax.bar([i + (j - n_types / 2 + 0.5) * width for i in x], vals, width,
               label=t, color=colors[j % len(colors)])
    ax.set_xticks(x)
    ax.set_xticklabels(names, rotation=30, ha="right", fontsize=8)
    ax.set_ylabel("correctness %")
    ax.set_title("分题型答案正确率")
    ax.legend(fontsize=8)
    ax.grid(axis="y", alpha=0.3)
    return _fig_b64(fig, "per_type_correctness")


def _config_label(s: Dict[str, Any]) -> str:
    r = s.get("rerank_mode", "none")
    if r and r != "none":
        return f"{s['retrieval_mode']}+{r}"
    return s["retrieval_mode"]


def _heatmap(summaries: List[Dict[str, Any]], metric: str, title: str) -> str:
    """type × config 热力图（类似混淆矩阵），metric ∈ {correctness_pct, hit_at_k_pct}。"""
    import numpy as np

    types: List[str] = []
    for s in summaries:
        t = s.get("type_filter") or "overall"
        if t not in types:
            types.append(t)
    configs: List[str] = []
    for s in summaries:
        c = _config_label(s)
        if c not in configs:
            configs.append(c)
    mat = np.zeros((len(types), len(configs)))
    for i, t in enumerate(types):
        for j, c in enumerate(configs):
            for s in summaries:
                if (s.get("type_filter") or "overall") == t and _config_label(s) == c:
                    mat[i, j] = s.get(metric, 0.0)
                    break
    fig, ax = plt.subplots(figsize=(max(5, len(configs) * 1.3), max(3.5, len(types) * 0.7)))
    im = ax.imshow(mat, cmap="YlGnBu", vmin=0, vmax=100, aspect="auto")
    ax.set_xticks(range(len(configs))); ax.set_xticklabels(configs)
    ax.set_yticks(range(len(types))); ax.set_yticklabels(types)
    ax.set_title(title)
    for i in range(len(types)):
        for j in range(len(configs)):
            ax.text(j, i, f"{mat[i, j]:.1f}", ha="center", va="center", fontsize=9,
                    color="black" if mat[i, j] < 60 else "white")
    fig.colorbar(im, ax=ax, label="%")
    return _fig_b64(fig, f"heatmap_{metric}")


def _table_html(summaries: List[Dict[str, Any]]) -> str:
    cols = [
        ("run_name", "run"), ("retrieval_mode", "检索"), ("rerank_mode", "重排"),
        ("type_filter", "题型"), ("data_root", "数据根"), ("n", "n"),
        ("correctness_pct", "correctness"), ("hit_at_k_pct", "hit@k"),
        ("context_recall_pct", "recall"), ("faithfulness_avg_pct", "faithfulness"),
        ("hallucination_rate_pct", "hallucination"), ("rouge_l_pct", "rouge_l"),
    ]
    head = "".join(f"<th>{c[1]}</th>" for c in cols)
    rows = ""
    for s in summaries:
        tds = ""
        for key, _ in cols:
            v = s.get(key, "")
            if isinstance(v, float):
                v = f"{v:.2f}"
            tds += f"<td>{v}</td>"
        rows += f"<tr>{tds}</tr>"
    return f"<table><thead><tr>{head}</tr></thead><tbody>{rows}</tbody></table>"


def build_html(summaries: List[Dict[str, Any]], baseline: str) -> str:
    img1 = _bar_chart(summaries, baseline)
    img2 = _per_type_chart(summaries)
    img3 = _heatmap(summaries, "correctness_pct", "答案正确率热力图（题型 × 配置）")
    img4 = _heatmap(summaries, "hit_at_k_pct", "Top-K 命中率热力图（题型 × 配置）")
    note = f"<p>基线参照：<b>{baseline}</b>（用于比较相对提升）</p>" if baseline else ""
    return f"""<!DOCTYPE html>
<html lang="zh"><head><meta charset="utf-8"><title>RAG 评测报告</title>
<style>
body {{ font-family: -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif; margin: 24px; color: #222; }}
h1 {{ font-size: 20px; }} h2 {{ font-size: 16px; margin-top: 28px; }}
table {{ border-collapse: collapse; font-size: 12px; }}
th, td {{ border: 1px solid #ddd; padding: 5px 9px; text-align: right; }}
th {{ background: #f5f6f8; }}
td:nth-child(1) {{ text-align: left; font-weight: 600; }}
img {{ max-width: 100%; border: 1px solid #eee; border-radius: 6px; margin-top: 8px; }}
</style></head><body>
<h1>RAG 评测报告</h1>{note}
<h2>总体对比</h2>{_table_html(summaries)}
<h2>答案正确率 vs Top-K 命中率</h2><img src="data:image/png;base64,{img1}">
<h2>分题型答案正确率</h2><img src="data:image/png;base64,{img2}">
<h2>答案正确率热力图（题型 × 配置）</h2><img src="data:image/png;base64,{img3}">
<h2>Top-K 命中率热力图（题型 × 配置）</h2><img src="data:image/png;base64,{img4}">
</body></html>"""


def main() -> None:
    p = argparse.ArgumentParser(description="生成自包含 HTML 评测报告")
    p.add_argument("--manifest", required=True, help="experiments_manifest.jsonl 路径")
    p.add_argument("--run-names", default="", help="逗号分隔白名单（空=全部）")
    p.add_argument("--baseline", default="", help="基线 run_name（用于标注）")
    p.add_argument("--out", default="scripts/eval/report.html", help="输出 HTML 路径")
    p.add_argument("--png-dir", default="", help="同时把图表存为独立 PNG 到该目录（空=只内嵌 HTML）")
    args = p.parse_args()

    wl = [x.strip() for x in args.run_names.split(",") if x.strip()]
    summaries = _summaries(Path(args.manifest).resolve(), wl)
    if not summaries:
        raise SystemExit("manifest 中无可用的 report（先跑评测）")

    global _PNG_DIR
    out = Path(args.out).resolve()
    out.parent.mkdir(parents=True, exist_ok=True)
    if args.png_dir:
        _PNG_DIR = Path(args.png_dir).resolve()
        _PNG_DIR.mkdir(parents=True, exist_ok=True)

    html = build_html(summaries, args.baseline)
    out.write_text(html, encoding="utf-8")
    print(f"HTML 报告已生成: {out}（双击打开即可，含 {len(summaries)} 个实验）")
    if _PNG_DIR:
        print(f"独立 PNG 图表已保存到: {_PNG_DIR}")


if __name__ == "__main__":
    main()
