"""
Zotero 静默入库：下载 PDF → MinerU → DocumentRAG；并写入原子笔记 + 向量/图谱同步。
"""

import asyncio
import json
import logging
import time
import uuid
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

from core.zotero_contracts import (
    ZoteroErrorCode,
    ZoteroSyncItemResult,
    ZoteroSyncResponse,
)
from integrations.zotero_client import download_pdf_bytes, fetch_zotero_library
from service.zotero_session import session_store_key

logger = logging.getLogger("aether")

STATE_KEY = "zotero_sync_state"


def _get_sync_state(store_key: str) -> Dict[str, Any]:
    from core.session_store import SessionDataStore

    st = SessionDataStore.get(store_key, STATE_KEY)
    if not isinstance(st, dict):
        return {}
    return st


def _set_sync_state(store_key: str, state: Dict[str, Any]) -> None:
    from core.session_store import SessionDataStore

    SessionDataStore.set(store_key, STATE_KEY, state)


async def _mineru_pdf_to_markdown(content: bytes, filename: str) -> str:
    from service.parser import parse_pdf_with_mineru

    markdown = ""
    last_err: Optional[str] = None
    async for raw in parse_pdf_with_mineru(content, filename, "auto"):
        if not isinstance(raw, str):
            continue
        for line in raw.splitlines():
            if not line.startswith("data: "):
                continue
            try:
                payload = json.loads(line[6:])
            except json.JSONDecodeError:
                continue
            st = payload.get("status")
            if st == "error":
                last_err = payload.get("message") or "MinerU 解析错误"
            if st == "success" and payload.get("markdown"):
                markdown = payload["markdown"] or ""
    if last_err and not markdown.strip():
        raise RuntimeError(last_err)
    return markdown


def _sync_note_background(session_id: Optional[str], note_id: str) -> None:
    import threading

    from api.notes import _load_notes

    def _sync():
        try:
            from service.note_rag import get_note_rag

            get_note_rag(session_id).sync_notes()
        except Exception as e:
            logger.warning("Zotero 笔记向量同步失败: %s", e)
        try:
            from service.bm25_engine import get_bm25_engine

            get_bm25_engine(session_id).invalidate()
        except Exception:
            pass
        try:
            from service.knowledge_graph_store import upsert_note_node

            notes = _load_notes(session_id)
            n = next((x for x in notes if x.get("id") == note_id), None)
            if n:
                upsert_note_node(
                    session_id,
                    note_id,
                    n.get("axiom") or "",
                    n.get("method") or "",
                    n.get("boundary") or "",
                    n.get("keywords") if isinstance(n.get("keywords"), list) else [],
                )
        except Exception as e:
            logger.warning("Zotero 图谱写入失败: %s", e)

    threading.Thread(target=_sync, daemon=True).start()


def _append_document_record(
    session_id: Optional[str],
    pdf_bytes: bytes,
    filename: str,
    extra: Dict[str, Any],
) -> str:
    from api.documents import _get_doc_root, _load_meta, _save_meta

    doc_id = str(uuid.uuid4())
    ts_ms = int(time.time() * 1000)
    stored_filename = f"{ts_ms}_{doc_id}.pdf"
    doc_root = _get_doc_root(session_id)
    doc_root.mkdir(parents=True, exist_ok=True)
    target = doc_root / stored_filename
    target.write_bytes(pdf_bytes)
    item = {
        "id": doc_id,
        "name": filename,
        "original_filename": filename,
        "stored_filename": stored_filename,
        "domain_id": None,
        "size": len(pdf_bytes),
        "created_at": datetime.utcnow().isoformat() + "Z",
        **extra,
    }
    items = _load_meta(session_id)
    items.append(item)
    _save_meta(items, session_id)
    logger.info(
        "[Zotero] 已注册文献 doc_id=%s name=%s", doc_id, filename[:60]
    )
    return doc_id


def _upsert_zotero_note(
    session_id: Optional[str],
    *,
    title: str,
    abstract: str,
    doc_id: str,
    item_key: str,
) -> str:
    from api.notes import _load_notes, _save_notes

    notes = _load_notes(session_id)
    note_id = str(uuid.uuid4())
    axiom = f"[Zotero] {title}"[:2000]
    content = f"{axiom}\n\n摘要：\n{(abstract or '')[:3000]}".strip()
    note = {
        "id": note_id,
        "type": "idea",
        "content": content,
        "axiom": axiom,
        "method": "",
        "boundary": "",
        "keywords": ["zotero", item_key],
        "source": "zotero",
        "doc_id": doc_id,
        "page": None,
        "created_at": datetime.utcnow().isoformat() + "Z",
        "zotero_item_key": item_key,
    }
    notes.append(note)
    _save_notes(notes, session_id)
    _sync_note_background(session_id, note_id)
    return note_id


def _index_markdown(
    session_id: Optional[str], doc_id: str, doc_title: str, markdown: str
) -> None:
    from service.doc_rag import get_document_rag

    rag = get_document_rag(session_id)
    rag.index_document(doc_id, doc_title or doc_id, markdown)
    try:
        from service.bm25_engine import get_bm25_engine

        get_bm25_engine(session_id).invalidate()
    except Exception as e:
        logger.warning("Zotero 入库后 BM25 标记失败: %s", e)


async def run_zotero_sync(
    *,
    x_session_id: str,
    session_id: Optional[str],
    limit: int = 20,
    dry_run: bool = False,
) -> ZoteroSyncResponse:
    """
    session_id: 与现有 API 一致（创空间为 header，否则 None）。
    x_session_id: 原始 header，用于 SessionDataStore 凭据与同步状态。
    """
    from service.zotero_session import load_zotero_credentials_plain

    store_key = session_store_key(x_session_id)
    creds = load_zotero_credentials_plain(store_key)
    if not creds:
        return ZoteroSyncResponse(
            ok=False,
            dry_run=dry_run,
            error_code=ZoteroErrorCode.MISSING_CREDENTIALS.value,
            message="未配置 Zotero 凭据，请先在设置中保存 API Key 与 User ID。",
        )

    def _fetch() -> Tuple[Any, Any]:
        return fetch_zotero_library(
            creds["user_id"],
            creds["api_key"],
            creds["collection_key"],
            limit=max(1, min(limit, 100)),
        )

    fetch_res = await asyncio.to_thread(_fetch)
    logger.info(
        "[Zotero] sync fetched items=%d collection=%s errors=%d dry_run=%s",
        len(fetch_res.items),
        fetch_res.collection_resolved_key or "?",
        len(fetch_res.errors),
        dry_run,
    )
    if fetch_res.errors and not fetch_res.items:
        err = fetch_res.errors[0]
        return ZoteroSyncResponse(
            ok=False,
            dry_run=dry_run,
            error_code=(err.get("code") or ZoteroErrorCode.INTERNAL.value),
            message=err.get("message") or "拉取 Zotero 失败",
        )

    state = _get_sync_state(store_key)
    results: List[ZoteroSyncItemResult] = []
    succeeded = skipped = failed = 0

    for dto in fetch_res.items:
        ikey = dto.item_key
        prev = state.get(ikey) if isinstance(state.get(ikey), dict) else {}
        prev_v = int(prev.get("version") or -1)
        if (
            dto.pdf_attachment_key
            and prev_v == dto.version
            and prev.get("doc_id")
        ):
            results.append(
                ZoteroSyncItemResult(
                    item_key=ikey,
                    status="skipped",
                    detail="版本未变，已跳过",
                    doc_id=prev.get("doc_id"),
                    note_id=prev.get("note_id"),
                )
            )
            skipped += 1
            continue

        if not dto.pdf_attachment_key:
            results.append(
                ZoteroSyncItemResult(
                    item_key=ikey,
                    status="error",
                    detail="无 PDF 附件",
                )
            )
            failed += 1
            continue

        title = dto.title or f"zotero_{ikey}"
        safe_name = "".join(c if c.isalnum() or c in "._- " else "_" for c in title)[
            :120
        ].strip() or f"{ikey}.pdf"
        if not safe_name.lower().endswith(".pdf"):
            safe_name = f"{safe_name}.pdf"

        if dry_run:
            results.append(
                ZoteroSyncItemResult(
                    item_key=ikey,
                    status="ok",
                    detail="dry_run",
                )
            )
            succeeded += 1
            continue

        try:
            pdf_bytes = await asyncio.to_thread(
                download_pdf_bytes,
                creds["user_id"],
                creds["api_key"],
                dto.pdf_attachment_key,
            )
        except Exception as e:
            logger.warning("Zotero PDF 下载失败 %s: %s", ikey, e)
            results.append(
                ZoteroSyncItemResult(
                    item_key=ikey,
                    status="error",
                    detail=f"下载失败: {e}",
                )
            )
            failed += 1
            continue

        try:
            md = await _mineru_pdf_to_markdown(pdf_bytes, safe_name)
        except Exception as e:
            logger.warning("Zotero MinerU 解析失败 %s: %s", ikey, e)
            results.append(
                ZoteroSyncItemResult(
                    item_key=ikey,
                    status="error",
                    detail=f"解析失败: {e}",
                )
            )
            failed += 1
            continue

        extra = {
            "abstract": (dto.abstract or "")[:8000],
            "zotero_item_key": ikey,
            "zotero_version": dto.version,
            "source": "zotero",
        }
        try:
            doc_id = await asyncio.to_thread(
                _append_document_record,
                session_id,
                pdf_bytes,
                safe_name,
                extra,
            )
            await asyncio.to_thread(
                _index_markdown, session_id, doc_id, title, md
            )
            note_id = await asyncio.to_thread(
                _upsert_zotero_note,
                session_id,
                title=title,
                abstract=dto.abstract or "",
                doc_id=doc_id,
                item_key=ikey,
            )
        except Exception as e:
            logger.exception("Zotero 入库失败 %s", ikey)
            results.append(
                ZoteroSyncItemResult(
                    item_key=ikey,
                    status="error",
                    detail=f"入库失败: {e}",
                )
            )
            failed += 1
            continue

        state[ikey] = {
            "version": dto.version,
            "doc_id": doc_id,
            "note_id": note_id,
        }
        _set_sync_state(store_key, state)
        results.append(
            ZoteroSyncItemResult(
                item_key=ikey,
                status="ok",
                detail="已解析并入库",
                doc_id=doc_id,
                note_id=note_id,
            )
        )
        succeeded += 1

    return ZoteroSyncResponse(
        ok=True,
        dry_run=dry_run,
        total=len(fetch_res.items),
        succeeded=succeeded,
        skipped=skipped,
        failed=failed,
        results=results,
        message=f"collection={fetch_res.collection_resolved_key}",
    )


def search_zotero_for_chat(
    keywords: str,
    x_session_id: str,
    session_id: Optional[str],
    fetch_recent: bool = False,
    top_k: int = 6,
) -> Tuple[List[dict], str]:
    """
    供 Chat 工具调用：优先本地检索；可选从 Zotero 拉取最近条目摘要。
    返回 (sources, log_line)
    """
    from api.search import _search_pipeline

    sources: List[dict] = []
    log_parts: List[str] = []

    local = _search_pipeline(
        query=keywords or "zotero",
        top_k=max(6, top_k),
        doc_id=None,
        max_rounds=2,
        session_id=session_id,
    )
    hits = local.get("results") or []
    zhits = [
        h
        for h in hits
        if "zotero" in str(h.get("concept", "")).lower()
        or "zotero" in str(h.get("summary", "")).lower()
        or "zotero" in str(h.get("doc_title", "")).lower()
    ]
    if zhits:
        sources.extend(zhits[:top_k])
        log_parts.append(f"local_zotero_hits={len(zhits)}")

    store_key = session_store_key(x_session_id)
    from service.zotero_session import load_zotero_credentials_plain

    creds = load_zotero_credentials_plain(store_key)
    if not creds:
        return sources, "search_my_zotero: 无会话凭据，仅本地检索"

    if fetch_recent or not sources:
        try:
            fres = fetch_zotero_library(
                creds["user_id"],
                creds["api_key"],
                creds["collection_key"],
                limit=15,
            )
        except Exception as e:
            return sources, f"search_my_zotero: 拉取失败 {e}"

        kw_tokens = [
            k.strip().lower()
            for k in (keywords or "").replace("，", " ").split()
            if len(k.strip()) > 1
        ]
        for dto in fres.items:
            blob = f"{dto.title} {dto.abstract}".lower()
            if kw_tokens and not any(k in blob for k in kw_tokens):
                continue
            sources.append(
                {
                    "note_id": f"zotero::{dto.item_key}",
                    "summary": (dto.abstract or "")[:1200],
                    "concept": f"zotero:{(dto.title or '')[:80]}",
                    "keywords": dto.authors or [],
                    "doc_title": dto.title or dto.item_key,
                    "page_num": 0,
                    "bbox": [],
                    "score": 0.66,
                    "source": "zotero_library",
                }
            )
            if len(sources) >= top_k:
                break
        log_parts.append(f"zotero_api_items={len(fres.items)}")

    return sources[:top_k], "search_my_zotero: " + "; ".join(log_parts)
