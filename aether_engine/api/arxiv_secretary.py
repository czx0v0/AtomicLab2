"""
ArXiv 学术追踪秘书 HTTP API + 纳入知识库
"""
import logging
import threading
import uuid
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, Field

from api.notes import IN_MODELSCOPE_SPACE, _load_notes, _save_notes
from service.arxiv_secretary import get_item_by_id, list_inbox, run_fetch_and_filter

router = APIRouter(prefix="/arxiv-secretary", tags=["arxiv-secretary"])
logger = logging.getLogger("aether")


class FetchRequest(BaseModel):
    keyword: str = Field(..., description="追踪关键词，如 Graph Neural Networks")
    research_goal: str = Field("", description="用户研究课题/目标")
    max_results: int = 5


class ImportRequest(BaseModel):
    item_id: str


def _session(x_session_id: str = "") -> Optional[str]:
    return x_session_id if IN_MODELSCOPE_SPACE else None


@router.post("/fetch")
def secretary_fetch(body: FetchRequest, x_session_id: str = Header(default="")):
    if not body.keyword.strip():
        raise HTTPException(status_code=400, detail="keyword 不能为空")
    sid = _session(x_session_id)
    try:
        out = run_fetch_and_filter(
            keyword=body.keyword.strip(),
            research_goal=(body.research_goal or "").strip(),
            session_id=sid,
            max_results=min(max(body.max_results, 1), 10),
        )
        return out
    except Exception as e:
        logger.exception("secretary_fetch")
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.get("/inbox")
def secretary_inbox(x_session_id: str = Header(default="")):
    return list_inbox(_session(x_session_id))


def _sync_note_background(session_id: Optional[str], note_id: str):
    def _sync():
        try:
            from service.note_rag import get_note_rag

            get_note_rag(session_id).sync_notes()
        except Exception as e:
            logger.warning("秘书导入后向量同步失败: %s", e)
        try:
            from service.bm25_engine import get_bm25_engine

            get_bm25_engine(session_id).invalidate()
        except Exception:
            pass
        try:
            from service.knowledge_graph_store import upsert_note_node

            notes = _load_notes(session_id)
            n = next((x for x in notes if x.get("id") == note_id), None)
            if n:
                upsert_note_node(
                    session_id,
                    note_id,
                    n.get("axiom") or "",
                    n.get("method") or "",
                    n.get("boundary") or "",
                    n.get("keywords") if isinstance(n.get("keywords"), list) else [],
                )
        except Exception as e:
            logger.warning("秘书导入后图谱写入失败: %s", e)

    threading.Thread(target=_sync, daemon=True).start()


@router.post("/import", status_code=201)
def secretary_import(body: ImportRequest, x_session_id: str = Header(default="")):
    sid = _session(x_session_id)
    item = get_item_by_id(body.item_id.strip(), sid)
    if not item:
        raise HTTPException(status_code=404, detail="收件箱项不存在")

    notes = _load_notes(sid)
    note_id = str(uuid.uuid4())
    title = (item.get("title") or "").strip()
    method = (item.get("method") or "").strip()
    boundary = (item.get("boundary") or "").strip()
    summary = (item.get("summary") or "").strip()
    axiom = f"[ArXiv 推荐] {title}"[:2000]
    abs_url = item.get("abs_url") or ""
    arxiv_id = item.get("arxiv_id") or ""

    content = f"{axiom}\n\n原文摘要摘录：\n{summary[:3000]}".strip()
    kw = [k for k in [item.get("keyword"), arxiv_id, "arxiv"] if k]
    note = {
        "id": note_id,
        "type": "arxiv_recommendation",
        "content": content,
        "axiom": axiom,
        "method": method,
        "boundary": boundary,
        "keywords": kw,
        "source": "arxiv_secretary",
        "doc_id": "",
        "page": None,
        "created_at": datetime.utcnow().isoformat() + "Z",
        "arxiv_id": arxiv_id,
        "arxiv_url": abs_url,
    }
    notes.append(note)
    _save_notes(notes, sid)
    _sync_note_background(sid, note_id)
    logger.info("[Session:%s] 秘书导入笔记 id=%s arxiv=%s", sid or "default", note_id[:8], arxiv_id)
    return {"ok": True, "note": note}
