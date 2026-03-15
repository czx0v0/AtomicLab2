"""
Demo 白皮书：仅提供 demo_data/demo_paper.pdf 文件流。
点击「加载白皮书」后前端拉取该 PDF，当作用户上传并走解析流程。
"""

import logging
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse

from core.session import get_session_id, sanitize_session_id

router = APIRouter(prefix="/demo", tags=["demo"])
logger = logging.getLogger("aether")

_ENGINE_ROOT = Path(__file__).resolve().parent.parent
DEMO_DIR = _ENGINE_ROOT / "demo_data"
DEMO_PDF = (DEMO_DIR / "demo_paper.pdf").resolve()
DATA_DIR = Path("data")


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


@router.post("/load")
def load_demo(session_id: str = Depends(get_session_id)):
    """清空当前会话，便于前端随后拉取 demo PDF 并当作用户上传解析。"""
    _clear_session(session_id)
    logger.info("Demo 会话已清空: session_id=%s", (session_id or "")[:16])
    return {"ok": True}


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
