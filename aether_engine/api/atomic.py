"""
原子解构 API
============
POST /api/atomic/decompose  - 将一条笔记解构为原子知识三层结构
"""

import logging

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel

router = APIRouter(prefix="/atomic", tags=["atomic"])
logger = logging.getLogger("aether")


class DecomposeRequest(BaseModel):
    content: str
    note_id: str = "note_0"
    doc_id: str = ""


@router.post("/decompose")
async def decompose_note(
    body: DecomposeRequest, x_session_id: str = Header(default="")
):
    """将学术笔记解构为原子知识（Axiom / Methodology / Boundary）。"""
    if not body.content.strip():
        raise HTTPException(status_code=400, detail="笔记内容不能为空")

    if len(body.content) > 4000:
        raise HTTPException(status_code=400, detail="笔记内容不能超过 4000 字符")

    logger.info(
        "[Atomic] 解构请求 note_id=%s doc_id=%s len=%d",
        body.note_id,
        body.doc_id,
        len(body.content),
    )

    from service.atomic_engine import decompose_note as _decompose

    result = await _decompose(body.content, body.note_id, body.doc_id)
    # 兼容前端旧协议：同时返回首个 atom 的平铺字段
    atoms = result.get("atoms") or []
    first = atoms[0] if atoms else {}
    if isinstance(first, dict):
        result.setdefault("axiom", first.get("axiom", "") or "")
        result.setdefault("method", first.get("methodology", "") or "")
        result.setdefault("boundary", first.get("boundary", "") or "")
    else:
        result.setdefault("axiom", "")
        result.setdefault("method", "")
        result.setdefault("boundary", "")
    return result
