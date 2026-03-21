"""
文献文件管理 API（会话隔离版）
用于本地 PDF 的上传、列表、读取与删除，支持多用户 Demo 场景。

物理文件命名：{timestamp_ms}_{uuid}.pdf，避免同名覆盖；API 仍返回 name=用户原始文件名。
"""

import json
import logging
import time
import uuid
import os
from pathlib import Path
from typing import List, Optional

from fastapi import APIRouter, File, HTTPException, UploadFile, Header
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

router = APIRouter(prefix="/documents", tags=["documents"])
logger = logging.getLogger("aether")

IN_MODELSCOPE_SPACE = os.path.exists("/mnt/workspace")

if IN_MODELSCOPE_SPACE:
    from core.session_store import get_session_path, SessionDataStore, init_session
else:
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


def _find_doc(items: List[dict], doc_id: str) -> Optional[dict]:
    for x in items:
        if x.get("id") == doc_id:
            return x
    return None


def _disk_path(doc_root: Path, item: dict) -> Path:
    """解析磁盘路径：优先 stored_filename，兼容旧数据 {id}.pdf"""
    doc_id = item.get("id") or ""
    sf = (item.get("stored_filename") or "").strip()
    if sf:
        p = doc_root / sf
        if p.exists():
            return p
    legacy = doc_root / f"{doc_id}.pdf"
    return legacy


class DocumentItem(BaseModel):
    id: str
    name: str
    size: int
    created_at: str
    original_filename: Optional[str] = None
    stored_filename: Optional[str] = None
    domain_id: Optional[str] = None


class PatchDocumentBody(BaseModel):
    domain_id: Optional[str] = Field(default=None, description="设为 null 或空字符串表示未分类")


@router.get("")
def list_documents(x_session_id: str = Header(default="")):
    """获取文档列表（会话隔离）"""
    session_id = x_session_id if IN_MODELSCOPE_SPACE else None
    items = _load_meta(session_id)
    # 归一化：保证 name 始终可展示（旧数据仅有 name）
    for it in items:
        if not it.get("name"):
            it["name"] = it.get("original_filename") or "未命名.pdf"
        if it.get("original_filename") is None and it.get("name"):
            it["original_filename"] = it["name"]
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
    ts_ms = int(time.time() * 1000)
    stored_filename = f"{ts_ms}_{doc_id}.pdf"

    doc_root = _get_doc_root(session_id)
    doc_root.mkdir(parents=True, exist_ok=True)
    target = doc_root / stored_filename
    target.write_bytes(content)

    from datetime import datetime

    original = file.filename
    item = {
        "id": doc_id,
        "name": original,
        "original_filename": original,
        "stored_filename": stored_filename,
        "domain_id": None,
        "size": len(content),
        "created_at": datetime.utcnow().isoformat() + "Z",
    }
    items = _load_meta(session_id)
    items.append(item)
    _save_meta(items, session_id)

    logger.info(
        "[Session:%s] 上传文献: id=%s name=%s stored=%s size=%d",
        session_id or "default",
        doc_id,
        original,
        stored_filename,
        len(content),
    )
    return item


@router.patch("/{doc_id}", response_model=DocumentItem)
def patch_document(
    doc_id: str,
    body: PatchDocumentBody,
    x_session_id: str = Header(default=""),
):
    """更新文献元数据（如 domain_id）"""
    session_id = x_session_id if IN_MODELSCOPE_SPACE else None
    items = _load_meta(session_id)
    item = _find_doc(items, doc_id)
    if not item:
        raise HTTPException(status_code=404, detail="文献不存在")

    if "domain_id" in body.model_fields_set:
        raw = (body.domain_id or "").strip()
        item["domain_id"] = raw if raw else None

    _save_meta(items, session_id)
    if not item.get("name"):
        item["name"] = item.get("original_filename") or "未命名.pdf"
    if item.get("original_filename") is None and item.get("name"):
        item["original_filename"] = item["name"]
    return item


@router.get("/{doc_id}/file")
def get_document_file(
    doc_id: str,
    x_session_id: str = Header(default=""),
    session_id: str = "",
):
    """获取文档文件（会话隔离）"""
    sid = x_session_id or session_id if IN_MODELSCOPE_SPACE else None
    doc_root = _get_doc_root(sid)
    items = _load_meta(sid)
    item = _find_doc(items, doc_id)
    if not item:
        raise HTTPException(status_code=404, detail="文献不存在")

    path = _disk_path(doc_root, item)
    if not path.exists():
        raise HTTPException(status_code=404, detail="文献不存在")

    download_name = item.get("name") or item.get("original_filename") or f"{doc_id}.pdf"
    return FileResponse(path, media_type="application/pdf", filename=download_name)


@router.delete("/{doc_id}", status_code=204)
def delete_document(doc_id: str, x_session_id: str = Header(default="")):
    """删除文献（会话隔离）"""
    session_id = x_session_id if IN_MODELSCOPE_SPACE else None
    doc_root = _get_doc_root(session_id)
    items = _load_meta(session_id)
    item = _find_doc(items, doc_id)
    if not item:
        raise HTTPException(status_code=404, detail="文献不存在")

    path = _disk_path(doc_root, item)
    if path.exists():
        path.unlink()

    new_items = [x for x in items if x.get("id") != doc_id]
    _save_meta(new_items, session_id)
    logger.info("[Session:%s] 删除文献: id=%s", session_id or "default", doc_id)
