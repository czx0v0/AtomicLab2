"""
Markdown → IEEEtran LaTeX + references.bib（Crossref）+ ZIP 打包。
供 /api/export/latex_zip 与 Agent 工具 export_latex 使用。
"""
from __future__ import annotations

import io
import logging
import os
import re
import zipfile
from typing import Any, Dict, List, Optional, Tuple

import httpx

logger = logging.getLogger("aether")

UUID_RE = re.compile(
    r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"
)
CARD_LINK_RE = re.compile(r"card://([0-9a-fA-F-]{36})", re.I)
REF_NUM_RE = re.compile(r"\[(\d+)\]")


def _call_deepseek(system: str, user: str, max_tokens: int = 8000) -> str:
    api_key = os.getenv("DEEPSEEK_API_KEY")
    api_base = os.getenv("DEEPSEEK_API_BASE", "https://api.deepseek.com")
    if not api_key:
        return ""
    from openai import OpenAI

    client = OpenAI(api_key=api_key, base_url=api_base)
    resp = client.chat.completions.create(
        model="deepseek-chat",
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        temperature=0.2,
        max_tokens=max_tokens,
    )
    return (resp.choices[0].message.content or "").strip()


def _strip_code_fences(s: str) -> str:
    s = s.strip()
    s = re.sub(r"^```(?:latex|tex)?\s*", "", s, flags=re.I)
    s = re.sub(r"\s*```\s*$", "", s)
    return s.strip()


def markdown_to_ieee_tex(markdown: str) -> str:
    """
    将 Markdown 转为完整可编译的 IEEEtran 双栏论文骨架（含导言区）。
    """
    md = (markdown or "").strip()
    if not md:
        return _minimal_tex("Empty document.")

    system = (
        "你是 LaTeX 与 IEEE 会议排版专家。必须输出**完整可编译**的 IEEEtran 论文，"
        "包含导言区与正文。\n"
        "硬性要求：\n"
        "1) 第一行必须是 \\documentclass[conference]{IEEEtran}\n"
        "2) \\usepackage{amsmath,amssymb,graphicx,hyperref,cite,booktabs}\n"
        "3) 使用 \\title{}、\\author{}（可用 \\IEEEauthorblockN 与 \\IEEEauthorblockA 排作者单位）、\\maketitle\n"
        "4) 将 Markdown 的 # / ## / ### 转为 \\section / \\subsection / \\subsubsection\n"
        "5) 粗体 \\textbf{}，列表 itemize/enumerate，行内数学 $...$，独立公式 equation 或 align\n"
        "6) 对 _ % & # $ 等符号正确转义\n"
        "7) 文末写 \\bibliographystyle{IEEEtran} 与 \\bibliography{references}（不要 \\begin{thebibliography}）\n"
        "8) 不要输出任何 Markdown 代码块标记，只输出纯 LaTeX 源码。"
    )
    user = f"以下为用户 Markdown 草稿，请转换为 IEEE 会议 LaTeX：\n\n{md[:120000]}"
    out = _call_deepseek(system, user, max_tokens=8000)
    out = _strip_code_fences(out)
    if not out or "\\documentclass" not in out:
        return _fallback_md_to_tex(md)
    if "\\bibliography{references}" not in out:
        out = out.rstrip() + "\n\n\\bibliographystyle{IEEEtran}\n\\bibliography{references}\n"
    return out


def _minimal_tex(body: str) -> str:
    esc = body.replace("\\", "\\textbackslash{}").replace("_", "\\_").replace("%", "\\%")
    return (
        "\\documentclass[conference]{IEEEtran}\n"
        "\\usepackage{amsmath,amssymb,graphicx,hyperref,cite,booktabs}\n"
        "\\begin{document}\n"
        "\\title{Draft}\n"
        "\\author{Anonymous}\n"
        "\\maketitle\n\n"
        f"{esc}\n\n"
        "\\bibliographystyle{IEEEtran}\n"
        "\\bibliography{references}\n"
        "\\end{document}\n"
    )


def _fallback_md_to_tex(md: str) -> str:
    """无 LLM 时的极简转换。"""
    lines = md.split("\n")
    out_lines = []
    for line in lines:
        line = line.rstrip()
        if line.startswith("### "):
            out_lines.append("\\subsubsection{" + _tex_escape(line[4:]) + "}")
        elif line.startswith("## "):
            out_lines.append("\\subsection{" + _tex_escape(line[3:]) + "}")
        elif line.startswith("# "):
            out_lines.append("\\section{" + _tex_escape(line[2:]) + "}")
        elif line.strip():
            out_lines.append(_tex_escape(line))
        else:
            out_lines.append("")
    body = "\n\n".join(out_lines) if out_lines else "(empty)"
    return _minimal_tex(body)


def _tex_escape(s: str) -> str:
    """极简转义（fallback）；避免破坏已生成的 LaTeX 命令。"""
    return (
        s.replace("&", "\\&")
        .replace("%", "\\%")
        .replace("$", "\\$")
        .replace("#", "\\#")
        .replace("_", "\\_")
        .replace("{", "\\{")
        .replace("}", "\\}")
    )


def extract_note_ids_from_markdown(markdown: str) -> List[str]:
    """从草稿中提取知识卡片 / 笔记 ID（去重保序）。"""
    text = markdown or ""
    seen = set()
    order: List[str] = []
    for m in CARD_LINK_RE.finditer(text):
        nid = m.group(1)
        if nid not in seen:
            seen.add(nid)
            order.append(nid)
    for m in UUID_RE.finditer(text):
        nid = m.group(0)
        if nid not in seen:
            seen.add(nid)
            order.append(nid)
    return order[:64]


def _load_notes_map(session_id: Optional[str]) -> Dict[str, dict]:
    from api.notes import _load_notes

    notes = _load_notes(session_id)
    return {str(n.get("id")): n for n in notes if n.get("id")}


def _title_for_note(note: dict) -> str:
    for k in ("axiom", "content", "title"):
        v = note.get(k)
        if isinstance(v, str) and v.strip():
            t = v.strip().split("\n")[0][:200]
            return t
    return "Untitled"


def _crossref_bibtex(cite_key: str, title: str) -> Optional[str]:
    """用标题查询 Crossref，返回一条 BibTeX 字符串。"""
    title = (title or "").strip()
    if len(title) < 6:
        return None
    try:
        with httpx.Client(timeout=12.0) as client:
            r = client.get(
                "https://api.crossref.org/works",
                params={"query.bibliographic": title, "rows": 3},
            )
            r.raise_for_status()
            data = r.json()
            items = data.get("message", {}).get("items") or []
            if not items:
                return None
            it = items[0]
            tit = (it.get("title") or [""])[0]
            doi = it.get("DOI") or ""
            year = None
            try:
                year = it["published"]["date-parts"][0][0]
            except (KeyError, IndexError, TypeError):
                year = it.get("issued", {}).get("date-parts", [[None]])[0][0]
            authors = it.get("author") or []
            if authors:
                parts = []
                for a in authors[:20]:
                    fam = (a.get("family") or "").strip()
                    giv = (a.get("given") or "").strip()
                    if fam:
                        parts.append(f"{fam}, {giv}".strip().rstrip(","))
                auth_str = " and ".join(parts) if parts else "Anonymous"
            else:
                auth_str = "Anonymous"
            safe_key = re.sub(r"[^a-zA-Z0-9_]", "", cite_key)[:40] or "ref"
            bib = (
                f"@article{{{safe_key},\n"
                f"  title = {{{tit}}},\n"
                f"  author = {{{auth_str}}},\n"
                f"  year = {{{year or ''}}},\n"
                f"  doi = {{{doi}}},\n"
                f"}}\n"
            )
            return bib
    except Exception as e:
        logger.warning("Crossref lookup failed for %s: %s", title[:40], e)
    return None


def build_references_bib(markdown: str, session_id: Optional[str]) -> str:
    """
    根据草稿中出现的笔记 ID 拉取标题，经 Crossref 生成 BibTeX。
    无匹配时生成占位 @misc。
    """
    ids = extract_note_ids_from_markdown(markdown)
    nmap = _load_notes_map(session_id)
    chunks: List[str] = []
    for i, nid in enumerate(ids):
        note = nmap.get(nid) or {}
        title = _title_for_note(note)
        key = f"note{i + 1}_{nid[:8]}"
        bib = _crossref_bibtex(key, title)
        if bib:
            chunks.append(bib)
        else:
            chunks.append(
                f"@misc{{{key},\n"
                f"  title = {{{_tex_escape(title)}}},\n"
                f"  note = {{Local knowledge card {nid}}},\n"
                f"}}\n"
            )
    if not chunks:
        chunks.append(
            "% Auto-generated placeholder — add citations from editor\n"
            "@misc{placeholder,\n"
            "  title = {References},\n"
            "  note = {No linked cards found in draft},\n"
            "}\n"
        )
    return "\n".join(chunks)


def build_latex_zip_bytes(markdown: str, session_id: Optional[str]) -> Tuple[bytes, Dict[str, Any]]:
    """生成 ZIP：main.tex + references.bib + README.txt"""
    main_tex = markdown_to_ieee_tex(markdown)
    # 统一主文件名为 main.tex（便于 Overleaf）
    if "\\documentclass" not in main_tex:
        main_tex = _fallback_md_to_tex(markdown)

    bib = build_references_bib(markdown, session_id)
    readme = (
        "AtomicLab LaTeX export\n"
        "- main.tex: IEEEtran skeleton from Markdown\n"
        "- references.bib: BibTeX from linked cards + Crossref\n"
        "Compile with pdflatex + bibtex, or upload folder to Overleaf.\n"
    )
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("main.tex", main_tex.encode("utf-8"))
        zf.writestr("references.bib", bib.encode("utf-8"))
        zf.writestr("README.txt", readme.encode("utf-8"))
    meta = {
        "main_tex_bytes": len(main_tex.encode("utf-8")),
        "bib_bytes": len(bib.encode("utf-8")),
        "note_ids": extract_note_ids_from_markdown(markdown),
    }
    return buf.getvalue(), meta


def debug_latex_error(error_log: str, latex_snippet: str) -> str:
    """Skill: 根据编译日志给出修改建议 / 补丁说明。"""
    if not (error_log or "").strip():
        return "请粘贴编译错误日志。"
    system = (
        "你是 LaTeX 调试专家。根据 Overleaf/pdflatex 报错日志，指出最可能的原因与具体修改方式。"
        "若有代码片段，给出**替换后的完整相关代码块**。使用中文简述。"
    )
    user = f"报错日志:\n{error_log[:8000]}\n\n相关 LaTeX:\n{(latex_snippet or '')[:12000]}"
    out = _call_deepseek(system, user, max_tokens=3000)
    return out or "（未配置 DEEPSEEK_API_KEY，无法分析。请检查 Missing $、未转义 _、未闭合环境。）"
