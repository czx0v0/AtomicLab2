"""
Zotero MCP 风格集成：会话凭据、手动同步、状态查询。
"""

import logging
import os
from typing import Optional

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, Field

from core.zotero_contracts import ZoteroCredentialsIn
from service.zotero_session import (
    get_zotero_meta,
    save_zotero_credentials,
    session_store_key,
)
from service.zotero_sync import run_zotero_sync

router = APIRouter(prefix="/integration/zotero", tags=["integration-zotero"])
logger = logging.getLogger("aether")

IN_MODELSCOPE_SPACE = os.path.exists("/mnt/workspace")


class ZoteroSyncRequest(BaseModel):
    limit: int = Field(20, ge=1, le=100)
    dry_run: bool = False


def _session_id(header: str) -> Optional[str]:
    return header if IN_MODELSCOPE_SPACE else None


@router.post("/credentials")
def save_credentials(
    body: ZoteroCredentialsIn,
    x_session_id: str = Header(default=""),
):
    """保存 Zotero 凭据到会话级加密存储（重启失效）。"""
    if IN_MODELSCOPE_SPACE and x_session_id:
        from core.session_store import init_session

        init_session(x_session_id.strip())
    sk = session_store_key(x_session_id)
    try:
        meta = save_zotero_credentials(sk, body)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    return {"ok": True, "meta": meta}


@router.get("/status")
def zotero_status(x_session_id: str = Header(default="")):
    """返回是否已配置凭据（脱敏）。"""
    sk = session_store_key(x_session_id)
    meta = get_zotero_meta(sk)
    return {
        "configured": bool(meta),
        "meta": meta or {},
    }


@router.post("/sync")
async def zotero_sync(
    body: ZoteroSyncRequest,
    x_session_id: str = Header(default=""),
):
    """静默拉取 Zotero PDF+摘要，走 MinerU + Chroma 入库。"""
    if IN_MODELSCOPE_SPACE and x_session_id:
        from core.session_store import init_session

        init_session(x_session_id.strip())
    sid = _session_id(x_session_id)
    out = await run_zotero_sync(
        x_session_id=x_session_id,
        session_id=sid,
        limit=body.limit,
        dry_run=body.dry_run,
    )
    if not out.ok:
        raise HTTPException(
            status_code=400,
            detail=f"{out.message} [{out.error_code}]",
        )
    return out.model_dump() if hasattr(out, "model_dump") else out.dict()
