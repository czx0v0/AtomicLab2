"""
Zotero 集成：DTO、错误码与 API 契约（MCP 风格外部知识源）。
"""

from enum import Enum
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


class ZoteroErrorCode(str, Enum):
    """与客户端/日志对齐的稳定错误码。"""

    MISSING_CREDENTIALS = "missing_credentials"
    INVALID_CREDENTIALS = "invalid_credentials"
    COLLECTION_NOT_FOUND = "collection_not_found"
    RATE_LIMITED = "rate_limited"
    NO_PDF_ATTACHMENT = "no_pdf_attachment"
    NETWORK_ERROR = "network_error"
    PARSE_FAILED = "parse_failed"
    INDEX_FAILED = "index_failed"
    INTERNAL = "internal"


class ZoteroCredentialsIn(BaseModel):
    """用户在前端提交的凭据（不落盘，仅存会话级加密缓存）。"""

    user_id: str = Field(..., min_length=1, description="Zotero User ID（数字字符串）")
    api_key: str = Field(
        default="",
        description="Zotero API Key；若已保存过凭据且留空则沿用旧 Key",
    )
    collection_key: str = Field(
        ...,
        min_length=1,
        description="Collection key（8 位十六进制）或文件夹名称，如 To Read",
    )


class ZoteroItemDTO(BaseModel):
    """归一化后的单条文献。"""

    item_key: str
    version: int = 0
    title: str = ""
    abstract: str = ""
    authors: List[str] = Field(default_factory=list)
    year: Optional[str] = None
    pdf_attachment_key: Optional[str] = None
    collection_key: str = ""
    updated: Optional[str] = None


class ZoteroFetchResult(BaseModel):
    """fetch_zotero_library 返回。"""

    items: List[ZoteroItemDTO] = Field(default_factory=list)
    collection_resolved_key: str = ""
    errors: List[Dict[str, Any]] = Field(default_factory=list)


class ZoteroSyncItemResult(BaseModel):
    item_key: str
    status: str  # ok | skipped | error
    detail: str = ""
    doc_id: Optional[str] = None
    note_id: Optional[str] = None


class ZoteroSyncResponse(BaseModel):
    ok: bool = True
    dry_run: bool = False
    total: int = 0
    succeeded: int = 0
    skipped: int = 0
    failed: int = 0
    results: List[ZoteroSyncItemResult] = Field(default_factory=list)
    error_code: Optional[str] = None
    message: str = ""
