"""
Zotero 会话凭据：进程内加密后存入 SessionDataStore，重启即失效。

优先使用 cryptography.fernet（若已安装）；否则使用标准库 XOR + base64 混淆（无额外依赖，创空间 Dockerfile 可能未装 cryptography）。
"""

import base64
import json
import logging
import secrets
from typing import Any, Dict, Optional

from core.zotero_contracts import ZoteroCredentialsIn

logger = logging.getLogger("aether")

SESSION_KEY_ZOTERO_PAYLOAD = "zotero_credentials_enc"
SESSION_KEY_ZOTERO_META = "zotero_meta"

# Fernet（可选）
_FERNET = None
_USE_FERNET = False
try:
    from cryptography.fernet import Fernet

    _FERNET = Fernet(Fernet.generate_key())
    _USE_FERNET = True
except ImportError:
    logger.info(
        "[Zotero] cryptography 未安装，凭据将使用进程内 XOR 混淆（仍仅驻内存）。"
        "建议在环境中 pip install cryptography。"
    )

# 标准库回退：进程级密钥
_XOR_KEY = secrets.token_bytes(32)
_PREFIX_XOR = b"ZX1"


def session_store_key(x_session_id: str) -> str:
    return (x_session_id or "").strip() or "default"


def mask_api_key(key: str) -> str:
    k = (key or "").strip()
    if len(k) <= 8:
        return "****"
    return f"{k[:4]}…{k[-4:]}"


def _xor_seal(raw: bytes) -> bytes:
    out = bytearray()
    for i, b in enumerate(raw):
        out.append(b ^ _XOR_KEY[i % len(_XOR_KEY)])
    return _PREFIX_XOR + base64.b64encode(bytes(out))


def _xor_unseal(blob: bytes) -> bytes:
    if not blob.startswith(_PREFIX_XOR):
        raise ValueError("not xor payload")
    inner = base64.b64decode(blob[len(_PREFIX_XOR) :])
    out = bytearray()
    for i, b in enumerate(inner):
        out.append(b ^ _XOR_KEY[i % len(_XOR_KEY)])
    return bytes(out)


def encrypt_credentials(payload: Dict[str, Any]) -> bytes:
    raw = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    if _USE_FERNET and _FERNET is not None:
        return _FERNET.encrypt(raw)
    return _xor_seal(raw)


def decrypt_credentials(blob: bytes) -> Optional[Dict[str, Any]]:
    if not blob:
        return None
    try:
        if _USE_FERNET and _FERNET is not None:
            try:
                raw = _FERNET.decrypt(blob)
            except Exception:
                # 可能为旧进程 XOR 或格式损坏
                if blob.startswith(_PREFIX_XOR):
                    raw = _xor_unseal(blob)
                else:
                    raise
        elif blob.startswith(_PREFIX_XOR):
            raw = _xor_unseal(blob)
        else:
            logger.warning(
                "Zotero 凭据无法解密：缺少 cryptography 且数据非 XOR 格式（请重新保存凭据）"
            )
            return None
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
