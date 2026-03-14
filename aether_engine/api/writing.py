"""
写作辅助 API
支持错别字检测、病句检测、润色与续写。
"""

import logging
import os
import re
from typing import List, Dict, Any, Optional
from urllib.parse import quote_plus

import httpx

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from core.session import get_session_id

router = APIRouter(prefix="/writing", tags=["writing"])
logger = logging.getLogger("aether")


class WritingAssistRequest(BaseModel):
    action: str  # spell | grammar | polish | continue
    text: str
    context: str = ""


class InlineAssistRequest(BaseModel):
    """行内助手：自然语言指令 + 当前段落/全文，由状态机映射到 action。"""
    command: str
    text: str
    context: str = ""
    max_tokens: int = 1200  # 建议文本最大 token 数，可调（如 800/1200/2000）


class ResolveCitationRequest(BaseModel):
    """解析引用：根据标题或 DOI 获取文献元数据。"""
    title: str
    doi: Optional[str] = None


def _resolve_inline_action(command: str) -> str:
    """根据用户指令解析为 writing action（续写/润色/纠错/病句）。"""
    c = (command or "").strip().lower()
    if not c:
        return "continue"
    if "润色" in c or "优化" in c or "改写" in c:
        return "polish"
    if "错别字" in c or "纠错" in c or "拼写" in c:
        return "spell"
    if "病句" in c or "语法" in c:
        return "grammar"
    if "续写" in c or "继续" in c or "写" in c or "卡片" in c or "结合" in c:
        return "continue"
    return "continue"


def _tokenize(text: str) -> List[str]:
    return [
        t
        for t in re.findall(r"[a-zA-Z0-9\-\u4e00-\u9fff]+", (text or "").lower())
        if len(t) > 1
    ]


def _token_overlap_score(query: str, text: str) -> float:
    q_tokens = set(_tokenize(query))
    if not q_tokens:
        return 0.0
    txt = (text or "").lower()
    hit = sum(1 for t in q_tokens if t in txt)
    return hit / len(q_tokens)


def _search_arxiv_external(query: str, limit: int = 2) -> List[Dict[str, Any]]:
    url = f"https://export.arxiv.org/api/query?search_query=all:{quote_plus(query)}&start=0&max_results={limit}&sortBy=relevance"
    out: List[Dict[str, Any]] = []
    try:
        resp = httpx.get(url, timeout=10.0)
        resp.raise_for_status()
        entries = re.findall(r"<entry>(.*?)</entry>", resp.text, re.DOTALL)
        for e in entries[:limit]:
            title_m = re.search(r"<title>(.*?)</title>", e, re.DOTALL)
            abs_m = re.search(r"<summary>(.*?)</summary>", e, re.DOTALL)
            id_m = re.search(r"<id>(.*?)</id>", e, re.DOTALL)
            title = re.sub(r"\s+", " ", (title_m.group(1) if title_m else "")).strip()
            abstract = re.sub(r"\s+", " ", (abs_m.group(1) if abs_m else "")).strip()
            raw_id = id_m.group(1) if id_m else ""
            aid = raw_id.split("/abs/")[-1] if "/abs/" in raw_id else raw_id
            out.append(
                {
                    "title": title,
                    "summary": abstract,
                    "url": f"https://arxiv.org/abs/{aid}" if aid else "",
                    "source": "arxiv",
                    "score": round(
                        0.5 + 0.5 * _token_overlap_score(query, f"{title} {abstract}"),
                        4,
                    ),
                }
            )
    except Exception as e:
        logger.warning("写作续写 ArXiv 检索失败: %s", e)
    return out


def _search_semantic_scholar(query: str, limit: int = 2) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    try:
        url = "https://api.semanticscholar.org/graph/v1/paper/search"
        params = {
            "query": query,
            "limit": limit,
            "fields": "title,abstract,year,url,citationCount",
        }
        resp = httpx.get(url, params=params, timeout=10.0)
        resp.raise_for_status()
        for p in (resp.json().get("data") or [])[:limit]:
            title = p.get("title", "")
            abstract = p.get("abstract", "") or ""
            score = 0.45 + 0.55 * _token_overlap_score(query, f"{title} {abstract}")
            out.append(
                {
                    "title": title,
                    "summary": abstract,
                    "url": p.get("url", ""),
                    "source": "semantic_scholar",
                    "score": round(score, 4),
                }
            )
    except Exception as e:
        logger.warning("写作续写 Semantic Scholar 检索失败: %s", e)
    return out


def _normalize_citation(
    title: str = "",
    authors: str = "",
    year: str = "",
    doi: str = "",
    url: str = "",
    journal: str = "",
    source: str = "",
) -> Dict[str, Any]:
    """统一引用结构，缺失键用空字符串。"""
    return {
        "title": (title or "").strip(),
        "authors": (authors or "").strip(),
        "year": (year or "").strip(),
        "doi": (doi or "").strip(),
        "url": (url or "").strip(),
        "journal": (journal or "").strip(),
        "source": (source or "").strip(),
    }


def _resolve_citation_crossref(title: str, doi: Optional[str] = None) -> Optional[Dict[str, Any]]:
    """通过 Crossref 解析引用（DOI 或标题查询），返回单个最佳匹配。"""
    try:
        if doi and doi.strip():
            # 按 DOI 直接查询
            clean_doi = doi.strip().replace("https://doi.org/", "").strip()
            url = f"https://api.crossref.org/works/{quote_plus(clean_doi)}"
            resp = httpx.get(url, timeout=10.0)
            resp.raise_for_status()
            data = resp.json()
            item = data.get("message")
        else:
            if not (title or "").strip():
                return None
            url = "https://api.crossref.org/works"
            params = {"query.title": (title or "").strip(), "rows": 1}
            resp = httpx.get(url, params=params, timeout=10.0)
            resp.raise_for_status()
            data = resp.json()
            items = data.get("message", {}).get("items") or []
            if not items:
                return None
            item = items[0]

        # 解析 item
        raw_title = (item.get("title") or [""])[0] or ""
        raw_doi = item.get("DOI") or ""
        raw_url = item.get("URL") or ("https://doi.org/" + raw_doi if raw_doi else "")
        authors_list = item.get("author") or []
        author_parts = []
        for a in authors_list[:10]:
            family = a.get("family", "")
            given = a.get("given", "")
            author_parts.append(f"{given} {family}".strip() or family)
        authors_str = ", ".join(author_parts) if author_parts else ""
        published = item.get("published") or {}
        date_parts = (published.get("date-parts") or [[]])[0]
        year_str = str(date_parts[0]) if date_parts else ""
        container = (item.get("container-title") or [""])[0] or ""

        return _normalize_citation(
            title=raw_title,
            authors=authors_str,
            year=year_str,
            doi=raw_doi,
            url=raw_url,
            journal=container,
            source="crossref",
        )
    except Exception as e:
        logger.warning("Crossref 解析引用失败: %s", e)
        return None


def _resolve_citation_semantic_scholar(title: str) -> Optional[Dict[str, Any]]:
    """通过 Semantic Scholar 按标题解析引用，返回单个最佳匹配。"""
    if not (title or "").strip():
        return None
    try:
        url = "https://api.semanticscholar.org/graph/v1/paper/search"
        params = {
            "query": (title or "").strip(),
            "limit": 1,
            "fields": "title,year,url,authors,citationCount",
        }
        resp = httpx.get(url, params=params, timeout=10.0)
        resp.raise_for_status()
        data = resp.json()
        papers = data.get("data") or []
        if not papers:
            return None
        p = papers[0]
        raw_title = p.get("title") or ""
        raw_year = p.get("year")
        year_str = str(raw_year) if raw_year is not None else ""
        raw_url = p.get("url") or ""
        authors_list = p.get("authors") or []
        authors_str = ", ".join((a.get("name") or "").strip() for a in authors_list if a.get("name")) if authors_list else ""

        return _normalize_citation(
            title=raw_title,
            authors=authors_str,
            year=year_str,
            doi="",
            url=raw_url,
            journal="",
            source="semantic_scholar",
        )
    except Exception as e:
        logger.warning("Semantic Scholar 解析引用失败: %s", e)
        return None


def _retrieve_rag_context(
    query: str, top_k: int = 6, session_id: str = "default"
) -> Dict[str, Any]:
    results: List[Dict[str, Any]] = []

    try:
        from service.note_rag import get_note_rag
        note_rag = get_note_rag(session_id)
        results.extend(note_rag.search(query, top_k=top_k))
    except Exception as e:
        logger.warning("续写 NoteRAG 检索失败: %s", e)

    try:
        from service.doc_rag import get_document_rag
        doc_rag = get_document_rag(session_id)
        results.extend(doc_rag.search(query, top_k=top_k))
    except Exception as e:
        logger.warning("续写 DocumentRAG 检索失败: %s", e)

    results = sorted(results, key=lambda x: x.get("score", 0), reverse=True)[:top_k]
    context_parts = []
    sources = []
    for i, r in enumerate(results):
        title = r.get("doc_title") or "本地知识库"
        source_label = f"[来源{i + 1}: {title}]"
        context_parts.append(f"{source_label}\n{(r.get('summary') or '')[:700]}")
        sources.append(
            {
                "title": title,
                "concept": r.get("concept", ""),
                "score": r.get("score", 0),
                "source": r.get("source", "local_rag"),
            }
        )

    # 学术 API 作为补充来源（仅续写）
    academic = []
    academic.extend(_search_arxiv_external(query, limit=2))
    academic.extend(_search_semantic_scholar(query, limit=2))
    academic = sorted(academic, key=lambda x: x.get("score", 0), reverse=True)[:2]
    for i, a in enumerate(academic):
        context_parts.append(
            f"[外部来源{i + 1}: {a.get('title', '未知')} ({a.get('source', 'api')})]\n{(a.get('summary') or '')[:500]}"
        )
        sources.append(
            {
                "title": a.get("title", ""),
                "concept": a.get("source", "academic_api"),
                "score": a.get("score", 0),
                "source": a.get("source", "academic_api"),
                "url": a.get("url", ""),
            }
        )

    return {
        "context": "\n\n".join(context_parts),
        "sources": sources[:8],
        "used_rag": len(results) > 0,
        "used_academic_api": len(academic) > 0,
    }


def _call_deepseek(system_prompt: str, user_prompt: str, max_tokens: int = 1200) -> str:
    api_key = os.getenv("DEEPSEEK_API_KEY")
    api_base = os.getenv("DEEPSEEK_API_BASE", "https://api.deepseek.com")
    if not api_key:
        return ""

    from openai import OpenAI

    client = OpenAI(api_key=api_key, base_url=api_base)
    resp = client.chat.completions.create(
        model="deepseek-chat",
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        temperature=0.3,
        max_tokens=max(256, min(4000, max_tokens)),
    )
    return resp.choices[0].message.content.strip()


def _do_writing_assist(
    action: str,
    text: str,
    context: str,
    session_id: str,
    max_tokens: int = 1200,
) -> dict:
    """内部：执行写作辅助（供 /assist 与 /inline 共用）。"""
    prompts = {
        "spell": "你是中文写作纠错助手。只返回修订后的正文，不要加解释。",
        "grammar": "你是中文病句诊断助手。只返回修订后的正文，不要加解释。",
        "polish": "你是学术中文润色助手。保持原意、术语准确、句式简洁。只返回润色后正文。",
        "continue": "你是学术写作续写助手。严格根据给定文本与RAG证据续写1-2段，保证结构完整并在必要处标注[来源: 标题]。",
    }
    if action not in prompts:
        raise HTTPException(status_code=400, detail="不支持的 action")

    rag_context = {
        "context": "",
        "sources": [],
        "used_rag": False,
        "used_academic_api": False,
    }
    user_prompt = f"文本:\n{text}\n\n上下文:\n{context[:3000]}"
    if action == "continue":
        rag_context = _retrieve_rag_context(text, top_k=6, session_id=session_id)
        user_prompt = (
            f"待续写文本:\n{text}\n\n"
            f"编辑器上下文:\n{context[:2500]}\n\n"
            f"RAG检索证据:\n{rag_context['context'][:4500]}\n\n"
            "要求:\n"
            "1) 优先补全标题“研究问题”后的内容\n"
            "2) 保持学术写作语气\n"
            "3) 如引用证据，在句末用[来源: 标题]标记"
        )

    result = _call_deepseek(prompts[action], user_prompt, max_tokens=max_tokens)
    if not result:
        if action == "continue":
            result = (
                "### 研究问题\n"
                "基于现有研究脉络，本文将重点回答三个问题："
                "（1）该方法在目标任务上的核心优势是什么；"
                "（2）与主流基线相比在效率与精度上的权衡如何；"
                "（3）在真实应用场景下仍存在哪些可解释性与泛化能力挑战。"
            )
        else:
            result = text

    before = re.sub(r"\s+", "", text)
    after = re.sub(r"\s+", "", result)
    changed = before != after

    if action in ("spell", "grammar") and not changed:
        message = "原文格式规范，无需修改。"
    elif action == "continue":
        message = "已基于本地RAG证据完成续写。"
    else:
        message = "任务完成。"

    return {
        "action": action,
        "result": result,
        "changed": changed,
        "message": message,
        "sources": rag_context.get("sources", []),
        "used_rag": rag_context.get("used_rag", False),
        "used_academic_api": rag_context.get("used_academic_api", False),
    }


@router.post("/assist")
def writing_assist(body: WritingAssistRequest, session_id: str = Depends(get_session_id)):
    if not body.text.strip():
        raise HTTPException(status_code=400, detail="文本不能为空")
    return _do_writing_assist(body.action, body.text, body.context, session_id)


@router.post("/inline")
def writing_inline(body: InlineAssistRequest, session_id: str = Depends(get_session_id)):
    """行内助手：指令映射到 action，返回建议文本（Ghost Text 用）。max_tokens 控制建议长度。"""
    if not body.text.strip():
        raise HTTPException(status_code=400, detail="文本不能为空")
    action = _resolve_inline_action(body.command)
    return _do_writing_assist(action, body.text, body.context, session_id, max_tokens=body.max_tokens)


@router.post("/resolve-citation")
def resolve_citation(body: ResolveCitationRequest):
    """
    根据 title 和可选的 doi 解析引用元数据。
    先尝试 Crossref（支持 DOI 或标题），失败时回退到 Semantic Scholar（按标题）。
    返回单个最佳匹配：title, authors, year, doi, url, journal, source。
    """
    title = (body.title or "").strip()
    doi = (body.doi or "").strip() or None
    if not title and not doi:
        raise HTTPException(status_code=400, detail="请提供 title 或 doi")

    result = _resolve_citation_crossref(title, doi)
    if result is None and title:
        result = _resolve_citation_semantic_scholar(title)
    if result is None:
        raise HTTPException(status_code=404, detail="未找到匹配的引用")
    return result
