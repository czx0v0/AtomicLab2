"""
文献文件管理 API
用于本地 PDF 的上传、列表、读取与删除，解决前端刷新/切换后文件句柄丢失问题。
"""

import json
import logging
import uuid
from pathlib import Path
from typing import List

from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel

router = APIRouter(prefix="/documents", tags=["documents"])
logger = logging.getLogger("aether")

DOC_ROOT = Path("data/documents")
DOC_ROOT.mkdir(parents=True, exist_ok=True)
META_FILE = DOC_ROOT / "documents.json"


def _load_meta() -> List[dict]:
    if not META_FILE.exists():
        return []
    try:
        return json.loads(META_FILE.read_text(encoding="utf-8"))
    except Exception:
        return []


def _save_meta(items: List[dict]):
    META_FILE.write_text(
        json.dumps(items, ensure_ascii=False, indent=2), encoding="utf-8"
    )


class DocumentItem(BaseModel):
    id: str
    name: str
    size: int
    created_at: str


@router.get("")
def list_documents():
    items = _load_meta()
    return {"documents": items, "total": len(items)}


@router.post("", response_model=DocumentItem)
async def upload_document(file: UploadFile = File(...)):
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="仅支持 PDF 文件")

    content = await file.read()
    doc_id = str(uuid.uuid4())
    target = DOC_ROOT / f"{doc_id}.pdf"
    target.write_bytes(content)

    from datetime import datetime

    item = {
        "id": doc_id,
        "name": file.filename,
        "size": len(content),
        "created_at": datetime.utcnow().isoformat() + "Z",
    }
    items = _load_meta()
    items.append(item)
    _save_meta(items)

    logger.info("上传文献: id=%s name=%s size=%d", doc_id, file.filename, len(content))
    return item


@router.get("/{doc_id}/file")
def get_document_file(doc_id: str):
    path = DOC_ROOT / f"{doc_id}.pdf"
    if not path.exists():
        raise HTTPException(status_code=404, detail="文献不存在")
    return FileResponse(path, media_type="application/pdf", filename=f"{doc_id}.pdf")


@router.delete("/{doc_id}", status_code=204)
def delete_document(doc_id: str):
    path = DOC_ROOT / f"{doc_id}.pdf"
    if path.exists():
        path.unlink()

    items = _load_meta()
    new_items = [x for x in items if x.get("id") != doc_id]
    if len(new_items) == len(items):
        raise HTTPException(status_code=404, detail="文献不存在")
    _save_meta(new_items)
    logger.info("删除文献: id=%s", doc_id)
