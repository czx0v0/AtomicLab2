"""
逐题案例对比 HTML 视图：题目 / 标准答案(gt) / 各方案答案 / 裁判评分 / 检索证据 / agent 轨迹。

用法：
    python scripts/case_viewer.py \
        --manifest scripts/eval/experiments_manifest.jsonl \
        --out scripts/eval/cases.html
"""
from __future__ import annotations

import argparse
import html
import json
from pathlib import Path
from typing import Any, Dict, List


def _load_manifest(path: Path) -> List[Dict[str, Any]]:
    items = []
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line:
            items.append(json.loads(line))
    return items


def _config_label(e: Dict[str, Any]) -> str:
    r = (e.get("rerank_mode") or "none")
    return f"{e.get('retrieval_mode') or 'full'}" + (f"+{r}" if r != "none" else "")


def _load_jsonl(path: Path) -> Dict[str, Dict[str, Any]]:
    """按 question 去重，取最后一行。"""
    out: Dict[str, Dict[str, Any]] = {}
    if not path.exists():
        return out
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        r = json.loads(line)
        q = (r.get("question") or "").strip()
        if q:
            out[q] = r
    return out


def _esc(s: Any) -> str:
    return html.escape(str(s)) if s is not None else ""


def _trunc(s: Any, n: int = 400) -> str:
    s = str(s or "")
    return s if len(s) <= n else s[:n] + "…"


def build_cases(manifest: Path) -> str:
    entries = [e for e in _load_manifest(manifest) if (e.get("mode") == "direct" and e.get("report_path"))]
    configs: List[Dict[str, Any]] = []
    for e in entries:
        raw_jp = str(e.get("jsonl_report_path") or "").strip()
        jp = Path(raw_jp) if raw_jp else Path(str(e.get("report_path"))).with_suffix(".jsonl")
        if not jp.exists():
            jp = Path(str(e.get("report_path"))).with_suffix(".jsonl")
        if jp.exists() and jp.is_file():
            configs.append({"run_name": e.get("run_name"), "label": _config_label(e), "records": _load_jsonl(jp)})

    # 聚合所有题目（保持数据集顺序）
    all_q: List[str] = []
    for c in configs:
        for q in c["records"]:
            if q not in all_q:
                all_q.append(q)

    cards = []
    for q in all_q:
        first = None
        for c in configs:
            if q in c["records"]:
                first = c["records"][q]
                break
        if not first:
            continue
        qtype = first.get("type") or ""
        gt = first.get("ground_truth") or ""
        badge = {
            "single-hop": "single", "multi-hop": "multi", "comparative": "comparative", "adversarial": "adversarial",
        }.get(qtype, qtype)
        rows = ""
        for c in configs:
            r = c["records"].get(q)
            if not r:
                continue
            corr = float(r.get("correctness") or 0)
            hit = int(r.get("retrieval_hit") or 0)
            color = "#d4edda" if corr >= 0.6 else ("#fff3cd" if corr >= 0.3 else "#f8d7da")
            rows += (
                f"<tr style='background:{color}'><td>{_esc(c['label'])}</td>"
                f"<td>{corr:.2f}</td><td>{'✓' if hit else '✗'}</td>"
                f"<td>{_esc(_trunc(r.get('answer'), 300))}</td>"
                f"<td style='font-size:11px'>{_esc(_trunc(r.get('judge_reason'), 120))}</td></tr>"
            )
        # 检索证据（取第一个方案的 contexts）
        ctx_html = ""
        try:
            ctxs = first.get("retrieved_contexts") or []
            if ctxs:
                ctx_items = "".join(
                    f"<li><b>[{i+1}]</b> src={_esc(c.get('source','?'))} score={_esc(c.get('score'))} "
                    f"<br>{_esc(_trunc(c.get('summary') or c.get('concept') or '', 260))}</li>"
                    for i, c in enumerate(ctxs[:8])
                )
                ctx_html = f"<details><summary>检索证据（{len(ctxs)} 条，前 8 条）</summary><ul>{ctx_items}</ul></details>"
        except Exception:
            ctx_html = ""
        trace_html = ""
        try:
            traces = first.get("agent_traces") or []
            if traces:
                t_items = "".join(
                    f"<li><b>{_esc(t.get('step','?'))}</b> {_esc(_trunc(t.get('detail',''), 200))}</li>"
                    for t in traces
                )
                trace_html = f"<details><summary>agent 轨迹</summary><ul>{t_items}</ul></details>"
        except Exception:
            trace_html = ""
        cards.append(
            f"<div class='card'><div class='q'><span class='badge {badge}'>{_esc(badge)}</span> {_esc(q)}</div>"
            f"<div class='gt'><b>GT：</b>{_esc(_trunc(gt, 400))}</div>"
            f"<table><thead><tr><th>配置</th><th>correctness</th><th>hit</th><th>答案</th><th>裁判理由</th></tr></thead>"
            f"<tbody>{rows}</tbody></table>{ctx_html}{trace_html}</div>"
        )

    css = """
body{font-family:-apple-system,"Segoe UI","Microsoft YaHei",sans-serif;margin:20px;color:#222}
.card{border:1px solid #ddd;border-radius:8px;padding:12px 14px;margin:10px 0}
.q{font-weight:600;margin-bottom:6px}
.gt{color:#555;font-size:13px;margin-bottom:8px}
.badge{display:inline-block;padding:1px 8px;border-radius:10px;font-size:11px;color:#fff;margin-right:6px}
.single{background:#4C8BF5}.multi{background:#F5A623}.comparative{background:#9b59b6}.adversarial{background:#e74c3c}
table{border-collapse:collapse;width:100%;font-size:12px;margin-top:6px}
th,td{border:1px solid #eee;padding:5px 8px;text-align:left;vertical-align:top}
th{background:#f5f6f8}
details{margin-top:6px;font-size:12px;color:#444}
details summary{cursor:pointer;color:#2a6}
ul{margin:4px 0 0 18px;padding:0}
li{margin:2px 0}
"""
    return f"<!DOCTYPE html><html lang='zh'><head><meta charset='utf-8'><title>评测案例对比</title><style>{css}</style></head><body><h1>评测案例对比（{len(cards)} 题 × {len(configs)} 配置）</h1>{''.join(cards)}</body></html>"


def main() -> None:
    p = argparse.ArgumentParser(description="生成逐题案例对比 HTML")
    p.add_argument("--manifest", required=True, help="experiments_manifest.jsonl 路径")
    p.add_argument("--out", default="scripts/eval/cases.html", help="输出 HTML 路径")
    args = p.parse_args()
    html = build_cases(Path(args.manifest).resolve())
    out = Path(args.out).resolve()
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(html, encoding="utf-8")
    print(f"案例对比 HTML 已生成: {out}")


if __name__ == "__main__":
    main()
