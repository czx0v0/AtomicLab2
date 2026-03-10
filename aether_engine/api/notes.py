"""
笔记 CRUD API
支持原子笔记的增删改查，数据持久化到本地 JSON 文件（开发模式）。
"""

import json
import logging
import threading
import uuid
from pathlib import Path
from typing import List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter(prefix="/notes", tags=["notes"])
logger = logging.getLogger("aether")

# 简单文件持久化（生产环境换成数据库）
NOTES_FILE = Path("data/notes.json")
NOTES_FILE.parent.mkdir(parents=True, exist_ok=True)


def _load_notes() -> List[dict]:
    if NOTES_FILE.exists():
        try:
            return json.loads(NOTES_FILE.read_text(encoding="utf-8"))
        except Exception:
            return []
    return []


def _save_notes(notes: List[dict]):
    NOTES_FILE.write_text(
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
def list_notes():
    """获取所有笔记。"""
    notes = _load_notes()
    logger.info("返回 %d 条笔记", len(notes))
    return {"notes": notes, "total": len(notes)}


@router.post("", status_code=201)
def create_note(body: NoteCreate):
    """创建新的原子笔记。"""
    notes = _load_notes()
    new_note = {
        "id": str(uuid.uuid4()),
        **body.model_dump(),
    }
    notes.append(new_note)
    _save_notes(notes)
    logger.info("创建笔记 id=%s  page=%s", new_note["id"], new_note.get("page"))

    # 异步同步到向量库（不阻塞 HTTP 响应）
    def _sync():
        try:
            from service.note_rag import get_note_rag

            get_note_rag().sync_notes()
        except Exception as e:
            logger.warning("向量库同步失败: %s", e)
        try:
            from service.bm25_engine import get_bm25_engine

            get_bm25_engine().invalidate()
        except Exception:
            pass

    threading.Thread(target=_sync, daemon=True).start()

    return new_note


@router.delete("/{note_id}", status_code=204)
def delete_note(note_id: str):
    """删除指定笔记。"""
    notes = _load_notes()
    original_len = len(notes)
    notes = [n for n in notes if n["id"] != note_id]
    if len(notes) == original_len:
        raise HTTPException(status_code=404, detail=f"笔记 {note_id} 不存在")
    _save_notes(notes)
    logger.info("删除笔记 id=%s", note_id)

    # 异步从向量库删除（不阻塞 HTTP 响应）
    def _del():
        try:
            from service.note_rag import get_note_rag

            get_note_rag().delete_note(note_id)
        except Exception:
            pass
        try:
            from service.bm25_engine import get_bm25_engine

            get_bm25_engine().invalidate()
        except Exception:
            pass

    threading.Thread(target=_del, daemon=True).start()
