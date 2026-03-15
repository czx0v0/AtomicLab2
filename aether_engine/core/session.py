"""
会话隔离：从请求头读取 X-Session-ID，用于 RAG/笔记/BM25 等资源按会话隔离。
"""

import re
from fastapi import Request

# 集合名/文件名安全：仅保留字母数字与下划线，长度上限
_SANITIZE_PATTERN = re.compile(r"[^a-zA-Z0-9_-]")
_MAX_SID_LEN = 64


def sanitize_session_id(session_id: str) -> str:
    """将 SessionID 转为可安全用于 Chroma 集合名与文件路径的字符串。"""
    if not session_id or not session_id.strip():
        return "default"
    cleaned = _SANITIZE_PATTERN.sub("_", session_id.strip())
    return cleaned[:_MAX_SID_LEN] or "default"


def get_session_id(request: Request) -> str:
    """从请求头读取 X-Session-ID，缺省为 'default'。"""
    raw = request.headers.get("X-Session-ID", "").strip()
    return raw or "default"
