"""
Zotero Web API（pyzotero）：按 Collection 拉取文献元数据并解析 PDF 附件 key。
"""

import logging
import re
from typing import List, Optional, Tuple

from pyzotero import zotero

from core.zotero_contracts import ZoteroErrorCode, ZoteroFetchResult, ZoteroItemDTO

logger = logging.getLogger("aether")

_HEX_KEY_RE = re.compile(r"^[A-Za-z0-9]{8}$")


def _client(user_id: str, api_key: str) -> zotero.Zotero:
    return zotero.Zotero(str(user_id).strip(), "user", api_key.strip())


def resolve_collection_key(z: zotero.Zotero, name_or_key: str) -> Tuple[str, Optional[str]]:
    """
    若传入 8 位 key 则直接使用；否则按名称在库中查找（不区分大小写）。
    返回 (resolved_key, error_message)
    """
    raw = (name_or_key or "").strip()
    if not raw:
        return "", "collection_key 不能为空"
    if _HEX_KEY_RE.match(raw):
        return raw, None
    try:
        cols = z.collections()
    except Exception as e:
        logger.warning("Zotero 列出 collections 失败: %s", e)
        return "", str(e)
    for c in cols:
        data = c.get("data") or {}
        name = (data.get("name") or "").strip()
        key = (data.get("key") or "").strip()
        if name.lower() == raw.lower() and key:
            return key, None
    return "", f"未找到名为「{raw}」的文件夹"


def _creators_to_authors(data: dict) -> List[str]:
    out: List[str] = []
    for c in data.get("creators") or []:
        if not isinstance(c, dict):
            continue
        last = (c.get("lastName") or "").strip()
        first = (c.get("firstName") or "").strip()
        if last or first:
            out.append(f"{last} {first}".strip())
    return out


def _find_pdf_attachment_key(z: zotero.Zotero, item_key: str) -> Optional[str]:
    try:
        children = z.children(item_key)
    except Exception as e:
        logger.warning("Zotero children(%s) 失败: %s", item_key, e)
        return None
    for ch in children:
        data = ch.get("data") or {}
        if data.get("itemType") != "attachment":
            continue
        ctype = (data.get("contentType") or "").lower()
        fn = (data.get("filename") or "").lower()
        if ctype == "application/pdf" or fn.endswith(".pdf"):
            return (data.get("key") or "").strip() or None
    return None


def _item_to_dto(
    item: dict,
    collection_key: str,
    pdf_key: Optional[str],
) -> ZoteroItemDTO:
    data = item.get("data") or {}
    item_key = (data.get("key") or item.get("key") or "").strip()
    try:
        version = int(item.get("version") or data.get("version") or 0)
    except (TypeError, ValueError):
        version = 0
    title = (data.get("title") or "").strip()
    abstract = (data.get("abstractNote") or "").strip()
    authors = _creators_to_authors(data)
    date_str = (data.get("date") or "").strip()
    year = None
    if date_str:
        m = re.search(r"(19|20)\d{2}", date_str)
        if m:
            year = m.group(0)
    return ZoteroItemDTO(
        item_key=item_key,
        version=version,
        title=title,
        abstract=abstract,
        authors=authors,
        year=year,
        pdf_attachment_key=pdf_key,
        collection_key=collection_key,
        updated=data.get("dateModified"),
    )


def fetch_zotero_library(
    user_id: str,
    api_key: str,
    collection_key_or_name: str,
    limit: int = 50,
) -> ZoteroFetchResult:
    """
    拉取指定 Collection 下顶层条目（含 Title、Abstract、PDF 附件 key）。
    若某条目无 PDF 附件，仍返回条目但 pdf_attachment_key 为空，并在 errors 中记录。
    """
    errors: List[dict] = []
    items_out: List[ZoteroItemDTO] = []
    try:
        z = _client(user_id, api_key)
    except Exception as e:
        logger.warning("Zotero 客户端初始化失败: %s", e)
        return ZoteroFetchResult(
            items=[],
            collection_resolved_key="",
            errors=[
                {
                    "code": ZoteroErrorCode.INVALID_CREDENTIALS.value,
                    "message": str(e),
                }
            ],
        )

    ckey, err = resolve_collection_key(z, collection_key_or_name)
    if err or not ckey:
        return ZoteroFetchResult(
            items=[],
            collection_resolved_key="",
            errors=[
                {
                    "code": ZoteroErrorCode.COLLECTION_NOT_FOUND.value,
                    "message": err or "collection 无效",
                }
            ],
        )

    try:
        # Zotero API：collection 内顶层条目
        start = 0
        batch_size = 50
        raw_items: List[dict] = []
        while len(raw_items) < limit:
            batch = z.collection_items(ckey, start=start, limit=batch_size)
            if not batch:
                break
            raw_items.extend(batch)
            start += len(batch)
            if len(batch) < batch_size:
                break
        raw_items = raw_items[:limit]
    except Exception as e:
        logger.warning("Zotero collection_items 失败: %s", e)
        return ZoteroFetchResult(
            items=[],
            collection_resolved_key=ckey,
            errors=[
                {"code": ZoteroErrorCode.NETWORK_ERROR.value, "message": str(e)}
            ],
        )

    for item in raw_items:
        data = item.get("data") or {}
        itype = data.get("itemType")
        if itype == "attachment":
            continue
        ikey = (data.get("key") or "").strip()
        if not ikey:
            continue
        pdf_key = _find_pdf_attachment_key(z, ikey)
        if not pdf_key:
            errors.append(
                {
                    "code": ZoteroErrorCode.NO_PDF_ATTACHMENT.value,
                    "item_key": ikey,
                    "title": (data.get("title") or "")[:80],
                    "message": "无 PDF 附件",
                }
            )
        dto = _item_to_dto(item, ckey, pdf_key)
        items_out.append(dto)

    return ZoteroFetchResult(
        items=items_out,
        collection_resolved_key=ckey,
        errors=errors,
    )


def download_pdf_bytes(user_id: str, api_key: str, attachment_key: str) -> bytes:
    """通过 Zotero Web API 下载附件 PDF 字节。"""
    import httpx

    url = f"https://api.zotero.org/users/{user_id}/items/{attachment_key}/file"
    headers = {"Zotero-API-Key": api_key.strip()}
    r = httpx.get(url, headers=headers, timeout=120.0)
    r.raise_for_status()
    return r.content
