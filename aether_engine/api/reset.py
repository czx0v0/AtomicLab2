"""
会话重置 API：清空当前会话的向量库、笔记文件与 BM25 缓存，用于「重新开始」或刷新页面后隔离数据。
"""

import logging
from pathlib import Path

from fastapi import APIRouter, Depends

from core.session import get_session_id, sanitize_session_id

router = APIRouter(prefix="/reset", tags=["session"])
logger = logging.getLogger("aether")


def _notes_file_for(session_id: str) -> Path:
    return Path("data") / f"notes_{sanitize_session_id(session_id)}.json"


@router.post("")
def reset_session(session_id: str = Depends(get_session_id)):
    """
    强制清空当前会话的：
    - 笔记向量库（ChromaDB notes 集合）
    - 文档切块向量库（ChromaDB doc_chunks 集合）
    - 当前会话的 notes 文件（data/notes_{session_id}.json）
    - BM25 内存索引（标记失效，下次检索时按空重建）
    前端在刷新页面或点击「重新开始」时调用此接口。
    """
    sid = sanitize_session_id(session_id)
    logger.info("会话重置: session_id=%s", sid[:16] if len(sid) > 16 else sid)

    # 1. 删除当前会话的笔记文件
    notes_path = _notes_file_for(session_id)
    if notes_path.exists():
        try:
            notes_path.unlink()
            logger.info("已删除笔记文件: %s", notes_path)
        except Exception as e:
            logger.warning("删除笔记文件失败: %s", e)

    # 2. 清空 NoteRAG 向量集合并重建空集合
    try:
        from service.note_rag import get_note_rag

        get_note_rag(session_id).reset()
    except Exception as e:
        logger.warning("NoteRAG 重置失败: %s", e)

    # 3. 清空 DocumentRAG 向量集合
    try:
        from service.doc_rag import get_document_rag

        get_document_rag(session_id).reset()
    except Exception as e:
        logger.warning("DocumentRAG 重置失败: %s", e)

    # 4. BM25 索引标记失效（下次检索时从空重建）
    try:
        from service.bm25_engine import get_bm25_engine

        get_bm25_engine(session_id).invalidate()
    except Exception as e:
        logger.warning("BM25 失效失败: %s", e)

    return {"ok": True, "message": "当前会话数据已清空"}
