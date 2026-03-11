"""
笔记 CRUD API（会话隔离版）
支持原子笔记的增删改查，支持多用户 Demo 场景。
"""

import json
import logging
import os
import threading
import uuid
from pathlib import Path
from typing import List, Optional

from fastapi import APIRouter, HTTPException, Header
from pydantic import BaseModel

router = APIRouter(prefix="/notes", tags=["notes"])
logger = logging.getLogger("aether")

# 检测是否在创空间环境
IN_MODELSCOPE_SPACE = os.path.exists("/mnt/workspace")

if IN_MODELSCOPE_SPACE:
    from core.session_store import SessionDataStore


def _get_notes_file(session_id: str = None) -> Path:
    """获取笔记文件路径"""
    if IN_MODELSCOPE_SPACE and session_id:
        from core.session_store import get_session_path, init_session

        init_session(session_id)
        return get_session_path(session_id, "notes.json")
    return Path("data/notes.json")


def _load_notes(session_id: str = None) -> List[dict]:
    """加载笔记"""
    if IN_MODELSCOPE_SPACE and session_id:
        return SessionDataStore.get(session_id, "notes", [])

    notes_file = _get_notes_file(session_id)
    if notes_file.exists():
        try:
            return json.loads(notes_file.read_text(encoding="utf-8"))
        except Exception:
            return []
    return []


def _save_notes(notes: List[dict], session_id: str = None):
    """保存笔记"""
    if IN_MODELSCOPE_SPACE and session_id:
        # 同时写内存（快速读取）和文件（供 NoteRAG/BM25 同步）
        SessionDataStore.set(session_id, "notes", notes)
        notes_file = _get_notes_file(session_id)
        notes_file.parent.mkdir(parents=True, exist_ok=True)
        notes_file.write_text(
            json.dumps(notes, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        return

    notes_file = _get_notes_file(session_id)
    notes_file.parent.mkdir(parents=True, exist_ok=True)
    notes_file.write_text(
        json.dumps(notes, ensure_ascii=False, indent=2), encoding="utf-8"
    )


class NoteCreate(BaseModel):
    content: str
    type: str = "idea"  # method | formula | idea | definition | data | other
    page: Optional[int] = None
    bbox: Optional[List[float]] = None
    screenshot: Optional[str] = None
    doc_id: Optional[str] = None
    translation: Optional[str] = None
    keywords: Optional[List[str]] = None


class NoteUpdate(BaseModel):
    content: Optional[str] = None
    type: Optional[str] = None
    translation: Optional[str] = None
    keywords: Optional[List[str]] = None


@router.get("")
def list_notes(x_session_id: str = Header(default="")):
    """获取所有笔记（会话隔离）。"""
    session_id = x_session_id if IN_MODELSCOPE_SPACE else None
    notes = _load_notes(session_id)
    logger.info("[Session:%s] 返回 %d 条笔记", session_id or "default", len(notes))
    return {"notes": notes, "total": len(notes)}


@router.post("", status_code=201)
def create_note(body: NoteCreate, x_session_id: str = Header(default="")):
    """创建新的原子笔记（会话隔离）。"""
    session_id = x_session_id if IN_MODELSCOPE_SPACE else None
    notes = _load_notes(session_id)
    new_note = {
        "id": str(uuid.uuid4()),
        **body.model_dump(),
    }
    notes.append(new_note)
    _save_notes(notes, session_id)
    logger.info(
        "[Session:%s] 创建笔记 id=%s page=%s",
        session_id or "default",
        new_note["id"],
        new_note.get("page"),
    )

    # 异步同步到向量库（不阻塞 HTTP 响应）
    def _sync():
        try:
            from service.note_rag import get_note_rag

            get_note_rag(session_id).sync_notes()
        except Exception as e:
            logger.warning("向量库同步失败: %s", e)
        try:
            from service.bm25_engine import get_bm25_engine

            get_bm25_engine(session_id).invalidate()
        except Exception:
            pass

    threading.Thread(target=_sync, daemon=True).start()

    return new_note


@router.delete("/{note_id}", status_code=204)
def delete_note(note_id: str, x_session_id: str = Header(default="")):
    """删除指定笔记（会话隔离）。"""
    session_id = x_session_id if IN_MODELSCOPE_SPACE else None
    notes = _load_notes(session_id)
    original_len = len(notes)
    notes = [n for n in notes if n["id"] != note_id]
    if len(notes) == original_len:
        raise HTTPException(status_code=404, detail=f"笔记 {note_id} 不存在")
    _save_notes(notes, session_id)
    logger.info("[Session:%s] 删除笔记 id=%s", session_id or "default", note_id)

    # 异步从向量库删除（不阻塞 HTTP 响应）
    def _del():
        try:
            from service.note_rag import get_note_rag

            get_note_rag(session_id).delete_note(note_id)
        except Exception:
            pass
        try:
            from service.bm25_engine import get_bm25_engine

            get_bm25_engine(session_id).invalidate()
        except Exception:
            pass

    threading.Thread(target=_del, daemon=True).start()
