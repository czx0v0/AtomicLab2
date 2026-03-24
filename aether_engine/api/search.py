"""
RAG 多源多轮混合检索 API
通道：BM25 关键词 + ChromaDB 向量语义 + 截图 OCR + 1-hop GraphRAG 扩展。
策略：先搜原文 → 再搜笔记卡片 → 多轮查询扩展 → RRF 融合。
"""

import json
import logging
import os
import re
from pathlib import Path
from typing import List, Optional, Dict, Any

from fastapi import APIRouter, HTTPException, Header
from pydantic import BaseModel

router = APIRouter(prefix="/search", tags=["search"])
logger = logging.getLogger("aether")
NOTES_FILE = Path("data/notes.json")
GLOBAL_DEMO_DOC_ID = "global_demo_official"

# 检测是否在创空间环境
IN_MODELSCOPE_SPACE = os.path.exists("/mnt/workspace")


# ── 请求 / 响应模型 ─────────────────────────────────────────────────────────


class SearchRequest(BaseModel):
    query: str
    top_k: int = 8
    doc_id: Optional[str] = None
    max_rounds: int = 2  # 最多几轮查询扩展


class IndexDocumentRequest(BaseModel):
    doc_id: str
    doc_title: str = ""
    markdown: str


class SearchResult(BaseModel):
    note_id: str
    summary: str
    concept: str
    keywords: List[str]
    doc_title: str
    page_num: int
    bbox: List[float]
    score: float = 1.0


def _load_notes_for_session(session_id: Optional[str]) -> List[dict]:
    """复用 notes API 的存储层，读取会话笔记。"""
    try:
        from api.notes import _load_notes

        return _load_notes(session_id)
    except Exception:
        return []


def _note_tags(note: dict) -> List[str]:
    tags = []
    for k in ("tags", "keywords"):
        vals = note.get(k) or []
        if isinstance(vals, list):
            tags.extend([str(v).strip().lower() for v in vals if str(v).strip()])
    return list(dict.fromkeys(tags))


def _graph_one_hop_expand(
    seed_notes: List[dict],
    session_id: Optional[str],
    max_graph_items: int = 10,
) -> List[dict]:
    """
    对 seed notes 执行 1-hop 图谱扩展。
    返回可参与融合的“图谱三元组文本”结果，source=graph_1hop。
    """
    if not seed_notes:
        return []

    note_map = {n.get("id"): n for n in _load_notes_for_session(session_id)}
    seed_ids = [n.get("note_id") for n in seed_notes if n.get("note_id")]

    graph_triples: List[dict] = []
    # 优先使用持久化图谱（UGC 蒸馏写入）
    try:
        from service.knowledge_graph_store import get_one_hop_triples

        graph_triples = get_one_hop_triples(session_id, seed_ids, max_items=max_graph_items)
    except Exception as e:
        logger.warning("图谱 1-hop 扩展失败，回退 tag 邻接: %s", e)

    # 回退：基于 tags 在内存边集合上构造 1-hop 邻接
    if not graph_triples:
        seed_with_tags = [(sid, _note_tags(note_map.get(sid, {}))) for sid in seed_ids]
        for sid, stags in seed_with_tags:
            if not stags:
                continue
            sset = set(stags)
            for oid, onote in note_map.items():
                if oid == sid:
                    continue
                oset = set(_note_tags(onote))
                overlap = sorted(sset & oset)
                if not overlap:
                    continue
                graph_triples.append(
                    {
                        "subject": sid,
                        "relation": "Shares_Concept",
                        "object": oid,
                        "tags": overlap[:6],
                        "source_note_id": sid,
                        "target_note_id": oid,
                    }
                )
                if len(graph_triples) >= max_graph_items:
                    break
            if len(graph_triples) >= max_graph_items:
                break

    out: List[dict] = []
    for idx, t in enumerate(graph_triples[:max_graph_items]):
        sid = t.get("source_note_id", "")
        tid = t.get("target_note_id", "")
        s_note = note_map.get(sid, {})
        o_note = note_map.get(tid, {})
        relation = t.get("relation", "related_to")
        triple_text = (
            f"[G{idx+1}] {s_note.get('axiom') or s_note.get('content') or sid} "
            f"-{relation}-> "
            f"{o_note.get('axiom') or o_note.get('content') or tid}"
        )
        out.append(
            {
                "note_id": f"graph::{sid}::{relation}::{tid}::{idx}",
                "summary": triple_text,
                "concept": f"[G{idx+1}] graph_1hop",
                "keywords": t.get("tags", []),
                "doc_title": "KnowledgeGraph",
                "page_num": int(s_note.get("page", 0) or 0),
                "bbox": [],
                "score": round(0.62 - idx * 0.02, 4),
                "source": "graph_1hop",
                "graph_ref": f"[G{idx+1}]",
            }
        )
    return out


def _graph_two_hop_expand(
    seed_notes: List[dict],
    session_id: Optional[str],
    max_graph_items: int = 8,
) -> List[dict]:
    """对 seed notes 执行 2-hop 图谱扩展，source=graph_2hop。"""
    if not seed_notes:
        return []

    note_map = {n.get("id"): n for n in _load_notes_for_session(session_id)}
    seed_ids = [n.get("note_id") for n in seed_notes if n.get("note_id")]

    try:
        from service.knowledge_graph_store import get_two_hop_triples

        graph_triples = get_two_hop_triples(session_id, seed_ids, max_items=max_graph_items)
    except Exception as e:
        logger.warning("图谱 2-hop 扩展失败: %s", e)
        return []

    out: List[dict] = []
    for idx, t in enumerate(graph_triples[:max_graph_items]):
        sid = t.get("source_note_id", "")
        tid = t.get("target_note_id", "")
        s_note = note_map.get(sid, {})
        o_note = note_map.get(tid, {})
        relation = t.get("relation", "related_to")
        triple_text = (
            f"[G2-{idx+1}] {s_note.get('axiom') or s_note.get('content') or sid} "
            f"-{relation}-> "
            f"{o_note.get('axiom') or o_note.get('content') or tid}"
        )
        out.append(
            {
                "note_id": f"graph2::{sid}::{relation}::{tid}::{idx}",
                "summary": triple_text,
                "concept": f"[G2-{idx+1}] graph_2hop",
                "keywords": t.get("tags", []),
                "doc_title": "KnowledgeGraph",
                "page_num": int(s_note.get("page", 0) or 0),
                "bbox": [],
                "score": round(0.58 - idx * 0.02, 4),
                "source": "graph_2hop",
                "graph_ref": f"[G2-{idx+1}]",
            }
        )
    return out


def _extract_terms(text: str) -> List[str]:
    words = re.findall(r"[A-Za-z][A-Za-z0-9_\-]{2,}|[\u4e00-\u9fff]{2,8}", text or "")
    out = []
    seen = set()
    for w in words:
        k = w.strip().lower()
        if not k or k in seen:
            continue
        seen.add(k)
        out.append(k)
    return out


def _graph_doc_note_expand(
    seed_doc_chunks: List[dict],
    session_id: Optional[str],
    max_graph_items: int = 8,
) -> List[dict]:
    """
    实验模式：把文档块关键词与笔记 tags 做重叠配对，生成跨类型 GraphRAG 扩展。
    默认启用的跨类型扩展：文档块关键词与笔记 tags 做重叠配对。
    """
    if not seed_doc_chunks:
        return []
    notes = _load_notes_for_session(session_id)
    if not notes:
        return []

    ranked = []
    for d in seed_doc_chunks:
        d_terms = set(_extract_terms((d.get("summary") or "") + " " + " ".join(d.get("keywords") or [])))
        if not d_terms:
            continue
        for n in notes:
            n_tags = set(_note_tags(n))
            if not n_tags:
                continue
            overlap = sorted(d_terms & n_tags)
            if not overlap:
                continue
            ranked.append((len(overlap), overlap[:6], d, n))

    ranked.sort(key=lambda x: x[0], reverse=True)
    out = []
    for idx, (_, overlap, d, n) in enumerate(ranked[:max_graph_items]):
        note_id = n.get("id", "")
        ref = f"[GD{idx+1}]"
        out.append(
            {
                "note_id": f"graphdoc::{d.get('note_id','doc')}::{note_id}::{idx}",
                "summary": f"{ref} {d.get('doc_title') or 'DocumentChunk'} -> {n.get('axiom') or n.get('content') or note_id}",
                "concept": f"{ref} graph_dochop",
                "keywords": overlap,
                "doc_title": d.get("doc_title") or "KnowledgeGraph",
                "page_num": int(n.get("page", 0) or 0),
                "bbox": [],
                "score": round(0.56 - idx * 0.02, 4),
                "source": "graph_dochop",
                "graph_ref": ref,
            }
        )
    return out


# ── RRF 融合 ────────────────────────────────────────────────────────────────


def _rrf_fuse(
    result_groups: List[List[dict]],
    weights: Optional[List[float]] = None,
    top_k: int = 10,
    rrf_k: int = 60,
) -> List[dict]:
    """
    加权 RRF 融合：每个通道可以有不同权重。
    weights[i] 对应 result_groups[i] 的权重（默认全为 1.0）。
    """
    if weights is None:
        weights = [1.0] * len(result_groups)

    score_map: Dict[str, float] = {}
    item_map: Dict[str, dict] = {}
    source_map: Dict[str, List[str]] = {}  # 记录每个结果来自哪些通道

    for group_idx, group in enumerate(result_groups):
        w = weights[group_idx] if group_idx < len(weights) else 1.0
        for rank, item in enumerate(group):
            nid = item.get("note_id")
            if not nid:
                continue
            rrf_score = w / (rrf_k + rank + 1)
            score_map[nid] = score_map.get(nid, 0.0) + rrf_score
            # 保留原始分最高的项
            if nid not in item_map or item.get("score", 0) > item_map[nid].get(
                "score", 0
            ):
                item_map[nid] = item
            # 记录来源
            src = item.get("source", "unknown")
            source_map.setdefault(nid, [])
            if src not in source_map[nid]:
                source_map[nid].append(src)

    fused = []
    for nid, rrf_score in score_map.items():
        base = item_map[nid]
        original_score = float(base.get("score", 0))
        merged_score = round(0.65 * rrf_score + 0.35 * original_score, 6)
        fused.append(
            {
                **base,
                "score": merged_score,
                "sources": source_map.get(nid, []),
            }
        )

    fused.sort(key=lambda x: x.get("score", 0), reverse=True)
    return fused[:top_k]


# ── 查询扩展 ────────────────────────────────────────────────────────────────


def _expand_query(query: str) -> List[str]:
    """
    生成查询变体，用于多轮/多角度检索。
    策略：原始查询 + 提取关键短语 + 中英文交叉。
    """
    from service.bm25_engine import tokenize_zh

    variants = [query]  # 第一轮始终用原始查询
    seen = {query.lower().strip()}

    def _add(v):
        v = v.strip()
        if v and v.lower() not in seen:
            seen.add(v.lower())
            variants.append(v)

    tokens = list(dict.fromkeys(tokenize_zh(query)))  # 去重保序

    # 变体：只保留核心关键词
    if len(tokens) > 3:
        core = tokens[:6]
        _add(" ".join(core))

    # 变体：中英文交叉
    cn_chars = re.findall(r"[\u4e00-\u9fff]+", query)
    en_words = re.findall(r"[a-zA-Z]{3,}", query)
    if cn_chars and en_words:
        _add(" ".join(cn_chars))
        _add(" ".join(en_words))
    elif len(tokens) > 5:
        mid = len(tokens) // 2
        _add(" ".join(tokens[:mid]))
        _add(" ".join(tokens[mid:]))

    return variants[:4]  # 最多 4 个变体


# ── OCR 文本提取（轻量版）──────────────────────────────────────────────────


def _extract_screenshot_texts(session_id: Optional[str] = None) -> List[Dict[str, Any]]:
    """
    从 notes.json 中提取有截图的笔记，支持会话隔离。
    """
    if IN_MODELSCOPE_SPACE and session_id:
        from core.session_store import get_session_path

        notes_file = get_session_path(session_id, "notes.json")
    else:
        notes_file = NOTES_FILE

    if not notes_file.exists():
        return []
    try:
        notes = json.loads(notes_file.read_text(encoding="utf-8"))
    except Exception:
        return []

    screenshots = []
    for n in notes:
        if not n.get("screenshot"):
            continue
        content = n.get("content", "").strip()
        translation = n.get("translation", "") or ""
        # 截图卡片：即使 content 为空也收录（未来可接真 OCR）
        text = f"{content} {translation}".strip()
        if not text:
            text = f"[截图卡片] page={n.get('page', 0)}"
        screenshots.append(
            {
                "note_id": n.get("id", ""),
                "summary": text,
                "concept": "screenshot",
                "keywords": [],
                "doc_title": n.get("source_name", ""),
                "page_num": int(n.get("page", 0) or 0),
                "bbox": n.get("bbox", []),
                "score": 0.5,
                "source": "screenshot_ocr",
            }
        )
    return screenshots


# ── 多源检索管线 ─────────────────────────────────────────────────────────────


def _search_pipeline(
    query: str,
    top_k: int = 8,
    doc_id: Optional[str] = None,
    max_rounds: int = 2,
    session_id: Optional[str] = None,
) -> Dict[str, Any]:
    """
    多源多轮检索管线（文档原文优先，支持会话隔离）：
    Round 1: 原始查询 → [文档原文向量(1.8) + 文档BM25(1.5)] + [笔记向量(0.9) + 笔记BM25(0.7)] + [截图OCR(0.5)]
    Round 2+: 查询变体 → 补充检索，去重合并
    最终 RRF 加权融合。文档原文块 > 用户卡片 > 截图。
    """
    from service.bm25_engine import get_bm25_engine, tokenize_zh

    bm25 = get_bm25_engine(session_id)

    all_channels: List[List[dict]] = []
    channel_weights: List[float] = []
    channel_stats: Dict[str, int] = {}

    query_variants = _expand_query(query)
    # 限制轮数
    rounds = min(max_rounds, len(query_variants))

    seen_ids: set = set()

    def _dedup(results: List[dict]) -> List[dict]:
        """追加去重：只保留尚未出现的结果。"""
        out = []
        for r in results:
            nid = r.get("note_id")
            if nid and nid not in seen_ids:
                seen_ids.add(nid)
                out.append(r)
        return out

    for round_idx in range(rounds):
        q = query_variants[round_idx] if round_idx < len(query_variants) else query
        is_first_round = round_idx == 0
        fetch_k = max(top_k * 2, 12) if is_first_round else max(top_k, 8)
        doc_vector: List[dict] = []
        note_vector: List[dict] = []

        logger.info(
            "检索 Round %d: query='%s' fetch_k=%d", round_idx + 1, q[:60], fetch_k
        )

        # ── 通道 1: 文档原文向量检索（PRIMARY - 权重最高）──────────────────
        try:
            from service.doc_rag import get_document_rag

            rag_session_id = None if doc_id == GLOBAL_DEMO_DOC_ID else session_id
            doc_rag = get_document_rag(rag_session_id)
            doc_vector = doc_rag.search(q, top_k=fetch_k)
            doc_vector = _dedup(doc_vector)
            if doc_vector:
                all_channels.append(doc_vector)
                # 文档原文权重最高（用户要求先搜原文）
                channel_weights.append(1.8 if is_first_round else 1.2)
                channel_stats["doc_vector"] = channel_stats.get("doc_vector", 0) + len(
                    doc_vector
                )
        except Exception as e:
            logger.warning("DocumentRAG 检索失败 (round %d): %s", round_idx + 1, e)

        # ── 通道 2: 文档原文 BM25 关键词检索 ─────────────────────────────────
        try:
            doc_bm25 = bm25.search_docs(q, top_k=fetch_k)
            doc_bm25 = _dedup(doc_bm25)
            if doc_bm25:
                all_channels.append(doc_bm25)
                channel_weights.append(1.5 if is_first_round else 1.0)
                channel_stats["doc_bm25"] = channel_stats.get("doc_bm25", 0) + len(
                    doc_bm25
                )
        except Exception as e:
            logger.warning("BM25 文档检索失败 (round %d): %s", round_idx + 1, e)

        # ── 通道 3: 笔记卡片向量检索 ────────────────────────────────────────
        try:
            from service.note_rag import get_note_rag

            note_rag = get_note_rag(session_id)
            note_vector = note_rag.search(q, top_k=fetch_k)
            note_vector = _dedup(note_vector)
            if note_vector:
                all_channels.append(note_vector)
                channel_weights.append(0.9)
                channel_stats["note_vector"] = channel_stats.get(
                    "note_vector", 0
                ) + len(note_vector)
            # ── 通道 3.1: GraphRAG（默认全量：1-hop + 2-hop + 跨类型 doc-note）──
            if is_first_round:
                seed_notes = note_vector[:5]
                graph_hits = _graph_one_hop_expand(seed_notes, session_id)
                graph_hits = _dedup(graph_hits)
                if graph_hits:
                    all_channels.append(graph_hits)
                    channel_weights.append(1.0)
                    channel_stats["graph_1hop"] = len(graph_hits)
                graph_2 = _graph_two_hop_expand(seed_notes, session_id)
                graph_2 = _dedup(graph_2)
                if graph_2:
                    all_channels.append(graph_2)
                    channel_weights.append(0.85)
                    channel_stats["graph_2hop"] = len(graph_2)
                if doc_vector:
                    doc_graph = _graph_doc_note_expand(doc_vector[:6], session_id)
                    doc_graph = _dedup(doc_graph)
                    if doc_graph:
                        all_channels.append(doc_graph)
                        channel_weights.append(0.75)
                        channel_stats["graph_dochop"] = len(doc_graph)
        except Exception as e:
            logger.warning("NoteRAG 检索失败 (round %d): %s", round_idx + 1, e)

        # ── 通道 4: 笔记卡片 BM25 关键词检索 ────────────────────────────────
        try:
            note_bm25 = bm25.search_notes(q, top_k=fetch_k)
            note_bm25 = _dedup(note_bm25)
            if note_bm25:
                all_channels.append(note_bm25)
                channel_weights.append(0.7)
                channel_stats["note_bm25"] = channel_stats.get("note_bm25", 0) + len(
                    note_bm25
                )
        except Exception as e:
            logger.warning("BM25 笔记检索失败 (round %d): %s", round_idx + 1, e)

        # ── 通道 5: 截图 OCR 文本检索（仅首轮）──────────────────────────────
        if is_first_round:
            try:
                screenshot_items = _extract_screenshot_texts(session_id)
                if screenshot_items:
                    # 对截图文本做 BM25 风格的 token overlap 评分
                    tokens_q = set(tokenize_zh(q))
                    scored_ss = []
                    for si in screenshot_items:
                        tokens_doc = set(tokenize_zh(si["summary"]))
                        overlap = len(tokens_q & tokens_doc) / max(1, len(tokens_q))
                        if overlap > 0:
                            si["score"] = round(0.3 + overlap * 0.7, 4)
                            scored_ss.append(si)
                    scored_ss.sort(key=lambda x: x["score"], reverse=True)
                    scored_ss = _dedup(scored_ss[:fetch_k])
                    if scored_ss:
                        all_channels.append(scored_ss)
                        channel_weights.append(0.5)
                        channel_stats["screenshot_ocr"] = len(scored_ss)
            except Exception as e:
                logger.warning("截图 OCR 检索失败: %s", e)

    # ── RRF 加权融合 ─────────────────────────────────────────────────────────
    merged = _rrf_fuse(all_channels, weights=channel_weights, top_k=top_k)
    # doc_id 过滤（图谱项无 doc_id 时保持）
    if doc_id:
        merged = [x for x in merged if (not x.get("doc_id")) or x.get("doc_id") == doc_id]

    # 给上层（chat/router）用的融合上下文
    context_parts = []
    for i, item in enumerate(merged[: top_k + 3]):
        src = item.get("source", "unknown")
        ref = item.get("graph_ref") or f"[{i+1}]"
        context_parts.append(
            f"{ref} src={src} concept={item.get('concept','')} score={item.get('score',0)}\n"
            f"{item.get('summary','')}"
        )
    fused_context = "\n\n".join(context_parts)

    logger.info(
        "检索完成: %d 轮, %d 通道, 融合后 %d 条结果 | 通道统计: %s",
        rounds,
        len(all_channels),
        len(merged),
        channel_stats,
    )

    return {
        "results": merged,
        "total": len(merged),
        "query": query,
        "rounds": rounds,
        "channels": channel_stats,
        "context": fused_context,
    }


# ── API 端点 ─────────────────────────────────────────────────────────────────


@router.post("")
def search_notes(body: SearchRequest, x_session_id: str = Header(default="")):
    """
    多源多轮混合检索（支持会话隔离）：
    文档原文（向量+BM25） → 笔记卡片（向量+BM25） → 截图OCR → RRF 融合。
    支持查询扩展和多轮检索。
    """
    if not body.query.strip():
        raise HTTPException(status_code=400, detail="查询内容不能为空")

    session_id = x_session_id if IN_MODELSCOPE_SPACE else None

    logger.info(
        "[Session:%s] 收到检索请求: query='%s', top_k=%d, max_rounds=%d",
        session_id or "default",
        body.query,
        body.top_k,
        body.max_rounds,
    )

    result = _search_pipeline(
        query=body.query,
        top_k=body.top_k,
        doc_id=body.doc_id,
        max_rounds=body.max_rounds,
        session_id=session_id,
    )

    if result["results"]:
        return result

    # 知识库为空时返回空结果
    logger.info("知识库为空，返回 0 条结果")
    return {
        "results": [],
        "total": 0,
        "query": body.query,
        "is_mock": False,
    }


@router.post("/global")
def search_global(body: SearchRequest, x_session_id: str = Header(default="")):
    """
    全库混合检索别名：固定不按 doc_id 过滤，等价于 POST /search 且 doc_id 为空。
    供 Write 中间栏等场景显式调用。
    """
    if not body.query.strip():
        raise HTTPException(status_code=400, detail="查询内容不能为空")

    session_id = x_session_id if IN_MODELSCOPE_SPACE else None

    logger.info(
        "[Session:%s] 全局检索 /search/global: query='%s', top_k=%d",
        session_id or "default",
        body.query,
        body.top_k,
    )

    result = _search_pipeline(
        query=body.query,
        top_k=body.top_k,
        doc_id=None,
        max_rounds=body.max_rounds,
        session_id=session_id,
    )

    if result["results"]:
        return result

    logger.info("全局检索：知识库为空，返回 0 条")
    return {
        "results": [],
        "total": 0,
        "query": body.query,
        "is_mock": False,
    }


@router.post("/index-document")
def index_document(body: IndexDocumentRequest, x_session_id: str = Header(default="")):
    """将解析后的 Markdown 文档切块并写入 DocumentRAG + 重建 BM25 索引。"""
    if not body.doc_id.strip() or not body.markdown.strip():
        raise HTTPException(status_code=400, detail="doc_id 和 markdown 不能为空")

    session_id = x_session_id if IN_MODELSCOPE_SPACE else None

    try:
        from service.doc_rag import get_document_rag

        rag_session_id = None if body.doc_id == GLOBAL_DEMO_DOC_ID else session_id
        rag = get_document_rag(rag_session_id)
        count = rag.index_document(
            body.doc_id, body.doc_title or body.doc_id, body.markdown
        )

        # 重建 BM25 文档索引
        try:
            from service.bm25_engine import get_bm25_engine

            bm25 = get_bm25_engine(session_id)
            bm25.invalidate()  # 标记需重建
            logger.info("[Session:%s] BM25 文档索引已标记重建", session_id or "default")
        except Exception as e:
            logger.warning("BM25 索引重建失败: %s", e)

        return {"ok": True, "doc_id": body.doc_id, "chunks": count}
    except Exception as e:
        logger.error("索引文档失败: %s", e)
        raise HTTPException(status_code=500, detail=f"索引失败: {e}")
