"""
会话隔离：从请求头读取 X-Session-ID，用于 RAG/笔记/BM25 等资源按会话隔离。
"""

import re
from typing import Optional
from fastapi import Header

# 集合名/文件名安全：仅保留字母数字与下划线，长度上限
_SANITIZE_PATTERN = re.compile(r"[^a-zA-Z0-9_-]")
_MAX_SID_LEN = 64


def sanitize_session_id(session_id: str) -> str:
    """将 SessionID 转为可安全用于 Chroma 集合名与文件路径的字符串。"""
    if not session_id or not session_id.strip():
        return "default"
    cleaned = _SANITIZE_PATTERN.sub("_", session_id.strip())
    return cleaned[:_MAX_SID_LEN] or "default"


def resolve_session_id(x_session_id: str) -> Optional[str]:
    """纯函数版会话解析（单一事实来源）：本地返回 None；云端净化。

    用于替换散落的 `session_id = x_session_id if IN_MODELSCOPE_SPACE else None`，
    避免重复「读环境 + 判本地」逻辑，并统一净化。
    """
    from core.paths import is_modelscope_space

    if not is_modelscope_space():
        return None
    return sanitize_session_id(x_session_id)


def get_session_dep(x_session_id: str = Header(default="")) -> Optional[str]:
    """统一会话依赖：本地返回 None；云端读头 + 净化（供 FastAPI Depends 用）。"""
    return resolve_session_id(x_session_id)
