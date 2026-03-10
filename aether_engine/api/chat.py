"""
AgenticRAG 聊天 API
多智能体流程：Seeker 检索 → Reviewer 评估 → Synthesizer 合成。
支持自我评分与二次检索。
"""

import json
import logging
import os
import re
from typing import Generator, List, Optional
from urllib.parse import quote_plus

import httpx

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

router = APIRouter(prefix="/chat", tags=["chat"])
logger = logging.getLogger("aether")


def _token_overlap_score(query: str, text: str) -> float:
    """简单的 token 重叠度评分（0~1）。"""
    q_tokens = set(query.lower().split())
    t_tokens = set(text.lower().split())
    if not q_tokens:
        return 0.0
    return len(q_tokens & t_tokens) / len(q_tokens)


class ChatRequest(BaseModel):
    question: str
    history: Optional[List[dict]] = None  # [{"role": "user"|"agent", "content": "..."}]
    top_k: int = 5


class AgentStep(BaseModel):
    agent: str  # seeker | reviewer | synthesizer
    content: str
    related_notes: Optional[List[dict]] = None
    score: Optional[float] = None


class ChatResponse(BaseModel):
    answer: str
    steps: List[AgentStep]
    sources: List[dict]


def _call_deepseek(system_prompt: str, user_prompt: str, max_tokens: int = 1500) -> str:
    """同步调用 DeepSeek API。"""
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
        max_tokens=max_tokens,
        temperature=0.4,
    )
    return resp.choices[0].message.content.strip()


def _stream_deepseek(
    system_prompt: str, user_prompt: str, max_tokens: int = 1500
) -> Generator[str, None, None]:
    """流式调用 DeepSeek API，逐 token yield。"""
    api_key = os.getenv("DEEPSEEK_API_KEY")
    api_base = os.getenv("DEEPSEEK_API_BASE", "https://api.deepseek.com")
    if not api_key:
        return

    from openai import OpenAI

    client = OpenAI(api_key=api_key, base_url=api_base)
    stream = client.chat.completions.create(
        model="deepseek-chat",
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        max_tokens=max_tokens,
        temperature=0.4,
        stream=True,
    )
    for chunk in stream:
        delta = chunk.choices[0].delta
        if delta.content:
            yield delta.content


def _local_hybrid_search(query: str, top_k: int = 5, max_rounds: int = 2) -> List[dict]:
    """
    本地多源多轮混合检索：复用 search.py 的 _search_pipeline。
    通道：文档原文（向量+BM25）+ 笔记卡片（向量+BM25）+ 截图OCR → RRF 融合。
    """
    try:
        from api.search import _search_pipeline

        result = _search_pipeline(query, top_k=top_k, max_rounds=max_rounds)
        return result.get("results", [])
    except Exception as e:
        logger.warning("多源检索管线失败，回退到基础检索: %s", e)

    # 回退：直接走 ChromaDB 向量检索
    merged: List[dict] = []
    try:
        from service.note_rag import get_note_rag

        merged.extend(get_note_rag().search(query, top_k=max(top_k * 2, 8)))
    except Exception:
        pass
    try:
        from service.doc_rag import get_document_rag

        merged.extend(get_document_rag().search(query, top_k=max(top_k * 2, 8)))
    except Exception:
        pass

    # 去重保留最高分
    best = {}
    for item in merged:
        nid = item.get("note_id")
        if not nid:
            continue
        if nid not in best or item.get("score", 0) > best[nid].get("score", 0):
            best[nid] = item

    out = sorted(best.values(), key=lambda x: x.get("score", 0), reverse=True)
    return out[:top_k]


def _search_arxiv_external(query: str, limit: int = 3) -> List[dict]:
    url = f"https://export.arxiv.org/api/query?search_query=all:{quote_plus(query)}&start=0&max_results={limit}&sortBy=relevance"
    out: List[dict] = []
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
                    "note_id": f"arxiv::{aid}",
                    "summary": abstract,
                    "concept": f"arXiv:{title[:40]}",
                    "keywords": [],
                    "doc_title": title,
                    "page_num": 0,
                    "bbox": [],
                    "score": round(
                        0.45
                        + 0.5 * _token_overlap_score(query, title + " " + abstract),
                        4,
                    ),
                    "source": "arxiv",
                    "url": f"https://arxiv.org/abs/{aid}" if aid else "",
                }
            )
    except Exception as e:
        logger.warning("ArXiv 外部检索失败: %s", e)
    return out


def _search_semantic_scholar(query: str, limit: int = 3) -> List[dict]:
    out: List[dict] = []
    try:
        url = "https://api.semanticscholar.org/graph/v1/paper/search"
        params = {
            "query": query,
            "limit": limit,
            "fields": "title,abstract,year,url,citationCount",
        }
        resp = httpx.get(url, params=params, timeout=10.0)
        resp.raise_for_status()
        data = resp.json().get("data", [])
        for p in data[:limit]:
            title = p.get("title", "")
            abstract = p.get("abstract", "") or ""
            cite = p.get("citationCount", 0) or 0
            rel = _token_overlap_score(query, f"{title} {abstract}")
            score = 0.35 + 0.45 * rel + min(cite, 500) / 5000
            out.append(
                {
                    "note_id": f"semanticscholar::{p.get('paperId', title[:20])}",
                    "summary": abstract,
                    "concept": f"S2:{title[:40]}",
                    "keywords": [],
                    "doc_title": title,
                    "page_num": 0,
                    "bbox": [],
                    "score": round(score, 4),
                    "source": "semantic_scholar",
                    "url": p.get("url", ""),
                }
            )
    except Exception as e:
        logger.warning("Semantic Scholar 检索失败: %s", e)
    return out


@router.post("", response_model=ChatResponse)
def chat(body: ChatRequest):
    """
    AgenticRAG 聊天：
    1. Seeker 检索知识库
    2. Reviewer 评估检索质量（自我评分）
    3. 若评分低，Seeker 改写查询二次检索
    4. Synthesizer 基于上下文生成最终答案
    """
    if not body.question.strip():
        raise HTTPException(status_code=400, detail="问题不能为空")

    logger.info("Chat 请求: question='%s'", body.question[:80])

    steps: List[dict] = []
    all_sources: List[dict] = []

    # ── Step 1: Seeker 多源检索 ──────────────────────────────────────────────
    results = _local_hybrid_search(body.question, top_k=body.top_k, max_rounds=2)

    steps.append(
        {
            "agent": "seeker",
            "content": (
                f"多源检索知识库（文档原文+笔记卡片+BM25+向量），找到 {len(results)} 条相关结果。"
                if results
                else "知识库当前为空，建议先上传 PDF 并 CRUSH IT 生成原子卡片。"
            ),
            "related_notes": results[:3],
        }
    )
    all_sources.extend(results)

    # ── Step 1b: 多源外部检索（ArXiv + Semantic Scholar）──────────────────
    external = []
    external.extend(_search_arxiv_external(body.question, limit=3))
    external.extend(_search_semantic_scholar(body.question, limit=3))
    if external:
        external = sorted(external, key=lambda x: x.get("score", 0), reverse=True)[:4]
        all_sources.extend(external)
        src_count = {}
        for e in external:
            src_count[e.get("source", "external")] = (
                src_count.get(e.get("source", "external"), 0) + 1
            )
        steps.append(
            {
                "agent": "seeker",
                "content": "多源检索补充完成："
                + "，".join([f"{k}={v}" for k, v in src_count.items()]),
                "related_notes": external[:3],
            }
        )

    api_key = os.getenv("DEEPSEEK_API_KEY")

    # ── Step 2: Reviewer 自我评分 ────────────────────────────────────────────
    if results and api_key:
        context_for_eval = "\n".join(
            f"- [{r['concept']}] (p.{r['page_num']}, score={r['score']}): {r['summary'][:120]}"
            for r in results[:5]
        )
        try:
            eval_resp = _call_deepseek(
                system_prompt="你是学术检索质量审核员 Reviewer。评估以下检索结果是否能回答用户问题。"
                '输出 JSON: {"score": 0-10整数, "reason": "简短理由", "rewrite_query": "若评分<6则给出改写的检索词否则留空"}',
                user_prompt=f"用户问题: {body.question}\n\n检索结果:\n{context_for_eval}",
                max_tokens=300,
            )
            # 解析评分
            eval_data = {"score": 5, "reason": "默认评估", "rewrite_query": ""}
            try:
                # 尝试提取 JSON
                import re

                json_match = re.search(r"\{[^}]+\}", eval_resp)
                if json_match:
                    eval_data = json.loads(json_match.group())
            except Exception:
                pass

            score = int(eval_data.get("score", 5))
            reason = eval_data.get("reason", "")
            rewrite = eval_data.get("rewrite_query", "")

            steps.append(
                {
                    "agent": "reviewer",
                    "content": f"检索质量评分: {score}/10。{reason}",
                    "score": score,
                }
            )

            # ── Step 2b: 低分时二次检索 ──────────────────────────────────────
            if score < 6 and rewrite:
                logger.info("Reviewer 评分 %d < 6，二次检索: '%s'", score, rewrite)
                try:
                    # 改写查询时用更多轮扩展
                    results2 = _local_hybrid_search(
                        rewrite, top_k=body.top_k, max_rounds=3
                    )
                    if results2:
                        steps.append(
                            {
                                "agent": "seeker",
                                "content": f"改写查询「{rewrite}」，补充检索到 {len(results2)} 条结果。",
                                "related_notes": results2[:3],
                            }
                        )
                        # 去重合并
                        existing_ids = {r["note_id"] for r in all_sources}
                        for r2 in results2:
                            if r2["note_id"] not in existing_ids:
                                all_sources.append(r2)
                except Exception:
                    pass

        except Exception as e:
            logger.warning("Reviewer 评估失败: %s", e)
            steps.append(
                {
                    "agent": "reviewer",
                    "content": "质量评估跳过（API 暂不可用）。",
                    "score": None,
                }
            )

    # ── Step 3: Synthesizer 合成答案 ─────────────────────────────────────────
    if api_key and all_sources:
        context = "\n\n".join(
            f"[{i+1}] 类型={r['concept']}, 页码=p.{r['page_num']}, "
            f"相关度={r.get('score', 'N/A')}\n内容: {r['summary']}"
            for i, r in enumerate(all_sources[:8])
        )
        try:
            answer = _call_deepseek(
                system_prompt=(
                    "你是学术知识合成专家 Synthesizer。"
                    "基于以下从用户知识库中检索到的原子卡片，回答用户的学术问题。"
                    "要求：\n"
                    "1. 直接引用来源，用 [1] [2] 标注\n"
                    "2. 如果知识库信息不足以回答，诚实说明\n"
                    "3. 使用简洁专业的学术语言\n"
                    "4. 给出具体的页码引用"
                ),
                user_prompt=f"用户问题: {body.question}\n\n知识库原子卡片:\n{context}",
                max_tokens=1500,
            )
            steps.append(
                {
                    "agent": "synthesizer",
                    "content": answer,
                }
            )
        except Exception as e:
            logger.error("Synthesizer 合成失败: %s", e)
            steps.append(
                {
                    "agent": "synthesizer",
                    "content": f"合成失败: {e}",
                }
            )
    elif api_key and not all_sources:
        steps.append(
            {
                "agent": "synthesizer",
                "content": "知识库为空，无法基于原子卡片生成答案。请先上传 PDF → 选中文字 → CRUSH IT 生成原子卡片后再提问。",
            }
        )
    else:
        # No API key — local fallback
        if all_sources:
            local_answer = "根据知识库检索结果：\n\n" + "\n".join(
                f"• [{r['concept']}] (p.{r['page_num']}): {r['summary'][:150]}"
                for r in all_sources[:5]
            )
            steps.append(
                {
                    "agent": "synthesizer",
                    "content": local_answer
                    + "\n\n（提示：配置 DEEPSEEK_API_KEY 后可获得更高质量的合成回答）",
                }
            )
        else:
            steps.append(
                {
                    "agent": "synthesizer",
                    "content": "知识库为空且 API 未配置。请先上传 PDF 并 CRUSH IT 生成原子卡片。",
                }
            )

    # 生成最终 answer（取 synthesizer 的最后一条）
    final_answer = ""
    for s in reversed(steps):
        if s["agent"] == "synthesizer":
            final_answer = s["content"]
            break

    return {
        "answer": final_answer,
        "steps": [AgentStep(**s) for s in steps],
        "sources": all_sources[:8],
    }


# ── SSE 流式聊天端点 ────────────────────────────────────────────────────────


def _sse_event(event: str, data: dict) -> str:
    """格式化一个 SSE 事件。"""
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


def _chat_stream_generator(question: str, top_k: int = 5) -> Generator[str, None, None]:
    """
    流式 AgenticRAG：逐步 yield SSE 事件。
    事件类型：
      step   — 完整的非流式 agent step（seeker / reviewer）
      delta  — synthesizer 的流式 token
      done   — 结束信号，附带 sources
    """
    all_sources: List[dict] = []

    # ── Seeker ───────────────────────────────────────────────────────────
    yield _sse_event(
        "step",
        {
            "agent": "seeker",
            "content": "正在多源检索知识库…",
            "related_notes": [],
        },
    )

    results = _local_hybrid_search(question, top_k=top_k, max_rounds=2)
    seeker_msg = (
        f"多源检索知识库（文档原文+笔记卡片+BM25+向量），找到 {len(results)} 条相关结果。"
        if results
        else "知识库当前为空，建议先上传 PDF 并 CRUSH IT 生成原子卡片。"
    )
    yield _sse_event(
        "step",
        {
            "agent": "seeker",
            "content": seeker_msg,
            "related_notes": results[:3],
        },
    )
    all_sources.extend(results)

    # ── 外部检索（ArXiv）──────────────────────────────────────
    external = []
    try:
        external.extend(_search_arxiv_external(question, limit=3))
    except Exception:
        pass
    # Semantic Scholar 跳过（经常 429）
    if external:
        external = sorted(external, key=lambda x: x.get("score", 0), reverse=True)[:3]
        all_sources.extend(external)
        yield _sse_event(
            "step",
            {
                "agent": "seeker",
                "content": f"外部检索补充 ArXiv {len(external)} 条。",
                "related_notes": external[:2],
            },
        )

    api_key = os.getenv("DEEPSEEK_API_KEY")

    # ── Reviewer ─────────────────────────────────────────────────────────
    if results and api_key:
        yield _sse_event(
            "step",
            {
                "agent": "reviewer",
                "content": "正在评估检索质量…",
            },
        )
        context_for_eval = "\n".join(
            f"- [{r['concept']}] (p.{r['page_num']}, score={r['score']}): {r['summary'][:120]}"
            for r in results[:5]
        )
        try:
            eval_resp = _call_deepseek(
                system_prompt=(
                    "你是学术检索质量审核员 Reviewer。评估以下检索结果是否能回答用户问题。"
                    '输出 JSON: {"score": 0-10整数, "reason": "简短理由", "rewrite_query": "若评分<6则给出改写的检索词否则留空"}'
                ),
                user_prompt=f"用户问题: {question}\n\n检索结果:\n{context_for_eval}",
                max_tokens=300,
            )
            eval_data = {"score": 5, "reason": "默认评估", "rewrite_query": ""}
            try:
                json_match = re.search(r"\{[^}]+\}", eval_resp)
                if json_match:
                    eval_data = json.loads(json_match.group())
            except Exception:
                pass

            score = int(eval_data.get("score", 5))
            reason = eval_data.get("reason", "")
            rewrite = eval_data.get("rewrite_query", "")

            yield _sse_event(
                "step",
                {
                    "agent": "reviewer",
                    "content": f"检索质量评分: {score}/10。{reason}",
                    "score": score,
                },
            )

            if score < 6 and rewrite:
                yield _sse_event(
                    "step",
                    {
                        "agent": "seeker",
                        "content": f"评分较低，改写查询「{rewrite}」重新检索…",
                    },
                )
                try:
                    results2 = _local_hybrid_search(rewrite, top_k=top_k, max_rounds=3)
                    if results2:
                        existing_ids = {r["note_id"] for r in all_sources}
                        added = [
                            r for r in results2 if r["note_id"] not in existing_ids
                        ]
                        all_sources.extend(added)
                        yield _sse_event(
                            "step",
                            {
                                "agent": "seeker",
                                "content": f"改写查询补充 {len(added)} 条新结果。",
                                "related_notes": added[:3],
                            },
                        )
                except Exception:
                    pass
        except Exception as e:
            logger.warning("Reviewer 评估失败: %s", e)
            yield _sse_event(
                "step",
                {
                    "agent": "reviewer",
                    "content": "质量评估跳过（API 暂不可用）。",
                },
            )

    # ── Synthesizer（流式）───────────────────────────────────────────────
    if api_key and all_sources:
        context = "\n\n".join(
            f"[{i+1}] 类型={r['concept']}, 页码=p.{r['page_num']}, "
            f"相关度={r.get('score', 'N/A')}\n内容: {r['summary']}"
            for i, r in enumerate(all_sources[:8])
        )
        yield _sse_event(
            "step",
            {
                "agent": "synthesizer",
                "content": "",
                "streaming": True,
            },
        )
        try:
            for token in _stream_deepseek(
                system_prompt=(
                    "你是学术知识合成专家 Synthesizer。"
                    "基于以下从用户知识库中检索到的原子卡片，回答用户的学术问题。"
                    "要求：\n"
                    "1. 直接引用来源，用 [1] [2] 标注\n"
                    "2. 如果知识库信息不足以回答，诚实说明\n"
                    "3. 使用简洁专业的学术语言\n"
                    "4. 给出具体的页码引用"
                ),
                user_prompt=f"用户问题: {question}\n\n知识库原子卡片:\n{context}",
                max_tokens=1500,
            ):
                yield _sse_event("delta", {"token": token})
        except Exception as e:
            logger.error("Synthesizer 流式合成失败: %s", e)
            yield _sse_event("delta", {"token": f"\n\n合成失败: {e}"})
    elif api_key and not all_sources:
        yield _sse_event(
            "step",
            {
                "agent": "synthesizer",
                "content": "知识库为空，无法基于原子卡片生成答案。请先上传 PDF → 选中文字 → CRUSH IT 生成原子卡片后再提问。",
            },
        )
    else:
        fallback = ""
        if all_sources:
            fallback = (
                "根据知识库检索结果：\n\n"
                + "\n".join(
                    f"• [{r['concept']}] (p.{r['page_num']}): {r['summary'][:150]}"
                    for r in all_sources[:5]
                )
                + "\n\n（提示：配置 DEEPSEEK_API_KEY 后可获得更高质量的合成回答）"
            )
        else:
            fallback = (
                "知识库为空且 API 未配置。请先上传 PDF 并 CRUSH IT 生成原子卡片。"
            )
        yield _sse_event(
            "step",
            {
                "agent": "synthesizer",
                "content": fallback,
            },
        )

    # ── Done ─────────────────────────────────────────────────────────────
    yield _sse_event("done", {"sources": all_sources[:8]})


@router.post("/stream")
def chat_stream(body: ChatRequest):
    """SSE 流式 AgenticRAG 聊天。"""
    if not body.question.strip():
        raise HTTPException(status_code=400, detail="问题不能为空")

    logger.info("Chat Stream 请求: question='%s'", body.question[:80])
    return StreamingResponse(
        _chat_stream_generator(body.question, top_k=body.top_k),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )
