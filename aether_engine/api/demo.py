"""
Demo 白皮书：全局单例解析 + 会话复用。
首次请求触发解析并索引，后续请求直接复用缓存结果。
"""

import asyncio
import json
import logging
import time
from pathlib import Path
from typing import Optional, Dict, Any, Tuple

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse

from core.session import get_session_id, sanitize_session_id

router = APIRouter(prefix="/demo", tags=["demo"])
logger = logging.getLogger("aether")

_ENGINE_ROOT = Path(__file__).resolve().parent.parent
DEMO_DIR = _ENGINE_ROOT / "demo_data"
DEMO_PDF = (DEMO_DIR / "demo_paper.pdf").resolve()
DATA_DIR = Path("data")
DEMO_DOC_ID = "global_demo_official"
DEMO_CACHE_FILE = DATA_DIR / "demo_cache.json"
_DEMO_LOCK = asyncio.Lock()


def _debug_log(hid: str, location: str, message: str, data: Dict[str, Any]) -> None:
    try:
        with Path("debug-360e80.log").open("a", encoding="utf-8") as f:
            f.write(
                json.dumps(
                    {
                        "sessionId": "360e80",
                        "runId": "pre-fix",
                        "hypothesisId": hid,
                        "location": location,
                        "message": message,
                        "data": data,
                        "timestamp": int(time.time() * 1000),
                    },
                    ensure_ascii=False,
                )
                + "\n"
            )
    except Exception:
        pass


def _find_demo_pdf() -> Optional[Path]:
    """按多种路径查找 demo_paper.pdf，兼容不同启动目录。"""
    candidates = [
        DEMO_PDF,
        Path.cwd() / "demo_data" / "demo_paper.pdf",
        Path.cwd() / "Aether-Engine" / "demo_data" / "demo_paper.pdf",
        _ENGINE_ROOT / "demo_data" / "demo_paper.pdf",
    ]
    for p in candidates:
        try:
            if p.resolve().exists():
                return p.resolve()
        except (OSError, RuntimeError):
            continue
    return None


def _notes_file_for(session_id: str) -> Path:
    return DATA_DIR / f"notes_{sanitize_session_id(session_id)}.json"


def _clear_session(session_id: str) -> None:
    """与会话重置相同的清空逻辑。"""
    notes_path = _notes_file_for(session_id)
    if notes_path.exists():
        try:
            notes_path.unlink()
            logger.info("Demo 加载前已清空笔记: %s", notes_path)
        except Exception as e:
            logger.warning("删除笔记文件失败: %s", e)
    try:
        from service.note_rag import get_note_rag

        get_note_rag(session_id).reset()
    except Exception as e:
        logger.warning("NoteRAG 重置失败: %s", e)
    try:
        from service.doc_rag import get_document_rag

        get_document_rag(session_id).reset()
    except Exception as e:
        logger.warning("DocumentRAG 重置失败: %s", e)
    try:
        from service.bm25_engine import get_bm25_engine

        get_bm25_engine(session_id).invalidate()
    except Exception:
        pass


def _load_cache() -> Optional[Dict[str, Any]]:
    if not DEMO_CACHE_FILE.exists():
        return None
    try:
        return json.loads(DEMO_CACHE_FILE.read_text(encoding="utf-8"))
    except Exception:
        return None


def _build_demo_notes(markdown: str, sections: list) -> list:
    notes = []
    for idx, sec in enumerate((sections or [])[:8]):
        text = (sec.get("summary") or sec.get("content") or "").strip()
        if not text:
            continue
        notes.append(
            {
                "id": f"demo_seed_{idx}",
                "type": "idea",
                "content": text[:240],
                "keywords": [],
                "tags": [],
                "source": "demo_seed",
                "doc_id": DEMO_DOC_ID,
                "page": int(idx / 2) + 1,
                "bbox": [],
            }
        )
    return notes


def _save_cache(markdown: str, sections: list, demo_notes: list) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    DEMO_CACHE_FILE.write_text(
        json.dumps(
            {
                "doc_id": DEMO_DOC_ID,
                "title": "demo_paper.pdf",
                "markdown": markdown,
                "sections": sections,
                "demo_notes": demo_notes,
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )


async def _parse_demo_markdown(path: Path) -> Tuple[str, list]:
    from service.parser import parse_pdf_with_mineru, _split_sections

    content = path.read_bytes()
    markdown = ""
    async for raw in parse_pdf_with_mineru(content, path.name, method="auto"):
        if not raw.startswith("data: "):
            continue
        try:
            payload = json.loads(raw[6:].strip())
        except Exception:
            continue
        if payload.get("status") == "success":
            markdown = payload.get("markdown", "") or ""
    if not markdown.strip():
        raise RuntimeError("Demo 解析失败：未生成 markdown")
    sections = _split_sections(markdown)
    return markdown, sections


def _is_demo_indexed() -> bool:
    from service.doc_rag import get_document_rag

    try:
        rag = get_document_rag(None)
        # 兼容不同 chromadb 版本：避免使用部分版本不支持的 limit 参数
        got = rag.collection.get(where={"doc_id": DEMO_DOC_ID})
        return bool(got.get("ids"))
    except Exception as e:
        logger.warning("Demo 索引检查失败: %s", e)
        return False


def _ensure_demo_index(markdown: str) -> None:
    from service.doc_rag import get_document_rag
    from service.bm25_engine import get_bm25_engine

    rag = get_document_rag(None)
    rag.index_document(DEMO_DOC_ID, "demo_paper.pdf", markdown)
    try:
        # 全局索引与会话 BM25 分离，按需重建时会读取最新 doc_chunks
        get_bm25_engine(None).invalidate()
    except Exception:
        pass


@router.post("/load")
async def load_demo(session_id: str = Depends(get_session_id)):
    """
    清空当前会话，并挂载全局 demo 文档。
    首次加载时解析并缓存；后续直接复用。
    """
    _clear_session(session_id)

    path = _find_demo_pdf()
    if not path:
        raise HTTPException(status_code=404, detail="Demo 白皮书文件不存在")

    cache = _load_cache()
    cached = False
    indexed = _is_demo_indexed()
    _debug_log(
        "H1",
        "demo.py:load_demo:pre-check",
        "demo cache/index precheck",
        {
            "session_id": (session_id or "")[:16],
            "cache_has_markdown": bool(cache and cache.get("markdown")),
            "indexed": bool(indexed),
        },
    )

    if cache and cache.get("markdown") and indexed:
        cached = True
    else:
        async with _DEMO_LOCK:
            cache = _load_cache()
            indexed = _is_demo_indexed()
            if cache and cache.get("markdown") and indexed:
                cached = True
            else:
                _debug_log(
                    "H1",
                    "demo.py:load_demo:parse-branch",
                    "enter parse branch for demo",
                    {"session_id": (session_id or "")[:16], "indexed": bool(indexed)},
                )
                markdown, sections = await _parse_demo_markdown(path)
                demo_notes = _build_demo_notes(markdown, sections)
                _ensure_demo_index(markdown)
                _save_cache(markdown, sections, demo_notes)
                cache = _load_cache()
                cached = False
    _debug_log(
        "H1",
        "demo.py:load_demo:result",
        "demo load branch result",
        {
            "session_id": (session_id or "")[:16],
            "cached": bool(cached),
            "notes_count": len(((cache or {}).get("demo_notes") or [])),
        },
    )

    # 将 demo 卡片挂载到当前会话（仅 demo doc_id）
    try:
        from api.notes import _load_notes, _save_notes

        current = _load_notes(session_id)
        keep = [n for n in current if (n.get("doc_id") or "") != DEMO_DOC_ID]
        demo_notes = (cache or {}).get("demo_notes") or []
        _save_notes([*keep, *demo_notes], session_id)
    except Exception as e:
        logger.warning("Demo 卡片挂载失败: %s", e)

    logger.info(
        "Demo 加载完成: session=%s cached=%s doc_id=%s",
        (session_id or "")[:16],
        cached,
        DEMO_DOC_ID,
    )
    return {
        "ok": True,
        "cached": cached,
        "doc_id": DEMO_DOC_ID,
        "title": "demo_paper.pdf",
        "file_url": "/api/demo/pdf",
        "pdf_url": "/api/demo/pdf",
        "markdown": (cache or {}).get("markdown", ""),
        "sections": (cache or {}).get("sections", []),
        "demo_notes": (cache or {}).get("demo_notes", []),
        "parsed_data": (cache or {}).get("markdown", ""),
        "tree_data": (cache or {}).get("sections", []),
    }


@router.get("/pdf", response_class=FileResponse)
def get_demo_pdf():
    """返回预置白皮书 PDF 文件流，供前端当作用户上传并触发解析。"""
    path = _find_demo_pdf()
    if not path:
        logger.warning("Demo 白皮书未找到，DEMO_PDF=%s cwd=%s", DEMO_PDF, Path.cwd())
        raise HTTPException(
            status_code=404,
            detail=f"Demo 白皮书文件不存在。请将 demo_paper.pdf 放入 Aether-Engine/demo_data/。查找路径: {DEMO_PDF}",
        )
    return FileResponse(
        path,
        media_type="application/pdf",
        filename="demo_paper.pdf",
    )
