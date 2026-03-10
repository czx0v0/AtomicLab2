"""
RAG 混合检索 API
BM25 + 向量语义 + 1-hop GraphRAG 扩展。
"""
import logging
from typing import List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter(prefix="/search", tags=["search"])
logger = logging.getLogger("aether")


class SearchRequest(BaseModel):
    query: str
    top_k: int = 5
    doc_id: Optional[str] = None


class SearchResult(BaseModel):
    note_id: str
    summary: str
    concept: str
    keywords: List[str]
    doc_title: str
    page_num: int
    bbox: List[float]
    score: float = 1.0


@router.post("")
def search_notes(body: SearchRequest):
    """
    混合检索：向量语义检索 + 1-hop GraphRAG 扩展。
    当 RAG 存储为空时返回 mock 数据供前端演示。
    """
    if not body.query.strip():
        raise HTTPException(status_code=400, detail="查询内容不能为空")

    logger.info("收到检索请求: query='%s', top_k=%d", body.query, body.top_k)

    # 尝试从 RAG 引擎检索（如已初始化）
    try:
        from service.rag_engine import AtomicRAG
        rag = AtomicRAG()
        if rag.collection.count() > 0:
            results = rag.query_with_citations(body.query, top_k=body.top_k)
            logger.info("RAG 检索返回 %d 条结果", len(results))
            return {"results": results, "total": len(results), "query": body.query}
    except Exception as e:
        logger.warning("RAG 引擎暂不可用: %s，返回 mock 数据", e)

    # Mock 数据（RAG 未初始化时的演示）
    mock_results = [
        {
            "note_id": "mock-1",
            "summary": f"与查询「{body.query}」高度相关的核心概念：自注意力机制允许模型直接对序列中任意两个位置的依赖关系建模。",
            "concept": "Self-Attention Mechanism",
            "keywords": ["attention", "transformer", "self-attention"],
            "doc_title": "Attention Is All You Need",
            "page_num": 3,
            "bbox": [100.0, 300.0, 400.0, 150.0],
            "score": 0.92,
        },
        {
            "note_id": "mock-2",
            "summary": f"图谱扩展节点：多头注意力通过并行执行多个注意力函数，使模型能够同时关注不同位置的不同子空间信息。",
            "concept": "Multi-Head Attention",
            "keywords": ["multi-head", "parallel", "subspace"],
            "doc_title": "Attention Is All You Need",
            "page_num": 4,
            "bbox": [150.0, 400.0, 300.0, 100.0],
            "score": 0.85,
        },
    ]
    logger.info("返回 %d 条 mock 检索结果", len(mock_results))
    return {"results": mock_results[:body.top_k], "total": len(mock_results), "query": body.query, "is_mock": True}
