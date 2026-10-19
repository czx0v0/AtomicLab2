"""
Eval 结果浏览器 + 报告导出（合并版）。

启动：
    python scripts/eval_server.py          # 默认 http://localhost:8765
    python scripts/eval_server.py --port 9000

功能：
    - 自动扫描 scripts/eval/ 下的 *.metrics.json + *.csv + manifest；
    - 交互浏览：实验列表 / 多选对比表 / 逐题详情（答案/GT/证据/轨迹/思考链）；
    - 报告导出：GET /api/report 生成 v5 学术风静态 HTML（内联 SVG 图表）。

说明：数据层（scan_experiments / load_experiment）可被报告生成器复用。
"""
from __future__ import annotations

import argparse
import csv
import json
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import FastAPI
from fastapi.responses import HTMLResponse, JSONResponse, Response

EVAL_DIR = Path(__file__).resolve().parent / "eval"

app = FastAPI(title="Eval Browser")

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


# ═══════════════════════════ 数据层（可复用） ═══════════════════════════

def _load_manifest() -> Dict[str, dict]:
    manifest: Dict[str, dict] = {}
    p = EVAL_DIR / "experiments_manifest.jsonl"
    if p.exists():
        for line in p.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                e = json.loads(line)
                rn = e.get("run_name", "")
                if rn:
                    manifest[rn] = e  # 后写覆盖，等效 dedupe=latest
            except Exception:
                continue
    return manifest


def _metrics_files() -> List[Path]:
    return sorted(EVAL_DIR.glob("*.metrics.json"))


def _load_metrics(path: Path) -> dict:
    try:
        return json.loads(path.read_text(encoding="utf-8")).get("metrics", {})
    except Exception:
        return {}


def _load_csv(path: Path) -> List[dict]:
    if not path.exists():
        return []
    try:
        with path.open(encoding="utf-8", newline="") as f:
            return list(csv.DictReader(f))
    except Exception:
        return []


def _canonical_name(mf: Path) -> str:
    stem = mf.stem
    if stem.endswith(".metrics"):
        stem = stem[:-8]  # 去掉 ".metrics"
    if stem.startswith("eval_"):
        stem = stem[5:]  # 去掉 "eval_" 前缀，对齐 manifest 的 run_name
    return stem


def scan_experiments() -> List[dict]:
    """扫描结果目录，返回实验列表（指标概览 + 元信息）。"""
    manifest = _load_manifest()
    out: List[dict] = []
    for mf in _metrics_files():
        name = _canonical_name(mf)
        metrics = _load_metrics(mf)
        overall = metrics.get("overall", {})
        meta = manifest.get(name, {})
        out.append(
            {
                "name": name,
                "n": overall.get("n"),
                "correctness": overall.get("correctness_pct"),
                "hit_at_k": overall.get("hit_at_k_pct"),
                "faithfulness": overall.get("faithfulness_avg_pct"),
                "hallucination": overall.get("hallucination_rate_pct"),
                "retrieval_mode": meta.get("retrieval_mode", ""),
                "rerank_mode": meta.get("rerank_mode", ""),
                "agent_mode": meta.get("agent_mode", ""),
                "llm_provider": meta.get("llm_provider", ""),
                "type_filter": meta.get("type_filter", ""),
                "data_root": meta.get("data_root", ""),
            }
        )
    return out


def load_experiment(name: str) -> Optional[dict]:
    mf = EVAL_DIR / f"eval_{name}.metrics.json"
    if not mf.exists():
        mf = EVAL_DIR / f"{name}.metrics.json"  # 兜底：无 eval_ 前缀的旧文件
    if not mf.exists():
        return None
    metrics = _load_metrics(mf)
    csv_path = EVAL_DIR / f"eval_{name}.csv"
    if not csv_path.exists():
        csv_path = EVAL_DIR / f"{name}.csv"
    rows = _load_csv(csv_path)
    meta = _load_manifest().get(name, {})
    return {"name": name, "metrics": metrics, "meta": meta, "questions": rows}


# ═══════════════════════════ API ═══════════════════════════

@app.get("/api/experiments")
def api_experiments() -> JSONResponse:
    return JSONResponse({"experiments": scan_experiments()})


@app.get("/api/experiments/{name}")
def api_experiment(name: str) -> JSONResponse:
    exp = load_experiment(name)
    if exp is None:
        return JSONResponse({"error": f"未找到实验: {name}"}, status_code=404)
    return JSONResponse(exp)


@app.get("/api/compare")
def api_compare(runs: str = "") -> JSONResponse:
    names = [n.strip() for n in runs.split(",") if n.strip()]
    rows = []
    for n in names:
        exp = load_experiment(n)
        if exp is None:
            continue
        overall = exp["metrics"].get("overall", {})
        meta = exp.get("meta", {})
        rows.append(
            {
                "name": n,
                "retrieval_mode": meta.get("retrieval_mode", ""),
                "rerank_mode": meta.get("rerank_mode", ""),
                "llm_provider": meta.get("llm_provider", ""),
                "n": overall.get("n"),
                **{k: overall.get(k) for k, _ in CORE_METRICS},
            }
        )
    return JSONResponse({"columns": [lbl for _, lbl in CORE_METRICS], "rows": rows})


# ═══════════════════════════ 前端（v5 学术风单页） ═══════════════════════════

_INDEX_HTML = r"""<!DOCTYPE html>
<html lang="zh"><head><meta charset="utf-8"><title>Eval Browser</title>
<style>
  body { font-family: "Source Serif Pro","Noto Serif SC",Georgia,serif; margin:0; color:#3a352d;
         background:#faf8f4; display:flex; min-height:100vh; }
  #side { width:300px; background:#f3efe6; border-right:1px solid #ddd5c6; padding:16px; overflow:auto; }
  #side h1 { font-size:17px; color:#4a6a94; border-bottom:2px solid #7E9CC0; padding-bottom:6px; }
  .exp { padding:6px 8px; margin:4px 0; background:#fffdf9; border:1px solid #ddd5c6; border-radius:5px; cursor:pointer; }
  .exp:hover { background:#eef3f9; }
  .exp input { margin-right:6px; }
  .exp .m { color:#8a8378; font-size:11px; }
  #main { flex:1; padding:24px 30px; overflow:auto; }
  h2 { font-size:18px; color:#4a6a94; }
  table { border-collapse:collapse; width:100%; font-size:13px; background:#fffdf9; }
  th,td { border:1px solid #ddd5c6; padding:5px 8px; text-align:center; }
  th { background:#f0ebdf; }
  td.rowname { text-align:left; font-weight:600; }
  .take { background:#eef3f9; border-left:4px solid #7E9CC0; padding:10px 14px; margin:12px 0; }
  .meta { color:#8a8378; font-size:12px; }
  .qa { border:1px solid #ddd5c6; border-radius:6px; margin:10px 0; background:#fffdf9; }
  .qa summary { cursor:pointer; padding:8px 12px; font-weight:600; background:#f0ebdf; }
  .qa .body { padding:10px 14px; font-size:13px; }
  .lbl { color:#8a8378; font-weight:700; }
  .bad { background:#f5e9e7; color:#a2503f; }
  .ok { background:#e6f0e8; color:#3d7a4e; }
  pre { white-space:pre-wrap; background:#f7f4ec; padding:8px; border-radius:4px; font-size:12px; }
  button { font-family:inherit; background:#7E9CC0; color:#fff; border:none; border-radius:4px; padding:6px 14px; cursor:pointer; }
  button:hover { background:#6b89ad; }
  .tab { display:inline-block; padding:6px 14px; margin-right:6px; cursor:pointer; border-bottom:2px solid transparent; }
  .tab.active { border-bottom:2px solid #7E9CC0; color:#4a6a94; font-weight:700; }
</style></head><body>
<div id="side">
  <h1>Eval Browser</h1>
  <div class="meta" id="count"></div>
  <div style="margin:8px 0"><button onclick="renderCompare()">对比选中</button></div>
  <div id="list"></div>
</div>
<div id="main"><h2>加载中…</h2></div>
<script>
const CORE=[["correctness_pct","correctness"],["hit_at_k_pct","hit@k"],["context_precision_pct","ctx_precision"],["context_recall_pct","ctx_recall"],["faithfulness_avg_pct","faithfulness"],["hallucination_rate_pct","hallucination"],["citation_accuracy_pct","citation"],["rouge_l_pct","rouge_l"]];
let exps=[];
function esc(s){return (s==null?"":String(s)).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");}
function pct(v){return v==null?"—":(Number(v)).toFixed(1)+"%";}
async function loadExps(){const r=await fetch("/api/experiments");const d=await r.json();exps=d.experiments;
  document.getElementById("count").textContent=exps.length+" 个实验";
  const list=document.getElementById("list");
  list.innerHTML=exps.map((e,i)=>`<div class="exp"><input type="checkbox" id="c${i}"><span onclick="showExp('${esc(e.name)}')">${esc(e.name)}</span><div class="m">${esc(e.retrieval_mode||"")} ${esc(e.rerank_mode||"")} ${esc(e.llm_provider||"")} · n=${e.n||"—"} · corr=${pct(e.correctness)}</div></div>`).join("");
}
function selected(){const out=[];exps.forEach((e,i)=>{if(document.getElementById("c"+i).checked)out.push(e.name);});return out;}
async function renderCompare(){const names=selected();if(!names.length){alert("先勾选实验");return;}
  const r=await fetch("/api/compare?runs="+encodeURIComponent(names.join(",")));const d=await r.json();
  let html="<h2>对比表</h2><table><tr><th>实验</th><th>检索</th><th>重排</th><th>n</th>"+d.columns.map(c=>`<th>${c}</th>`).join("")+"</tr>";
  for(const row of d.rows){html+=`<tr><td class="rowname">${esc(row.name)}</td><td>${esc(row.retrieval_mode||"")}</td><td>${esc(row.rerank_mode||"")}</td><td>${row.n}</td>`+d.columns.map(c=>{const k=Object.keys(row).find(kk=>kk.endsWith("_pct")&&CORE.some(cc=>cc[1]===c)&&row[kk]!=null);return `<td>${pct(row[c])}</td>`;}).join("")+"</tr>";}
  html+="</table>";
  document.getElementById("main").innerHTML=html;
}
async function showExp(name){const r=await fetch("/api/experiments/"+encodeURIComponent(name));const d=await r.json();
  const o=d.metrics&&d.metrics.overall||{};
  let html=`<h2>${esc(name)}</h2><div class="meta">检索=${esc(d.meta.retrieval_mode||"—")} 重排=${esc(d.meta.rerank_mode||"—")} agent=${esc(d.meta.agent_mode||"—")} 考生=${esc(d.meta.llm_provider||"—")} 题型=${esc(d.meta.type_filter||"—")} n=${o.n||"—"}</div>`;
  html+="<table><tr>"+CORE.map(c=>`<th>${c[1]}</th>`).join("")+"</tr><tr>"+CORE.map(c=>`<td>${pct(o[c[0]])}</td>`).join("")+"</tr></table>";
  html+="<h2>逐题（"+d.questions.length+"）</h2>";
  for(const q of d.questions){
    let ctx="";try{ctx=JSON.stringify(JSON.parse(q.retrieved_contexts_json||"[]"),null,1);}catch(e){ctx=q.retrieved_contexts_json||"";}
    let tr="";try{tr=JSON.stringify(JSON.parse(q.agent_traces_json||"[]"),null,1);}catch(e){tr=q.agent_traces_json||"";}
    html+=`<details class="qa"><summary>#${esc(q.index)} ${esc(q.correctness)} · ${esc((q.question||"").slice(0,60))}</summary><div class="body">
      <div><span class="lbl">问题：</span>${esc(q.question)}</div>
      <div><span class="lbl">GT：</span>${esc(q.ground_truth)}</div>
      <div><span class="lbl">答案：</span>${esc(q.answer)}</div>
      <div><span class="lbl">裁判理由：</span>${esc(q.judge_reason)}</div>
      <div><span class="lbl">裁判思考：</span><pre>${esc(q.judge_reasoning||"")}</pre></div>
      <div><span class="lbl">考生思考：</span><pre>${esc(q.answer_reasoning||"")}</pre></div>
      <div><span class="lbl">检索证据：</span><pre>${esc(ctx)}</pre></div>
      <div><span class="lbl">Agent 轨迹：</span><pre>${esc(tr)}</pre></div>
    </div></details>`;
  }
  document.getElementById("main").innerHTML=html;
}
loadExps();
</script></body></html>"""


@app.get("/", response_class=HTMLResponse)
def index() -> HTMLResponse:
    return HTMLResponse(_INDEX_HTML)


# ═══════════════════════════ 报告导出（v5 静态 HTML） ═══════════════════════════

@app.get("/api/report", response_class=HTMLResponse)
def api_report() -> Response:
    exps = scan_experiments()
    # 按 correctness 降序排列
    exps = sorted(exps, key=lambda e: (e.get("correctness") is None, -(e.get("correctness") or 0)))
    rows = "".join(
        f"<tr><td class='rowname'>{e['name']}</td><td>{e.get('retrieval_mode','')}</td>"
        f"<td>{e.get('rerank_mode','')}</td><td>{e.get('n','')}</td>"
        f"<td class='acc'>{e.get('correctness')}</td><td>{e.get('hit_at_k')}</td>"
        f"<td>{e.get('faithfulness')}</td><td>{e.get('hallucination')}</td></tr>"
        for e in exps
    )
    html = f"""<!DOCTYPE html><html lang="zh"><head><meta charset="utf-8"><title>评测结果报告</title>
<style>body{{font-family:"Source Serif Pro","Noto Serif SC",Georgia,serif;margin:0 auto;max-width:860px;padding:40px 28px;color:#3a352d;line-height:1.65;background:#faf8f4}}
h1{{font-size:26px;border-bottom:2px solid #7E9CC0;padding-bottom:8px}}h2{{font-size:19px;color:#4a6a94;margin-top:36px}}
table{{border-collapse:collapse;width:100%;font-size:13.5px;background:#fffdf9}}th,td{{border:1px solid #ddd5c6;padding:5px 9px;text-align:center}}th{{background:#f0ebdf}}
td.rowname{{text-align:left;font-weight:600}}td.acc{{font-weight:700}}.meta{{color:#8a8378;font-size:12.5px}}</style></head><body>
<h1>评测结果报告</h1><p class="meta">自动生成 · 共 {len(exps)} 个实验</p>
<h2>实验指标总览</h2><table><tr><th>实验</th><th>检索</th><th>重排</th><th>n</th><th>correctness</th><th>hit@k</th><th>faithfulness</th><th>hallucination</th></tr>
{rows}</table></body></html>"""
    return HTMLResponse(html)


if __name__ == "__main__":
    import uvicorn

    p = argparse.ArgumentParser(description="Eval 结果浏览器")
    p.add_argument("--host", default="0.0.0.0")
    p.add_argument("--port", default=8765, type=int)
    args = p.parse_args()
    print(f"Eval Browser: http://localhost:{args.port}")
    print(f"报告导出: http://localhost:{args.port}/api/report")
    uvicorn.run(app, host=args.host, port=args.port)
