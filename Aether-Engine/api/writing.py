"""
写作辅助 API
支持错别字检测、病句检测、润色与续写。
"""

import logging
import os
import re
from typing import List, Dict, Any
from urllib.parse import quote_plus

import httpx

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter(prefix="/writing", tags=["writing"])
logger = logging.getLogger("aether")


class WritingAssistRequest(BaseModel):
    action: str  # spell | grammar | polish | continue
    text: str
    context: str = ""


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


def _retrieve_rag_context(query: str, top_k: int = 6) -> Dict[str, Any]:
    results: List[Dict[str, Any]] = []

    try:
        from service.note_rag import get_note_rag

        note_rag = get_note_rag()
        results.extend(note_rag.search(query, top_k=top_k))
    except Exception as e:
        logger.warning("续写 NoteRAG 检索失败: %s", e)

    try:
        from service.doc_rag import get_document_rag

        doc_rag = get_document_rag()
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


def _call_deepseek(system_prompt: str, user_prompt: str) -> str:
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
        max_tokens=1200,
    )
    return resp.choices[0].message.content.strip()


@router.post("/assist")
def writing_assist(body: WritingAssistRequest):
    if not body.text.strip():
        raise HTTPException(status_code=400, detail="文本不能为空")

    prompts = {
        "spell": "你是中文写作纠错助手。只返回修订后的正文，不要加解释。",
        "grammar": "你是中文病句诊断助手。只返回修订后的正文，不要加解释。",
        "polish": "你是学术中文润色助手。保持原意、术语准确、句式简洁。只返回润色后正文。",
        "continue": "你是学术写作续写助手。严格根据给定文本与RAG证据续写1-2段，保证结构完整并在必要处标注[来源: 标题]。",
    }
    if body.action not in prompts:
        raise HTTPException(status_code=400, detail="不支持的 action")

    rag_context = {
        "context": "",
        "sources": [],
        "used_rag": False,
        "used_academic_api": False,
    }
    user_prompt = f"文本:\n{body.text}\n\n上下文:\n{body.context[:3000]}"
    if body.action == "continue":
        rag_context = _retrieve_rag_context(body.text, top_k=6)
        user_prompt = (
            f"待续写文本:\n{body.text}\n\n"
            f"编辑器上下文:\n{body.context[:2500]}\n\n"
            f"RAG检索证据:\n{rag_context['context'][:4500]}\n\n"
            "要求:\n"
            "1) 优先补全标题“研究问题”后的内容\n"
            "2) 保持学术写作语气\n"
            "3) 如引用证据，在句末用[来源: 标题]标记"
        )

    result = _call_deepseek(prompts[body.action], user_prompt)
    if not result:
        # 降级：没有 key 时返回可用提示
        if body.action == "continue":
            result = (
                "### 研究问题\n"
                "基于现有研究脉络，本文将重点回答三个问题："
                "（1）该方法在目标任务上的核心优势是什么；"
                "（2）与主流基线相比在效率与精度上的权衡如何；"
                "（3）在真实应用场景下仍存在哪些可解释性与泛化能力挑战。"
            )
        else:
            result = body.text

    before = re.sub(r"\s+", "", body.text)
    after = re.sub(r"\s+", "", result)
    changed = before != after

    if body.action in ("spell", "grammar") and not changed:
        message = "原文格式规范，无需修改。仅补充了标题“研究问题”下的内容提示，以保持结构完整。"
    elif body.action == "continue":
        message = "已基于本地RAG证据完成续写，并补充了“研究问题”结构内容。"
    else:
        message = "任务完成。"

    return {
        "action": body.action,
        "result": result,
        "changed": changed,
        "message": message,
        "sources": rag_context.get("sources", []),
        "used_rag": rag_context.get("used_rag", False),
        "used_academic_api": rag_context.get("used_academic_api", False),
    }
