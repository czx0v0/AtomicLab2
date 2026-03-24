"""
UGC 知识碎片 API
POST /api/note/distill
"""

import logging
import threading
import uuid
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel

from api.notes import IN_MODELSCOPE_SPACE, _load_notes, _save_notes

router = APIRouter(prefix="/note", tags=["note"])
logger = logging.getLogger("aether")


class DistillRequest(BaseModel):
    text: str
    doc_id: str = ""
    source: str = "ugc"
    page: Optional[int] = None


@router.post("/distill", status_code=201)
async def distill_note(body: DistillRequest, x_session_id: str = Header(default="")):
    text = (body.text or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="text 不能为空")
    if len(text) > 8000:
        raise HTTPException(status_code=400, detail="text 不能超过 8000 字符")

    session_id = x_session_id if IN_MODELSCOPE_SPACE else None

    from service.atomic_engine import distill_note_text

    distilled = await distill_note_text(text)
    axiom = (distilled.get("axiom") or "").strip()
    method = (distilled.get("method") or "").strip()
    boundary = (distilled.get("boundary") or "").strip()
    tags = distilled.get("tags") if isinstance(distilled.get("tags"), list) else []
    tags = [str(t).strip() for t in tags if str(t).strip()][:8]

    if not axiom:
        raise HTTPException(status_code=502, detail="蒸馏失败：未返回 axiom")

    note_id = str(uuid.uuid4())
    content = f"{axiom}\n\n方法：{method}\n\n边界：{boundary}".strip()
    note = {
        "id": note_id,
        "type": "idea",
        "content": content,
        "axiom": axiom,
        "method": method,
        "boundary": boundary,
        "keywords": tags,
        "tags": tags,
        "source": body.source or "ugc",
        "doc_id": body.doc_id or "",
        "page": body.page,
        "created_at": datetime.utcnow().isoformat() + "Z",
    }

    notes = _load_notes(session_id)
    notes.append(note)
    _save_notes(notes, session_id)

    def _sync_background():
        try:
            from service.note_rag import get_note_rag

            get_note_rag(session_id).sync_notes()
        except Exception as e:
            logger.warning("Distill 后向量库同步失败: %s", e)
        try:
            from service.bm25_engine import get_bm25_engine

            get_bm25_engine(session_id).invalidate()
        except Exception:
            pass
        try:
            from service.knowledge_graph_store import upsert_note_node

            upsert_note_node(session_id, note_id, axiom, method, boundary, tags)
        except Exception as e:
            logger.warning("Distill 后图谱写入失败: %s", e)

    threading.Thread(target=_sync_background, daemon=True).start()

    logger.info(
        "[Session:%s] UGC 蒸馏成功: note_id=%s tags=%d",
        session_id or "default",
        note_id[:8],
        len(tags),
    )

    return {
        "ok": True,
        "note": note,
        "is_mock": bool(distilled.get("is_mock")),
    }
