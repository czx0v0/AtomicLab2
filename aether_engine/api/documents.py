"""
文献文件管理 API（会话隔离版）
用于本地 PDF 的上传、列表、读取与删除，支持多用户 Demo 场景。
"""

import json
import logging
import uuid
import os
from pathlib import Path
from typing import List

from fastapi import APIRouter, File, HTTPException, UploadFile, Header
from fastapi.responses import FileResponse
from pydantic import BaseModel

router = APIRouter(prefix="/documents", tags=["documents"])
logger = logging.getLogger("aether")

# 检测是否在创空间环境
IN_MODELSCOPE_SPACE = os.path.exists("/mnt/workspace")

if IN_MODELSCOPE_SPACE:
    from core.session_store import get_session_path, SessionDataStore, init_session
else:
    # 本地开发环境使用传统路径
    DOC_ROOT = Path("data/documents")
    DOC_ROOT.mkdir(parents=True, exist_ok=True)
    META_FILE = DOC_ROOT / "documents.json"


def _get_doc_root(session_id: str = None) -> Path:
    """获取文档根目录"""
    if IN_MODELSCOPE_SPACE and session_id:
        init_session(session_id)
        return get_session_path(session_id, "documents")
    return Path("data/documents")


def _get_meta_file(session_id: str = None) -> Path:
    """获取元数据文件路径"""
    if IN_MODELSCOPE_SPACE and session_id:
        return get_session_path(session_id, "documents.json")
    return Path("data/documents") / "documents.json"


def _load_meta(session_id: str = None) -> List[dict]:
    """加载文档元数据"""
    if IN_MODELSCOPE_SPACE and session_id:
        return SessionDataStore.get(session_id, "documents", [])

    meta_file = _get_meta_file(session_id)
    if not meta_file.exists():
        return []
    try:
        return json.loads(meta_file.read_text(encoding="utf-8"))
    except Exception:
        return []


def _save_meta(items: List[dict], session_id: str = None):
    """保存文档元数据"""
    if IN_MODELSCOPE_SPACE and session_id:
        SessionDataStore.set(session_id, "documents", items)
        return

    meta_file = _get_meta_file(session_id)
    meta_file.parent.mkdir(parents=True, exist_ok=True)
    meta_file.write_text(
        json.dumps(items, ensure_ascii=False, indent=2), encoding="utf-8"
    )


class DocumentItem(BaseModel):
    id: str
    name: str
    size: int
    created_at: str


@router.get("")
def list_documents(x_session_id: str = Header(default="")):
    """获取文档列表（会话隔离）"""
    session_id = x_session_id if IN_MODELSCOPE_SPACE else None
    items = _load_meta(session_id)
    return {"documents": items, "total": len(items)}


@router.post("", response_model=DocumentItem)
async def upload_document(
    file: UploadFile = File(...), x_session_id: str = Header(default="")
):
    """上传文档（会话隔离）"""
    session_id = x_session_id if IN_MODELSCOPE_SPACE else None

    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="仅支持 PDF 文件")

    content = await file.read()
    doc_id = str(uuid.uuid4())

    doc_root = _get_doc_root(session_id)
    doc_root.mkdir(parents=True, exist_ok=True)
    target = doc_root / f"{doc_id}.pdf"
    target.write_bytes(content)

    from datetime import datetime

    item = {
        "id": doc_id,
        "name": file.filename,
        "size": len(content),
        "created_at": datetime.utcnow().isoformat() + "Z",
    }
    items = _load_meta(session_id)
    items.append(item)
    _save_meta(items, session_id)

    logger.info(
        "[Session:%s] 上传文献: id=%s name=%s size=%d",
        session_id or "default",
        doc_id,
        file.filename,
        len(content),
    )
    return item


@router.get("/{doc_id}/file")
def get_document_file(
    doc_id: str,
    x_session_id: str = Header(default=""),
    session_id: str = "",  # 支持 URL 参数传递
):
    """获取文档文件（会话隔离）"""
    # 优先使用 header，其次使用 URL 参数
    sid = x_session_id or session_id if IN_MODELSCOPE_SPACE else None
    doc_root = _get_doc_root(sid)
    path = doc_root / f"{doc_id}.pdf"
    if not path.exists():
        raise HTTPException(status_code=404, detail="文献不存在")
    return FileResponse(path, media_type="application/pdf", filename=f"{doc_id}.pdf")


@router.delete("/{doc_id}", status_code=204)
def delete_document(doc_id: str, x_session_id: str = Header(default="")):
    """删除文档（会话隔离）"""
    session_id = x_session_id if IN_MODELSCOPE_SPACE else None
    doc_root = _get_doc_root(session_id)
    path = doc_root / f"{doc_id}.pdf"
    if path.exists():
        path.unlink()

    items = _load_meta(session_id)
    new_items = [x for x in items if x.get("id") != doc_id]
    if len(new_items) == len(items):
        raise HTTPException(status_code=404, detail="文献不存在")
    _save_meta(new_items, session_id)
    logger.info("[Session:%s] 删除文献: id=%s", session_id or "default", doc_id)
