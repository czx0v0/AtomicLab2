"""
评测报告生成器：从 eval 结果目录一键生成 CSV + MD + PNG。

用法：
    python scripts/make_report.py                       # 默认输出到 scripts/eval/
    python scripts/make_report.py --out-dir reports     # 自定义输出目录
    python scripts/make_report.py --baseline multi_vector_topk5_qwen38   # 以某 run 为基线算 Δ

输出：
    <out>/comparison.csv    对比表（实验 × 核心指标）
    <out>/report.md         Markdown 报告（总览表 + 自动结论）
    <out>/charts/*.png      v5 学术风图表（权重扫描 + top-K 扫描）
"""
from __future__ import annotations

import argparse
import csv
import json
import re
from pathlib import Path
from typing import Any, Dict, List, Optional

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt

EVAL_DIR = Path(__file__).resolve().parent / "eval"

CORE_METRICS = [
    ("correctness_pct", "correctness"),
    ("hit_at_k_pct", "hit@k"),
    ("context_precision_pct", "ctx_precision"),
    ("context_recall_pct", "ctx_recall"),
    ("faithfulness_avg_pct", "faithfulness"),
    ("hallucination_rate_pct", "hallucination"),
    ("citation_accuracy_pct", "citation"),
    ("rouge_l_pct", "rouge_l"),
]

# v5 学术配色
V5 = {
    "blue": "#7E9CC0",
    "gray": "#9AA5B1",
    "terra": "#C98F8F",
    "light": "#B7C4D4",
    "ink": "#5a5348",
    "bg": "#faf8f4",
}


def _font() -> None:
    plt.rcParams["font.sans-serif"] = ["Microsoft YaHei", "SimHei", "Noto Sans CJK SC", "sans-serif"]
    plt.rcParams["axes.unicode_minus"] = False


# ═══════════════════════════ 数据层 ═══════════════════════════

def _load_manifest() -> Dict[str, dict]:
    m: Dict[str, dict] = {}
    p = EVAL_DIR / "experiments_manifest.jsonl"
    if p.exists():
        for line in p.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                e = json.loads(line)
                if e.get("run_name"):
                    m[e["run_name"]] = e
            except Exception:
                continue
    return m


def scan() -> List[dict]:
    manifest = _load_manifest()
    out: List[dict] = []
    for mf in sorted(EVAL_DIR.glob("*.metrics.json")):
        name = mf.stem
        if name.endswith(".metrics"):
            name = name[:-8]  # 去掉 ".metrics"
        if name.startswith("eval_"):
            name = name[5:]  # 去掉 "eval_" 前缀，对齐 manifest 的 run_name
        try:
            metrics = json.loads(mf.read_text(encoding="utf-8")).get("metrics", {})
        except Exception:
            metrics = {}
        overall = metrics.get("overall", {})
        meta = manifest.get(name, {})
        out.append(
            {
                "name": name,
                "n": overall.get("n"),
                **{k: overall.get(k) for k, _ in CORE_METRICS},
                "retrieval_mode": meta.get("retrieval_mode", ""),
                "rerank_mode": meta.get("rerank_mode", ""),
                "agent_mode": meta.get("agent_mode", ""),
                "llm_provider": meta.get("llm_provider", ""),
                "type_filter": meta.get("type_filter", ""),
            }
        )
    return out


# ═══════════════════════════ CSV ═══════════════════════════

def gen_csv(exps: List[dict], baseline: str, out_path: Path) -> None:
    cols = ["name", "type_filter", "retrieval_mode", "rerank_mode", "llm_provider", "n"]
    cols += [k for k, _ in CORE_METRICS]
    base = next((e for e in exps if e["name"] == baseline), None)
    if base:
        cols += [f"d_{k}" for k, _ in CORE_METRICS]
    with out_path.open("w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=cols)
        w.writeheader()
        for e in exps:
            row = {c: e.get(c) for c in cols if not c.startswith("d_")}
            if base:
                for k, _ in CORE_METRICS:
                    bv = base.get(k)
                    ev = e.get(k)
                    row[f"d_{k}"] = round(ev - bv, 2) if isinstance(bv, (int, float)) and isinstance(ev, (int, float)) else ""
            w.writerow(row)
    print(f"[csv] {out_path}")


# ═══════════════════════════ MD ═══════════════════════════

def gen_md(exps: List[dict], baseline: str, out_path: Path) -> None:
    lines = ["# 评测结果报告", ""]
    lines.append(f"共 {len(exps)} 个实验（自动生成）")
    if baseline:
        lines.append(f"基线：`{baseline}`（Δ 列 = 相对基线的差值）")
    lines += ["", "## 指标总览", ""]
    header = ["实验", "题型", "检索", "重排", "n"] + [lbl for _, lbl in CORE_METRICS]
    lines.append("| " + " | ".join(header) + " |")
    lines.append("|" + "---|" * len(header))
    for e in exps:
        cells = [
            f"`{e['name']}`",
            e.get("type_filter") or "",
            e.get("retrieval_mode") or "",
            e.get("rerank_mode") or "",
            str(e.get("n") or ""),
        ]
        cells += [f"{e.get(k):.1f}" if isinstance(e.get(k), (int, float)) else "" for k, _ in CORE_METRICS]
        lines.append("| " + " | ".join(cells) + " |")

    # 自动结论：每类最高 correctness
    lines += ["", "## 自动结论", ""]
    valid = [e for e in exps if isinstance(e.get("correctness_pct"), (int, float))]
    if valid:
        best = max(valid, key=lambda e: e["correctness_pct"])
        lines.append(f"- 最高 correctness：`{best['name']}` = **{best['correctness_pct']:.1f}%**")
        for t in sorted({e.get("type_filter") or "" for e in valid}):
            sub = [e for e in valid if (e.get("type_filter") or "") == t]
            if sub:
                b = max(sub, key=lambda e: e["correctness_pct"])
                lines.append(f"- `{t}` 最优：`{b['name']}` = {b['correctness_pct']:.1f}%")
    lines.append("")
    out_path.write_text("\n".join(lines), encoding="utf-8")
    print(f"[md] {out_path}")


# ═══════════════════════════ PNG ═══════════════════════════

def _parse_weight(name: str) -> Optional[float]:
    m = re.search(r"_w(\d+)_", name)
    if not m:
        return None
    w = m.group(1)
    return float(w) if len(w) == 1 else float(w[0] + "." + w[1:])


def _parse_topk(name: str) -> Optional[int]:
    m = re.search(r"_topk(\d+)_", name)
    return int(m.group(1)) if m else None


def _bar(ax, labels, values, color, title, ylabel="correctness %"):
    ax.bar(range(len(labels)), values, color=color, width=0.6)
    ax.set_xticks(range(len(labels)))
    ax.set_xticklabels(labels, fontsize=8)
    for i, v in enumerate(values):
        ax.text(i, v + 0.5, f"{v:.1f}", ha="center", fontsize=8, color=V5["ink"])
    ax.set_ylabel(ylabel)
    ax.set_title(title, color="#4a6a94", fontsize=12)
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    ax.set_facecolor(V5["bg"])


def gen_png(exps: List[dict], out_dir: Path) -> None:
    _font()
    out_dir.mkdir(parents=True, exist_ok=True)

    # 图 1：权重扫描（correctness vs BM25 权重，single + multi 分组柱状）
    ws = [e for e in exps if _parse_weight(e["name"]) is not None and e.get("correctness_pct") is not None]
    if ws:
        fig, ax = plt.subplots(figsize=(8, 4))
        x = sorted({_parse_weight(e["name"]) for e in ws})
        labels = [f"{w:g}" for w in x]
        width = 0.35
        for i, (prefix, color, lbl) in enumerate(
            [("single_", V5["blue"], "single-hop"), ("multi_", V5["terra"], "multi-hop")]
        ):
            sub = [e for e in ws if e["name"].startswith(prefix)]
            if not sub:
                continue
            m = {_parse_weight(e["name"]): e["correctness_pct"] for e in sub}
            vals = [m.get(w, 0) for w in x]
            xs = [j + (i - 0.5) * width for j in range(len(x))]
            ax.bar(xs, vals, width=width, color=color, label=lbl)
            for xj, v in zip(xs, vals):
                ax.text(xj, v + 0.5, f"{v:.1f}", ha="center", fontsize=7, color=V5["ink"])
        ax.set_xticks(range(len(x)))
        ax.set_xticklabels(labels)
        ax.set_ylabel("correctness %")
        ax.set_title("correctness vs BM25 权重", color="#4a6a94", fontsize=12)
        ax.legend()
        ax.spines["top"].set_visible(False)
        ax.spines["right"].set_visible(False)
        ax.set_facecolor(V5["bg"])
        fig.tight_layout()
        fig.savefig(out_dir / "weight_sweep.png", dpi=150, facecolor=V5["bg"])
        plt.close(fig)
        print(f"[png] {out_dir / 'weight_sweep.png'}")
    else:
        print("[png] 跳过权重扫描图（无数据）")

    # 图 2：top-K 扫描（correctness vs top-K，vector/full/rerank）
    ts = [e for e in exps if _parse_topk(e["name"]) is not None and e.get("correctness_pct") is not None]
    if ts:
        fig, ax = plt.subplots(figsize=(8, 4))
        ks = sorted({_parse_topk(e["name"]) for e in ts})
        labels = [str(k) for k in ks]
        width = 0.25
        for i, (cfg, color) in enumerate([("vector", V5["gray"]), ("full", V5["light"]), ("rerank", V5["blue"])]):
            sub = [e for e in ts if f"_{cfg}_topk" in e["name"]]
            if not sub:
                continue
            m = {_parse_topk(e["name"]): e["correctness_pct"] for e in sub}
            vals = [m.get(k, 0) for k in ks]
            xs = [j + (i - 1) * width for j in range(len(ks))]
            ax.bar(xs, vals, width=width, color=color, label=cfg)
            for xj, v in zip(xs, vals):
                ax.text(xj, v + 0.5, f"{v:.1f}", ha="center", fontsize=7, color=V5["ink"])
        ax.set_xticks(range(len(ks)))
        ax.set_xticklabels(labels)
        ax.set_ylabel("correctness %")
        ax.set_title("multi-hop correctness vs top-K", color="#4a6a94", fontsize=12)
        ax.legend()
        ax.spines["top"].set_visible(False)
        ax.spines["right"].set_visible(False)
        ax.set_facecolor(V5["bg"])
        fig.tight_layout()
        fig.savefig(out_dir / "topk_sweep.png", dpi=150, facecolor=V5["bg"])
        plt.close(fig)
        print(f"[png] {out_dir / 'topk_sweep.png'}")
    else:
        print("[png] 跳过 top-K 扫描图（无数据）")


# ═══════════════════════════ HTML（v5 学术风） ═══════════════════════════

def gen_html(exps: List[dict], baseline: str, charts_dir: Path, out_path: Path) -> None:
    import base64

    valid = [e for e in exps if isinstance(e.get("correctness_pct"), (int, float))]
    best = max(valid, key=lambda e: e["correctness_pct"]) if valid else None
    rows = ""
    for e in exps:
        rows += (
            f"<tr><td class='rowname'>{e['name']}</td><td>{e.get('type_filter','')}</td>"
            f"<td>{e.get('retrieval_mode','')}</td><td>{e.get('rerank_mode','')}</td><td>{e.get('n','')}</td>"
            f"<td class='acc'>{e.get('correctness_pct') if e.get('correctness_pct') is not None else ''}</td>"
            f"<td>{e.get('hit_at_k_pct') if e.get('hit_at_k_pct') is not None else ''}</td>"
            f"<td>{e.get('faithfulness_avg_pct') if e.get('faithfulness_avg_pct') is not None else ''}</td>"
            f"<td>{e.get('hallucination_rate_pct') if e.get('hallucination_rate_pct') is not None else ''}</td></tr>"
        )
    imgs = ""
    for png in ("weight_sweep.png", "topk_sweep.png"):
        fp = charts_dir / png
        if fp.exists():
            b64 = base64.b64encode(fp.read_bytes()).decode()
            imgs += f'<img src="data:image/png;base64,{b64}" style="max-width:100%;margin:12px 0;border:1px solid #ddd5c6">'

    take = ""
    if best:
        take = (
            f"<div class='take'><b>一句话结论：</b>"
            f"在 {len(exps)} 个实验中，最高 correctness 为 <b>{best['name']}</b>（{best['correctness_pct']}%）。"
            f"</div>"
        )

    html = f"""<!DOCTYPE html>
<html lang="zh"><head><meta charset="utf-8"><title>评测结果报告</title>
<style>
body{{font-family:"Source Serif Pro","Noto Serif SC",Georgia,serif;margin:0 auto;max-width:860px;padding:40px 28px;color:#3a352d;line-height:1.65;background:#faf8f4}}
h1{{font-size:26px;border-bottom:2px solid #7E9CC0;padding-bottom:8px}}h2{{font-size:19px;color:#4a6a94;margin-top:36px}}
table{{border-collapse:collapse;width:100%;font-size:13px;background:#fffdf9}}th,td{{border:1px solid #ddd5c6;padding:5px 9px;text-align:center}}th{{background:#f0ebdf}}
td.rowname{{text-align:left;font-weight:600}}td.acc{{font-weight:700}}
.meta{{color:#8a8378;font-size:12.5px}}
.take{{background:#eef3f9;border-left:4px solid #7E9CC0;padding:10px 14px;margin:12px 0}}
.warn{{background:#faf3ec;border-left:4px solid #C9A98F;padding:10px 14px;margin:12px 0}}
</style></head><body>
<h1>评测结果报告</h1><p class="meta">自动生成 · 共 {len(exps)} 个实验{' · 基线 ' + baseline if baseline else ''}</p>
{take}
<h2>指标总览</h2><table>
<tr><th>实验</th><th>题型</th><th>检索</th><th>重排</th><th>n</th><th>correctness</th><th>hit@k</th><th>faithfulness</th><th>hallucination</th></tr>
{rows}</table>
<h2>图表</h2>{imgs}
<div class="warn"><b>注：</b>correctness/hit@k 为百分比；faithfulness 越高越忠实、hallucination 越低越好。</div>
</body></html>"""
    out_path.write_text(html, encoding="utf-8")
    print(f"[html] {out_path}")


# ═══════════════════════════ main ═══════════════════════════

def main() -> None:
    p = argparse.ArgumentParser(description="生成评测报告 CSV + MD + PNG + HTML")
    p.add_argument("--out-dir", default=str(EVAL_DIR), help="输出目录（默认 scripts/eval/）")
    p.add_argument("--baseline", default="", help="基线 run_name（算 Δ 列）")
    args = p.parse_args()

    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    exps = scan()
    if not exps:
        raise SystemExit("未找到 *.metrics.json，先跑评测")

    gen_csv(exps, args.baseline, out_dir / "comparison.csv")
    gen_md(exps, args.baseline, out_dir / "report.md")
    gen_png(exps, out_dir / "charts")
    gen_html(exps, args.baseline, out_dir / "charts", out_dir / "report.html")


if __name__ == "__main__":
    main()
