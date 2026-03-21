"""
Zotero 会话凭据：进程内 Fernet 加密后存入 SessionDataStore，重启即失效。
"""

import json
import logging
from typing import Any, Dict, Optional

from cryptography.fernet import Fernet

from core.zotero_contracts import ZoteroCredentialsIn

logger = logging.getLogger("aether")

# 进程级密钥：重启后无法解密旧会话数据（与「会话不持久」一致）
_FERNET = Fernet(Fernet.generate_key())

SESSION_KEY_ZOTERO_PAYLOAD = "zotero_credentials_enc"
SESSION_KEY_ZOTERO_META = "zotero_meta"


def session_store_key(x_session_id: str) -> str:
    return (x_session_id or "").strip() or "default"


def mask_api_key(key: str) -> str:
    k = (key or "").strip()
    if len(k) <= 8:
        return "****"
    return f"{k[:4]}…{k[-4:]}"


def encrypt_credentials(payload: Dict[str, Any]) -> bytes:
    raw = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    return _FERNET.encrypt(raw)


def decrypt_credentials(blob: bytes) -> Optional[Dict[str, Any]]:
    try:
        raw = _FERNET.decrypt(blob)
        return json.loads(raw.decode("utf-8"))
    except Exception as e:
        logger.warning("Zotero 凭据解密失败: %s", e)
        return None


def save_zotero_credentials(
    store_session_key: str, body: ZoteroCredentialsIn
) -> Dict[str, Any]:
    """写入加密凭据与可展示元信息（不含完整 api_key）。"""
    from core.session_store import SessionDataStore

    prev = load_zotero_credentials_plain(store_session_key) or {}
    new_key = (body.api_key or "").strip()
    merged_key = new_key or (prev.get("api_key") or "").strip()
    if len(merged_key) < 8:
        raise ValueError("API Key 无效或未提供（首次保存必须填写完整 Key）")

    payload = {
        "user_id": body.user_id.strip(),
        "api_key": merged_key,
        "collection_key": body.collection_key.strip(),
    }
    enc = encrypt_credentials(payload)
    SessionDataStore.set(store_session_key, SESSION_KEY_ZOTERO_PAYLOAD, enc)
    meta = {
        "user_id": payload["user_id"],
        "collection_key": payload["collection_key"],
        "api_key_masked": mask_api_key(payload["api_key"]),
        "hint": "凭据仅保存在当前服务进程内存中，重启后需重新填写。",
    }
    SessionDataStore.set(store_session_key, SESSION_KEY_ZOTERO_META, meta)
    logger.info(
        "[Zotero] 已保存会话凭据 user_id=%s collection=%s key=%s",
        meta["user_id"],
        meta["collection_key"],
        meta["api_key_masked"],
    )
    return meta


def load_zotero_credentials_plain(store_session_key: str) -> Optional[Dict[str, str]]:
    """供后端集成调用：返回明文 user_id / api_key / collection_key。"""
    from core.session_store import SessionDataStore

    blob = SessionDataStore.get(store_session_key, SESSION_KEY_ZOTERO_PAYLOAD)
    if not blob:
        return None
    if not isinstance(blob, bytes):
        return None
    data = decrypt_credentials(blob)
    if not data:
        return None
    uid = (data.get("user_id") or "").strip()
    key = (data.get("api_key") or "").strip()
    ck = (data.get("collection_key") or "").strip()
    if not uid or not key:
        return None
    return {"user_id": uid, "api_key": key, "collection_key": ck}


def get_zotero_meta(store_session_key: str) -> Optional[Dict[str, Any]]:
    from core.session_store import SessionDataStore

    return SessionDataStore.get(store_session_key, SESSION_KEY_ZOTERO_META)
