"""
Demo 白皮书：只读静态 bundle（demo_data/demo_static_bundle.json）+ PDF；
不向 MinerU 发起解析。可选在 warm/load 时用静态 Markdown 构建全局向量索引。
"""

import asyncio
import json
import logging
from pathlib import Path
from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse

from core.session import get_session_id, sanitize_session_id

router = APIRouter(prefix="/demo", tags=["demo"])
logger = logging.getLogger("aether")

_ENGINE_ROOT = Path(__file__).resolve().parent.parent
_MS_ROOT = _ENGINE_ROOT.parent  # modelspace-deploy 根目录
DEMO_DIR = _ENGINE_ROOT / "demo_data"
DEMO_PDF = (DEMO_DIR / "demo_paper.pdf").resolve()
PUBLIC_DEMO_PDF = (_MS_ROOT / "public" / "demo_paper.pdf").resolve()
DEMO_STATIC_BUNDLE = (DEMO_DIR / "demo_static_bundle.json").resolve()
DATA_DIR = Path("data")
DEMO_DOC_ID = "global_demo_official"
_DEMO_LOCK = asyncio.Lock()


def _find_demo_pdf() -> Optional[Path]:
    """按多种路径查找 demo_paper.pdf（含 public/ 与 demo_data/），兼容不同启动目录。"""
    candidates = [
        PUBLIC_DEMO_PDF,
        Path.cwd() / "public" / "demo_paper.pdf",
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


def _load_static_bundle() -> Dict[str, Any]:
    """读取仓库内预置的 Demo 静态 JSON，失败则抛错由调用方转为 HTTP 异常。"""
    if not DEMO_STATIC_BUNDLE.exists():
        raise FileNotFoundError(f"缺少静态资源: {DEMO_STATIC_BUNDLE}")
    raw = json.loads(DEMO_STATIC_BUNDLE.read_text(encoding="utf-8"))
    if not (raw.get("markdown") and isinstance(raw.get("sections"), list)):
        raise ValueError("demo_static_bundle.json 格式无效：需要 markdown 与 sections")
    return raw


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


async def warm_demo_global_assets() -> None:
    """
    启动时预热：从 demo_static_bundle.json 读取 Markdown，写入 global_demo_official 向量索引（无 MinerU）。
    不触碰任何用户 session。
    """
    if not _find_demo_pdf():
        logger.warning("Demo 预热跳过：未找到 demo_paper.pdf")
        return
    try:
        bundle = _load_static_bundle()
    except Exception as e:
        logger.warning("Demo 预热跳过：无法读取静态 bundle: %s", e)
        return
    markdown = bundle.get("markdown") or ""
    if not markdown.strip():
        logger.warning("Demo 预热跳过：静态 bundle 中 markdown 为空")
        return
    if _is_demo_indexed():
        logger.info("Demo 全局向量索引已就绪，跳过预热")
        return
    async with _DEMO_LOCK:
        if _is_demo_indexed():
            return
        try:
            _ensure_demo_index(markdown)
            logger.info("Demo 全局向量预热完成: doc_id=%s", DEMO_DOC_ID)
        except Exception as e:
            logger.warning("Demo 向量预热失败（检索可能不可用）: %s", e)


@router.post("/load")
async def load_demo(session_id: str = Depends(get_session_id)):
    """
    清空当前会话，并挂载全局 demo 文档。
    仅从 demo_static_bundle.json 读取解析结果，不调用 MinerU。Demo 笔记由前端 Local-First 管理，不落库到服务端会话。
    """
    _clear_session(session_id)

    if not _find_demo_pdf():
        raise HTTPException(status_code=404, detail="Demo 白皮书文件不存在")

    try:
        cache = _load_static_bundle()
    except FileNotFoundError as e:
        raise HTTPException(
            status_code=500,
            detail=f"Demo 静态数据未部署: {e}",
        ) from e
    except (json.JSONDecodeError, ValueError) as e:
        raise HTTPException(
            status_code=500,
            detail=f"Demo 静态数据无效: {e}",
        ) from e

    markdown = cache.get("markdown") or ""
    indexed_before = _is_demo_indexed()
    if not indexed_before:
        async with _DEMO_LOCK:
            if not _is_demo_indexed():
                try:
                    _ensure_demo_index(markdown)
                except Exception as e:
                    logger.warning("Demo 向量索引失败: %s", e)

    indexed_after = _is_demo_indexed()
    logger.info(
        "Demo 加载完成: session=%s static=True indexed=%s doc_id=%s",
        (session_id or "")[:16],
        indexed_after,
        DEMO_DOC_ID,
    )
    return {
        "ok": True,
        "cached": True,
        "doc_id": DEMO_DOC_ID,
        "title": cache.get("title") or "demo_paper.pdf",
        "file_url": "/api/demo/pdf",
        "pdf_url": "/api/demo/pdf",
        "markdown": markdown,
        "sections": cache.get("sections") or [],
        "demo_notes": cache.get("demo_notes") or [],
        "parsed_data": markdown,
        "tree_data": cache.get("sections") or [],
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
