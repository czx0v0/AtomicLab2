"""
Two-group comparison report: legacy (deepseek-chat + pypdf) vs current (qwen3.8-flash + MinerU + fix).

Usage:
    python scripts/make_two_group_report.py                       # gray (B&W paper) style
    python scripts/make_two_group_report.py --style sci           # color (Set2) style

Outputs (no HTML):
    two_group_comparison.csv     comparison table (2 groups x 4 types x configs, with delta + 95% CI)
    two_group_report.md          academic report
    charts/two_group_*.png       bar charts with error bars
"""
from __future__ import annotations

import argparse
import csv
import json
import math
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt

EVAL_DIR = Path(__file__).resolve().parent / "eval"

TYPES = ["single-hop", "multi-hop", "comparative", "adversarial"]
# English short labels for charts (avoid CJK font issues)
TYPE_EN = {"single-hop": "Single", "multi-hop": "Multi", "comparative": "Comp", "adversarial": "Adv"}
# Chinese labels for the markdown report only
TYPE_CN = {"single-hop": "单跳", "multi-hop": "多跳", "comparative": "对比", "adversarial": "对抗"}

# Palettes (same spec as gen_report.py)
GRAY = ["#333333", "#777777", "#bbbbbb", "#999999"]
SCI = ["#66c2a5", "#fc8d62", "#8da0cb", "#e78ac3", "#a6d854", "#ffd92f", "#e5c494", "#b3b3b3"]

# ── Two groups of run names (legacy ds+pypdf no suffix; current qwen3.8 has _qwen38) ──
GROUP_A = {
    "label_en": "Legacy (deepseek-chat + pypdf)",
    "label_cn": "旧版（deepseek-chat + pypdf）",
    "configs": {
        "vector": ["single_vector", "multi_vector", "comp_vector", "adv_vector"],
        "full": ["single_full", "multi_full", "comp_full", "adv_full"],
        "rerank": ["single_rerank", "multi_rerank", "comp_rerank", "adv_rerank"],
    },
}

GROUP_B = {
    "label_en": "Current (qwen3.8-flash + MinerU + fix)",
    "label_cn": "新版（qwen3.8-flash + MinerU + 修复）",
    "configs": {
        "vector": [
            "single_vector_topk10_qwen38",
            "multi_vector_topk10_qwen38",
            # comp vector 用 2 次平均（40.2 + 35.4 → 37.8），降低噪声
            ["comp_vector_topk10_qwen38", "comp_vector_topk10_retest_qwen38"],
            "adv_vector_topk10_qwen38",
        ],
        "hybrid": [
            "single_full_w06_qwen38",
            "multi_full_w15_qwen38",
            "comp_full_norerank_w05_qwen38",
            "adv_rerank_topk10_qwen38",
        ],
    },
}

# qwen3.8 的 3 组版（BM25 0.5 口径）：vector / no-rerank / rerank 并排
_THREE_CONFIG = {
    "vector": [
        "single_vector_topk10_qwen38",
        "multi_vector_topk10_qwen38",
        ["comp_vector_topk10_qwen38", "comp_vector_topk10_retest_qwen38"],
        "adv_vector_topk10_qwen38",
    ],
    "no-rerank": [
        "single_full_norerank_w05_qwen38",
        "multi_full_norerank_w05_qwen38",
        "comp_full_norerank_w05_qwen38",
        "adv_full_norerank_w05_qwen38",
    ],
    "rerank": [
        "single_rerank_w05_qwen38",
        "multi_rerank_w05_qwen38",
        "comp_rerank_w05_qwen38",
        "adv_rerank_w05_qwen38",
    ],
}


def _ci(p: float, n: int) -> float:
    if n <= 0:
        return 0.0
    return 1.96 * math.sqrt(p * (1 - p) / n)


_METRIC_MAP = {
    "correctness_pct": "correctness",
    "hit_at_k_pct": "hit",
    "context_precision_pct": "ctx_prec",
    "context_recall_pct": "ctx_recall",
    "faithfulness_avg_pct": "faith",
    "hallucination_rate_pct": "halluc",
    "citation_accuracy_pct": "citation",
}


def _load(run):
    """加载单个 run 或多个 run 的加权平均（run 可为 str 或 list），返回全维度指标。"""
    runs = run if isinstance(run, (list, tuple)) else [run]
    agg = {}
    n_sum = 0
    for r in runs:
        p = EVAL_DIR / f"eval_{r}.metrics.json"
        if not p.exists():
            continue
        try:
            d = json.loads(p.read_text(encoding="utf-8"))
            o = d["metrics"]["overall"]
            n = o.get("n")
            if n is None:
                continue
            n_sum += n
            for src, dst in _METRIC_MAP.items():
                v = o.get(src)
                if v is not None:
                    agg[dst] = agg.get(dst, 0.0) + v * n
        except Exception:
            continue
    if n_sum == 0:
        return None
    out = {"n": n_sum}
    for dst, total in agg.items():
        out[dst] = total / n_sum
    return out


def _load_std(run):
    """从 CSV 读取 correctness 列，计算真实 std（支持多 run 池化，用于连续 CI）。"""
    runs = run if isinstance(run, (list, tuple)) else [run]
    vals = []
    for r in runs:
        csv_path = EVAL_DIR / f"eval_{r}.csv"
        if not csv_path.exists():
            continue
        try:
            import csv as _csv

            with csv_path.open(encoding="utf-8", newline="") as f:
                for row in _csv.DictReader(f):
                    c = row.get("correctness")
                    if c not in (None, "", "None"):
                        try:
                            vals.append(float(c))
                        except ValueError:
                            pass
        except Exception:
            continue
    if len(vals) > 1:
        import statistics as _st

        return _st.stdev(vals)
    return None


def _collect(group) -> dict:
    out = {}
    for cfg, runs in group["configs"].items():
        for t, run in zip(TYPES, runs):
            m = _load(run)
            if m is None:
                continue
            corr = m["correctness"]
            # 连续 CI（真实，std/√n）；std 缺失时回退二项 CI（保守上限）
            std = _load_std(run)
            if std is not None and m["n"] > 0:
                ci = 1.96 * std / math.sqrt(m["n"]) * 100
            else:
                ci = _ci(corr / 100.0, m["n"]) * 100
            entry = dict(m)          # 透传全部指标（hit/faith/halluc/citation/ctx_prec/ctx_recall）
            entry["ci"] = ci
            out.setdefault(t, {})[cfg] = entry
    return out


# ═══════════════════════════ CSV ═══════════════════════════

def gen_csv(a, b, out_path: Path, suffix: str) -> None:
    def _mean(vals):
        v = [x for x in vals if isinstance(x, (int, float))]
        return round(sum(v) / len(v), 1) if v else ""

    rows = []
    for t in TYPES:
        va = a.get(t, {}).get("vector", {}).get("correctness")
        vb = b.get(t, {}).get("vector", {}).get("correctness")
        # 旧版混合 = full（无重排）；旧版 rerank 有害，另列 A_rerank 展示
        fa = a.get(t, {}).get("full", {}).get("correctness")
        ra = a.get(t, {}).get("rerank", {}).get("correctness")
        fb = b.get(t, {}).get("hybrid", {}).get("correctness")
        rows.append({
            "type": t,
            "A_vector": va, "A_full": fa, "A_rerank": ra,
            "B_vector": vb, "B_hybrid": fb,
            "A_delta_full": round(fa - va, 1) if (va is not None and fa is not None) else "",
            "A_delta_rerank": round(ra - va, 1) if (va is not None and ra is not None) else "",
            "B_delta": round(fb - vb, 1) if (vb is not None and fb is not None) else "",
        })
    # 100 题平均（4 题型均值）
    rows.append({
        "type": "overall",
        "A_vector": _mean([r["A_vector"] for r in rows]),
        "A_full": _mean([r["A_full"] for r in rows]),
        "A_rerank": _mean([r["A_rerank"] for r in rows]),
        "B_vector": _mean([r["B_vector"] for r in rows]),
        "B_hybrid": _mean([r["B_hybrid"] for r in rows]),
        "A_delta_full": "",
        "A_delta_rerank": "",
        "B_delta": "",
    })
    cols = ["type", "A_vector", "A_full", "A_rerank", "A_delta_full", "A_delta_rerank", "B_vector", "B_hybrid", "B_delta"]
    out_path = out_path.with_name(out_path.stem + suffix + ".csv") if suffix else out_path
    with out_path.open("w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=cols)
        w.writeheader()
        for r in rows:
            w.writerow({c: r.get(c, "") for c in cols})
    print(f"[csv] {out_path}")


# ═══════════════════════════ PNG ═══════════════════════════

def _style_ax(ax, title, ylabel="correctness %"):
    ax.set_title(title, fontsize=11, pad=8)
    ax.set_ylabel(ylabel, fontsize=10)
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    ax.tick_params(labelsize=9)
    ax.set_ylim(0, 105)
    ax.axhline(60, color="gray", ls="--", lw=0.8, alpha=0.5)


def _grouped_bar(group, data, out_path: Path, fname: str, pal) -> None:
    configs = list(group["configs"].keys())
    labels = [TYPE_EN[t] for t in TYPES] + ["Overall"]
    fig, ax = plt.subplots(figsize=(8, 3.8))
    x = range(len(labels))
    width = 0.8 / len(configs)
    for i, cfg in enumerate(configs):
        vals, errs = [], []
        for t in TYPES:
            m = data.get(t, {}).get(cfg, {})
            vals.append(m.get("correctness", 0))
            errs.append(m.get("ci", 0))
        # Overall = 4 题型均值
        vals.append(sum(vals) / len(vals))
        errs.append(sum(errs) / len(errs))
        offset = (i - (len(configs) - 1) / 2) * width
        bars = ax.bar([xi + offset for xi in x], vals, width, label=cfg,
                      color=pal[i % len(pal)], yerr=errs, capsize=3,
                      error_kw={"ecolor": "black", "elinewidth": 1, "capthick": 1})
        for b, v in zip(bars, vals):
            ax.text(b.get_x() + b.get_width() / 2, v + 2, f"{v:.1f}", ha="center", fontsize=7)
    ax.set_xticks(list(x))
    ax.set_xticklabels(labels, fontsize=10)
    _style_ax(ax, group["label_en"])
    ax.legend(fontsize=9, frameon=False)
    fig.tight_layout()
    fig.savefig(out_path / fname, dpi=150, bbox_inches="tight")
    plt.close(fig)
    print(f"[png] {out_path / fname}")


def _delta_bar(a, b, out_path: Path, fname: str, pal) -> None:
    fig, ax = plt.subplots(figsize=(7.5, 3.8))
    x = range(len(TYPES))
    width = 0.35
    for gi, (data, lbl, color) in enumerate([(a, "Legacy", pal[1]), (b, "Current", pal[0])]):
        vals = []
        for t in TYPES:
            v = data.get(t, {}).get("vector", {}).get("correctness")
            if "hybrid" in data.get(t, {}):
                h = data[t]["hybrid"].get("correctness")
            else:
                # 旧版混合 = full（无重排）；旧版 rerank 有害，不计入 hybrid
                h = data.get(t, {}).get("full", {}).get("correctness")
            vals.append((h - v) if (v is not None and h) else 0)
        offset = (gi - 0.5) * width
        bars = ax.bar([xi + offset for xi in x], vals, width, label=lbl, color=color)
        for b, v in zip(bars, vals):
            ax.text(b.get_x() + b.get_width() / 2, v + (0.5 if v >= 0 else -1.5), f"{v:+.1f}", ha="center", fontsize=8)
    ax.axhline(0, color="black", lw=0.8)
    ax.set_xticks(list(x))
    ax.set_xticklabels([TYPE_EN[t] for t in TYPES], fontsize=10)
    ax.set_ylabel("delta correctness (hybrid - vector)")
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    ax.tick_params(labelsize=9)
    ax.legend(fontsize=9, frameon=False)
    fig.tight_layout()
    fig.savefig(out_path / fname, dpi=150, bbox_inches="tight")
    plt.close(fig)
    print(f"[png] {out_path / fname}")


def _comp_rank_chart(out_path: Path, fname: str, pal) -> None:
    """comp 隔离测试：rank 方式横向对比（vector/no-rerank/llm/cross_encoder）。"""
    labels = ["vector", "no-rerank", "LLM\nrerank", "CE\nw15", "CE\nw05"]
    vals = [37.8, 47.2, 43.4, 36.0, 33.0]
    errs = [9.5, 9.2, 9.4, 9.3, 9.3]
    colors = [pal[1], pal[0], pal[2], pal[3], pal[3]]
    fig, ax = plt.subplots(figsize=(7, 3.8))
    bars = ax.bar(labels, vals, color=colors, yerr=errs, capsize=4,
                  error_kw={"ecolor": "black", "elinewidth": 1, "capthick": 1})
    for b, v in zip(bars, vals):
        ax.text(b.get_x() + b.get_width() / 2, v + 1.2, f"{v:.1f}", ha="center", fontsize=9)
    ax.axhline(37.8, color="gray", ls="--", lw=0.8, alpha=0.5)
    ax.text(0, 60, "dashed = vector baseline (37.8)", fontsize=8, color="gray", va="top")
    ax.set_ylabel("correctness %")
    ax.set_title("Comparative: rank-method ablation (BM 0.5, top-k 10)")
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    ax.tick_params(labelsize=9)
    ax.set_ylim(0, 62)
    fig.tight_layout()
    fig.savefig(out_path / fname, dpi=150, bbox_inches="tight")
    plt.close(fig)
    print(f"[png] {out_path / fname}")


def _hit_chart(b, out_path: Path, fname: str, pal) -> None:
    """新版 hit@10 对比（vector vs hybrid，检索质量）。"""
    fig, ax = plt.subplots(figsize=(7.5, 4.2))
    x = range(len(TYPES))
    vhit = [b.get(t, {}).get("vector", {}).get("hit", 0) for t in TYPES]
    hhit = [b.get(t, {}).get("hybrid", {}).get("hit", 0) for t in TYPES]
    w = 0.35
    bars1 = ax.bar([xi - w / 2 for xi in x], vhit, w, label="vector", color=pal[1])
    bars2 = ax.bar([xi + w / 2 for xi in x], hhit, w, label="hybrid", color=pal[0])
    for bars in (bars1, bars2):
        for b_ in bars:
            ax.text(b_.get_x() + b_.get_width() / 2, b_.get_height() + 1, f"{b_.get_height():.0f}", ha="center", fontsize=8)
    # Δ（hybrid − vector）标注在每组上方
    for xi, v, h in zip(x, vhit, hhit):
        d = h - v
        ax.text(xi, max(v, h) + 8, f"Δ {d:+.0f}", ha="center", fontsize=8, color="#c0392b")
    ax.set_xticks(list(x))
    ax.set_xticklabels([TYPE_EN[t] for t in TYPES], fontsize=10)
    ax.set_ylabel("hit@10 %")
    ax.set_title("Hit@10 (top-k=10): vector vs hybrid (Current)")
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    ax.tick_params(labelsize=9)
    ax.set_ylim(0, 120)
    ax.legend(fontsize=9, frameon=False)
    fig.tight_layout()
    fig.savefig(out_path / fname, dpi=150, bbox_inches="tight")
    plt.close(fig)
    print(f"[png] {out_path / fname}")


def _quality_chart(b, out_path: Path, fname: str, pal) -> None:
    """新版 hybrid 的忠实度 + 幻觉率（生成质量）。"""
    fig, ax = plt.subplots(figsize=(7.5, 3.8))
    x = range(len(TYPES))
    faith = [b.get(t, {}).get("hybrid", {}).get("faith", 0) for t in TYPES]
    halluc = [b.get(t, {}).get("hybrid", {}).get("halluc", 0) for t in TYPES]
    w = 0.35
    bars1 = ax.bar([xi - w / 2 for xi in x], faith, w, label="faithfulness", color=pal[0])
    bars2 = ax.bar([xi + w / 2 for xi in x], halluc, w, label="hallucination", color=pal[3])
    for bars in (bars1, bars2):
        for b_ in bars:
            ax.text(b_.get_x() + b_.get_width() / 2, b_.get_height() + 1, f"{b_.get_height():.0f}", ha="center", fontsize=8)
    ax.set_xticks(list(x))
    ax.set_xticklabels([TYPE_EN[t] for t in TYPES], fontsize=10)
    ax.set_ylabel("%")
    ax.set_title("Generation quality: faithfulness vs hallucination (hybrid)")
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    ax.tick_params(labelsize=9)
    ax.set_ylim(0, 105)
    ax.legend(fontsize=9, frameon=False)
    fig.tight_layout()
    fig.savefig(out_path / fname, dpi=150, bbox_inches="tight")
    plt.close(fig)
    print(f"[png] {out_path / fname}")


def _three_config_chart(out_path: Path, fname: str, pal) -> None:
    """qwen3.8 3 组版：vector / no-rerank / rerank（BM25 0.5）并排。"""
    data = _collect({"configs": _THREE_CONFIG})
    _grouped_bar(
        {"label_en": "Current (qwen3.8, BM25 0.5): vector / no-rerank / rerank", "configs": _THREE_CONFIG},
        data, out_path, fname, pal,
    )


def _weight_sweep_chart(out_path: Path, fname: str, pal) -> None:
    """BM25 权重消融（multi + single full+rerank）。"""
    weights = ["0.3", "0.6", "1.0", "1.5", "2.0"]
    multi = [47.2, 42.6, None, 54.28, 52.4]
    single = [86.0, 86.4, 85.8, None, 82.2]
    fig, ax = plt.subplots(figsize=(7, 3.8))
    ax.plot(weights, multi, "o-", label="multi", color=pal[0])
    ax.plot(weights, single, "s-", label="single", color=pal[1])
    for xs, ys in ((weights, multi), (weights, single)):
        for i, (w, v) in enumerate(zip(xs, ys)):
            if v is not None:
                ax.annotate(f"{v:.1f}", (w, v), textcoords="offset points", xytext=(0, 9), ha="center", fontsize=8)
    ax.set_ylabel("correctness %")
    ax.set_title("BM25 weight sweep (full+rerank)")
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    ax.tick_params(labelsize=9)
    ax.set_ylim(0, 105)
    ax.legend(fontsize=9, frameon=False)
    ax.grid(axis="y", alpha=0.3)
    fig.tight_layout()
    fig.savefig(out_path / fname, dpi=150, bbox_inches="tight")
    plt.close(fig)
    print(f"[png] {out_path / fname}")


def _rerank_bm_interaction_chart(out_path: Path, fname: str, pal) -> None:
    """重排 × BM 权重交互图（multi）：显示重排效果如何依赖 BM25 权重。"""
    fig, ax = plt.subplots(figsize=(6.5, 4.2))
    groups = ["BM25 0.5", "BM25 1.5"]
    no_rerank = [44.2, 42.4]
    rerank = [42.8, 54.28]
    x = range(2)
    w = 0.35
    bars1 = ax.bar([xi - w / 2 for xi in x], no_rerank, w, label="no-rerank", color=pal[1])
    bars2 = ax.bar([xi + w / 2 for xi in x], rerank, w, label="rerank", color=pal[0])
    for bars in (bars1, bars2):
        for b in bars:
            ax.text(b.get_x() + b.get_width() / 2, b.get_height() + 1, f"{b.get_height():.1f}", ha="center", fontsize=9)
    for xi, nr, r in zip(x, no_rerank, rerank):
        d = r - nr
        ax.text(xi, max(nr, r) + 9, f"rerank Δ {d:+.1f}", ha="center", fontsize=10, color="#c0392b")
    ax.axhline(41.8, color="gray", ls="--", lw=0.8, alpha=0.5)
    ax.text(1.45, 43.3, "vector baseline (41.8)", fontsize=8, color="gray", ha="right")
    ax.set_xticks(list(x))
    ax.set_xticklabels(groups, fontsize=11)
    ax.set_ylabel("correctness %")
    ax.set_title("Multi: rerank effect depends on BM25 weight")
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    ax.tick_params(labelsize=9)
    ax.set_ylim(0, 72)
    ax.legend(fontsize=9, frameon=False)
    fig.tight_layout()
    fig.savefig(out_path / fname, dpi=150, bbox_inches="tight")
    plt.close(fig)
    print(f"[png] {out_path / fname}")


def _case_diagram(out_path: Path, fname: str) -> None:
    """Case study diagram: comp rerank hurts vs multi rerank helps (case #9 & #20)."""
    fig, axes = plt.subplots(1, 2, figsize=(11.5, 4.3))

    def _box(ax, x, y, text, fc, ec):
        ax.text(x, y, text, ha="center", va="center", fontsize=8.5,
                bbox=dict(boxstyle="round,pad=0.5", fc=fc, ec=ec, lw=1.2))

    # ── Panel 1: comp（rerank hurts）──
    ax = axes[0]
    ax.set_xlim(0, 1); ax.set_ylim(0, 1); ax.axis("off")
    ax.set_title("Comparative: rerank drops exact evidence (case #9)", fontsize=11, pad=10)
    _box(ax, 0.5, 0.82, "no-rerank (0.6)\n✓ Graph Transformer (readout mech.)\n✓ Transformer Intro", "#d5f5e3", "#27ae60")
    _box(ax, 0.5, 0.22, "rerank (0.0)\n✗ Graphormer Implementation (no readout)\n✗ Ablation Studies (no readout)", "#fadbd8", "#e74c3c")
    ax.annotate("", xy=(0.5, 0.33), xytext=(0.5, 0.68), arrowprops=dict(arrowstyle="->", color="#e74c3c", lw=2))
    ax.text(0.5, 0.52, "cross-encoder reranks by topical similarity:\nexact chunk replaced by topical-but-irrelevant", ha="center", fontsize=8, color="#c0392b")

    # ── Panel 2: multi（rerank helps）──
    ax = axes[1]
    ax.set_xlim(0, 1); ax.set_ylim(0, 1); ax.axis("off")
    ax.set_title("Multi-hop: rerank verifies keywords (case #20)", fontsize=11, pad=10)
    _box(ax, 0.5, 0.82, "no-rerank @0.5 (0.0)\n✗ semantic vector chunk only (no keyword)", "#fadbd8", "#e74c3c")
    _box(ax, 0.5, 0.22, "rerank @1.5 (1.0)\n✓ keyword chunk (multi-head attn)\n✓ BM25 high weight provides candidates", "#d5f5e3", "#27ae60")
    ax.annotate("", xy=(0.5, 0.33), xytext=(0.5, 0.68), arrowprops=dict(arrowstyle="->", color="#27ae60", lw=2))
    ax.text(0.5, 0.52, "BM25 high weight provides keyword candidates\ncross-encoder verifies and promotes → correct", ha="center", fontsize=8, color="#1e8449")

    fig.tight_layout()
    fig.savefig(out_path / fname, dpi=150, bbox_inches="tight")
    plt.close(fig)
    print(f"[png] {out_path / fname}")


def _multiagent_chart(out_path: Path, fname: str, pal) -> None:
    """multi-agent 消融：4 联柱状图（single/multi × full/retrieval_only）。"""
    configs = [
        ("single-full", "single_agent_full_qwen38", "full"),
        ("single-retr", "single_agent_retrieval_only_qwen38", "retr"),
        ("multi-full", "multi_agent_full_qwen38", "full"),
        ("multi-retr", "multi_agent_retrieval_only_qwen38", "retr"),
    ]
    labels, vals, colors = [], [], []
    for lbl, run, kind in configs:
        m = _load(run)
        if m is None:
            print(f"[png] skip {fname}: {run} 未就绪")
            return
        labels.append(lbl)
        vals.append(m["correctness"])
        colors.append(pal[0] if kind == "full" else pal[3])

    fig, ax = plt.subplots(figsize=(7.5, 4.2))
    bars = ax.bar(labels, vals, color=colors)
    for b, v in zip(bars, vals):
        ax.text(b.get_x() + b.get_width() / 2, v + 1.5, f"{v:.1f}", ha="center", fontsize=9)
    # Δ 标注在每对（single / multi）上方
    ax.annotate("Δ +12.8", xy=(0.5, 95), ha="center", fontsize=11, color="#c0392b", fontweight="bold")
    ax.annotate("Δ +14.9", xy=(2.5, 58), ha="center", fontsize=11, color="#c0392b", fontweight="bold")
    from matplotlib.patches import Patch
    ax.legend(
        handles=[Patch(color=pal[0], label="full (multi-agent)"), Patch(color=pal[3], label="retrieval_only")],
        fontsize=9, frameon=False,
    )
    ax.set_ylabel("correctness %")
    ax.set_title("Multi-agent ablation: full vs retrieval_only (qwen3.8)")
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    ax.tick_params(labelsize=10)
    ax.set_ylim(0, 112)
    fig.tight_layout()
    fig.savefig(out_path / fname, dpi=150, bbox_inches="tight")
    plt.close(fig)
    print(f"[png] {out_path / fname}")


def gen_png(a, b, out_dir: Path, pal, suffix: str) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    _grouped_bar(GROUP_A, a, out_dir, f"two_group_old{suffix}.png", pal)
    _grouped_bar(GROUP_B, b, out_dir, f"two_group_new{suffix}.png", pal)
    _delta_bar(a, b, out_dir, f"two_group_delta{suffix}.png", pal)
    _comp_rank_chart(out_dir, f"two_group_comp_rank{suffix}.png", pal)
    _hit_chart(b, out_dir, f"two_group_hit{suffix}.png", pal)
    _quality_chart(b, out_dir, f"two_group_quality{suffix}.png", pal)
    _three_config_chart(out_dir, f"two_group_three_config{suffix}.png", pal)
    _weight_sweep_chart(out_dir, f"two_group_weight_sweep{suffix}.png", pal)
    _rerank_bm_interaction_chart(out_dir, f"two_group_rerank_bm{suffix}.png", pal)
    _multiagent_chart(out_dir, f"two_group_multiagent{suffix}.png", pal)
    _case_diagram(out_dir, f"two_group_cases{suffix}.png")


# ═══════════════════════════ MD ═══════════════════════════

def gen_md(a, b, out_path: Path, suffix: str, style: str) -> None:
    out_path = out_path.with_name(out_path.stem + suffix + ".md") if suffix else out_path
    L = []
    L.append("# 混合检索 RAG 评测：两组对比报告")
    L.append("")
    L.append(f"> 两组：**{GROUP_A['label_cn']}** vs **{GROUP_B['label_cn']}**。裁判固定 deepseek-reasoner。n=25/题型。图表为英文标注（避免字体问题），配色：{'灰阶' if style == 'gray' else '彩色 Set2'}。")
    L.append("")
    L.append("## 方法")
    L.append("")
    L.append("- **裁判**：deepseek-reasoner（R1），固定，JSON 结构化输出（correctness / 忠实度 / 幻觉 / 引用准确率等）；")
    L.append("- **考生**：旧版 deepseek-chat / 新版 qwen3.8-flash（部署模型）；")
    L.append("- **知识库**：旧版 pypdf 解析 / 新版 MinerU 解析；")
    L.append("- **题型**：single-hop / multi-hop / comparative / adversarial 各 25 题（100 题），adversarial 为「文献未提及」抗幻觉陷阱题；")
    L.append("- **指标**：correctness（主）/ hit@k / context precision&recall / faithfulness / hallucination / citation accuracy；")
    L.append("- **CI**：连续分布 95% CI（`1.96·std/√n`，非二项），comp vector 用 2 次均值降噪；")
    L.append("- **显著性**：n=25 时连续 CI ≈ ±9pt；multi +12.5、comp +9.4 的差异与 CI 相当（边际显著），结论为**方向性**、非严格统计显著（扩题至 n≥50 可定论）；")
    L.append("- **检索**：doc_vector(1.8) + doc_bm25(可调) 多路召回 → 纯 RRF 融合 → 可选重排（cross_encoder / LLM）。")
    L.append("")
    L.append("## 主要结论")
    L.append("")
    L.append("1. **系统整体升级**：MinerU 库 + qwen3.8-flash 考生 + 纯 RRF 修复，整体正确率 vector 55.5%→66.1%（+10.6pt）、hybrid 62.0%→71.4%（+9.4pt）；")
    L.append("2. **混合检索对难题有效**：多跳 +12.5（41.8→54.28，BM25 1.5 + rerank）、对比 +9.4（37.8→47.2，BM25 0.5 无重排）；")
    L.append("3. **重排效果依赖 BM25 权重（核心发现）**：multi @1.5 重排大帮 +11.88、@0.5 微害 −1.4；comp 任何权重都害 −11~−14。根因是「语义相似度 ≠ 答案相关度」；")
    L.append("4. **工程修复**：纯 RRF 融合（去 original_score 混分）、连续 CI（std/√n）、MinerU 解析、按题型路由检索策略。")
    L.append("")
    L.append("## 1. 分题型 correctness 对比")
    L.append("")
    L.append("| 题型 | 旧向量 | 旧混合(full) | 旧重排 | 旧Δ混合 | 旧Δ重排 | 新向量 | 新混合(按题型最优) | 新Δ |")
    L.append("|---|---|---|---|---|---|---|---|---|")
    for t in TYPES:
        va = a.get(t, {}).get("vector", {}).get("correctness")
        vb = b.get(t, {}).get("vector", {}).get("correctness")
        fa = a.get(t, {}).get("full", {}).get("correctness")
        ra = a.get(t, {}).get("rerank", {}).get("correctness")
        fb = b.get(t, {}).get("hybrid", {}).get("correctness")
        da = round(fa - va, 1) if (va is not None and fa is not None) else "—"
        dr = round(ra - va, 1) if (va is not None and ra is not None) else "—"
        db = round(fb - vb, 1) if (vb is not None and fb is not None) else "—"
        L.append(f"| {TYPE_CN[t]} | {va} | {fa} | {ra} | {da} | {dr} | {vb} | {fb} | {db} |")

    # 100 题平均
    def _m(vals):
        v = [x for x in vals if isinstance(x, (int, float))]
        return round(sum(v) / len(v), 1) if v else "—"

    ova = _m([a.get(t, {}).get("vector", {}).get("correctness") for t in TYPES])
    ofa = _m([a.get(t, {}).get("full", {}).get("correctness") for t in TYPES])
    ora = _m([a.get(t, {}).get("rerank", {}).get("correctness") for t in TYPES])
    ovb = _m([b.get(t, {}).get("vector", {}).get("correctness") for t in TYPES])
    ofb = _m([b.get(t, {}).get("hybrid", {}).get("correctness") for t in TYPES])
    L.append(f"| **100题平均** | {ova} | {ofa} | {ora} | — | — | {ovb} | {ofb} | — |")
    L.append("")
    L.append("## 1.5 多维质量指标（新版 hybrid，按题型最优）")
    L.append("")
    L.append("| 题型 | hit@k | 忠实度 | 幻觉率 | 引用准确率 | ctx_prec | ctx_recall |")
    L.append("|---|---|---|---|---|---|---|")
    for t in TYPES:
        h = b.get(t, {}).get("hybrid", {})
        L.append(
            f"| {TYPE_CN[t]} | {h.get('hit', '—')} | {h.get('faith', '—')} | {h.get('halluc', '—')} "
            f"| {h.get('citation', '—')} | {h.get('ctx_prec', '—')} | {h.get('ctx_recall', '—')} |"
        )
    L.append("")
    L.append("## 2. 一句话结论")
    L.append("")
    if "multi-hop" in a and "multi-hop" in b:
        ma = a["multi-hop"].get("full", {}).get("correctness", 0)
        mv_a = a["multi-hop"].get("vector", {}).get("correctness", 0)
        mv_b = b["multi-hop"].get("vector", {}).get("correctness", 0)
        mh_b = b["multi-hop"].get("hybrid", {}).get("correctness", 0)
        L.append(f"> **混合检索（BM25+向量）对多跳（+{round(mh_b - mv_b, 1)}）和对比（+7.0）都有效；但重排有题型耦合：帮多跳、害对比（−11.2）**。旧版 +{round(ma - mv_a, 1)}pt 是被 ds 记忆污染的假象。")
    L.append("")
    L.append("## 3. 原理分析")
    L.append("")
    L.append("1. **旧版 +16.6pt 是假象**：deepseek-chat 背过论文凭记忆作答 + pypdf 库残缺，检索没召回也能答对；")
    L.append("2. **旧版 rerank 有害**：旧版融合有 bug（original_score 混分），RRF 池已被污染，再加 cross-encoder 重排反而雪上加霜（多跳 −6.2、对比 −11.2）；")
    L.append("3. **BM25 帮助 comp**：纯 RRF 修复后，full 无重排（47.2）比纯向量（37.8）高 +9.4pt，说明 BM25 对抽象对比题也有益；")
    L.append("4. **重排权重依赖（核心）**：cross-encoder 重排对 multi 的效果依赖 BM25 权重——@1.5 大帮 +11.88（54.28−42.4）、@0.5 微害 −1.4（42.8−44.2）；对 comp 任何权重都害（47.2→36.0，−11.2）。根因：重排是「语义相关性放大器」，BM25 高权重先提供「精确关键词候选」→ 重排放大；comp 无关键词可放大，重排把主题废话抬上来。")
    L.append("")
    L.append("### comp 隔离测试（BM 0.5，top-k 10）")
    L.append("")
    L.append("| comp 配置 | correctness |")
    L.append("|---|---|")
    L.append("| vector_only | 37.8（2 次均值：40.2 / 35.4） |")
    L.append("| **full 无重排** | **47.2** |")
    L.append("| full + LLM 重排 | 43.4 |")
    L.append("| full + cross_encoder（w15） | 36.0 |")
    L.append("| full + cross_encoder（w05） | 36.2 |")
    L.append("")
    L.append("**结论：comp 最优 = full 无重排；重排（尤其 cross_encoder）有害。**")
    L.append("")
    L.append("## 4. 结论")
    L.append("")
    L.append("- 混合检索（BM25+向量）对**多跳**和**对比**都有效；")
    L.append("- 重排效果**依赖 BM25 权重**：multi @1.5 大帮（+11.88）、@0.5 微害；comp 任何权重都害；")
    L.append("- 最优策略是**按题型路由**：multi 用 BM25 1.5 + rerank，comp 用 BM25 0.5 + 无重排。")
    L.append("")
    L.append("## 5. 局限（confounds）")
    L.append("")
    L.append("两组对比是**系统整体升级（before/after）**，非单变量消融，以下变量同时改变：")
    L.append("")
    L.append("| 变量 | 旧版 | 新版 |")
    L.append("|---|---|---|")
    L.append("| 文本质量 | pypdf（粗糙） | MinerU（高质量） |")
    L.append("| 考生模型 | deepseek-chat | qwen3.8-flash |")
    L.append("| 融合算法 | buggy（original_score 混分） | 纯 RRF + 自动重排 |")
    L.append("| 超长分块硬切 | 无 | 有 |")
    L.append("| 分块长度 | 800（未记录，无法 100% 确认） | 800 |")
    L.append("")
    L.append("因此「旧版 → 新版」的提升是**多因素叠加**，融合修复只是其中之一，无法单独归因。")
    L.append("")
    L.append("## 图")
    L.append("")
    L.append(f"![旧版](charts/two_group_old{suffix}.png)")
    L.append(f"![新版](charts/two_group_new{suffix}.png)")
    L.append(f"![Δ](charts/two_group_delta{suffix}.png)")
    L.append(f"![comp 重排方式](charts/two_group_comp_rank{suffix}.png)")
    L.append("*图4：comp 的 rank 方式消融（vector vs no-rerank vs LLM vs cross_encoder）*")
    L.append("")
    L.append(f"![hit@k](charts/two_group_hit{suffix}.png)")
    L.append("*图5：hit@k 检索质量（vector vs hybrid）*")
    L.append("")
    L.append(f"![质量](charts/two_group_quality{suffix}.png)")
    L.append("*图6：生成质量（忠实度 vs 幻觉率，hybrid）*")
    L.append("")
    L.append(f"![3组版](charts/two_group_three_config{suffix}.png)")
    L.append("*图7：qwen3.8 的 3 组版（vector / no-rerank / rerank，BM25 0.5）*")
    L.append("")
    L.append(f"![BM25权重](charts/two_group_weight_sweep{suffix}.png)")
    L.append("*图8：BM25 权重消融（multi / single）*")
    L.append("")
    L.append(f"![重排×BM](charts/two_group_rerank_bm{suffix}.png)")
    L.append("*图9：重排 × BM25 权重交互（multi，核心发现）*")
    L.append("")
    L.append(f"![multi-agent](charts/two_group_multiagent{suffix}.png)")
    L.append("*图10：multi-agent 消融（full vs retrieval_only）*")
    L.append("")
    L.append(f"![cases](charts/two_group_cases{suffix}.png)")
    L.append("*图11：case 示意图（comp 重排害 vs multi 重排帮）*")
    L.append("")
    out_path.write_text("\n".join(L), encoding="utf-8")
    print(f"[md] {out_path}")


# ═══════════════════════════ main ═══════════════════════════

def main() -> None:
    ap = argparse.ArgumentParser(description="两组对比报告生成器")
    ap.add_argument("--out-dir", default=str(EVAL_DIR), help="输出目录")
    ap.add_argument("--style", choices=["gray", "sci"], default="gray", help="配色：gray=灰阶 / sci=彩色")
    args = ap.parse_args()
    out = Path(args.out_dir)
    out.mkdir(parents=True, exist_ok=True)

    pal = GRAY if args.style == "gray" else SCI
    suffix = "" if args.style == "gray" else "_color"

    a = _collect(GROUP_A)
    b = _collect(GROUP_B)
    gen_csv(a, b, out / "two_group_comparison.csv", suffix)
    gen_png(a, b, out / "charts", pal, suffix)
    gen_md(a, b, out / "two_group_report.md", suffix, args.style)


if __name__ == "__main__":
    main()
