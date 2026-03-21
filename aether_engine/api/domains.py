"""
领域（Domain）管理：会话级 JSON / SessionDataStore，与 documents 并列。
"""

import json
import logging
import uuid
from datetime import datetime
from pathlib import Path
from typing import List, Optional

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, Field

router = APIRouter(prefix="/domains", tags=["domains"])
logger = logging.getLogger("aether")

import os

IN_MODELSCOPE_SPACE = os.path.exists("/mnt/workspace")

if IN_MODELSCOPE_SPACE:
    from core.session_store import SessionDataStore, init_session
else:
    DOMAINS_ROOT = Path("data/documents")
    DOMAINS_ROOT.mkdir(parents=True, exist_ok=True)
    DOMAINS_FILE = DOMAINS_ROOT / "domains.json"


def _load_domains(session_id: Optional[str]) -> List[dict]:
    if IN_MODELSCOPE_SPACE and session_id:
        init_session(session_id)
        return SessionDataStore.get(session_id, "domains", [])
    p = Path("data/documents") / "domains.json"
    if not p.exists():
        return []
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except Exception:
        return []


def _save_domains(items: List[dict], session_id: Optional[str]) -> None:
    if IN_MODELSCOPE_SPACE and session_id:
        SessionDataStore.set(session_id, "domains", items)
        return
    p = Path("data/documents") / "domains.json"
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(items, ensure_ascii=False, indent=2), encoding="utf-8")


class DomainItem(BaseModel):
    id: str
    name: str
    created_at: str = ""


class DomainCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)


@router.get("")
def list_domains(x_session_id: str = Header(default="")):
    session_id = x_session_id if IN_MODELSCOPE_SPACE else None
    items = _load_domains(session_id)
    return {"domains": items, "total": len(items)}


@router.post("", response_model=DomainItem)
def create_domain(body: DomainCreate, x_session_id: str = Header(default="")):
    session_id = x_session_id if IN_MODELSCOPE_SPACE else None
    name = (body.name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="领域名称不能为空")
    items = _load_domains(session_id)
    did = str(uuid.uuid4())
    item = {
        "id": did,
        "name": name,
        "created_at": datetime.utcnow().isoformat() + "Z",
    }
    items.append(item)
    _save_domains(items, session_id)
    logger.info("[Session:%s] 创建领域: id=%s name=%s", session_id or "default", did, name)
    return item
