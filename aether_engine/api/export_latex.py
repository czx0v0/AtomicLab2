"""
LaTeX 项目导出：ZIP（main.tex + references.bib）与一次性下载令牌。
"""
import secrets
import threading
import time
from typing import Dict, Optional, Tuple

from fastapi import APIRouter, Header, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, Field

from api.notes import IN_MODELSCOPE_SPACE
from service.latex_exporter import build_latex_zip_bytes, debug_latex_error

router = APIRouter(prefix="/export", tags=["export"])

# token -> (created_ts, zip_bytes)
_EXPORT_CACHE: Dict[str, Tuple[float, bytes]] = {}
_CACHE_LOCK = threading.Lock()
_CACHE_TTL = 900.0
_MAX_CACHE = 64


def _session_id(x_session_id: str) -> Optional[str]:
    return x_session_id if IN_MODELSCOPE_SPACE else None


def _purge_cache() -> None:
    now = time.time()
    with _CACHE_LOCK:
        dead = [k for k, (ts, _) in _EXPORT_CACHE.items() if now - ts > _CACHE_TTL]
        for k in dead:
            _EXPORT_CACHE.pop(k, None)
        while len(_EXPORT_CACHE) > _MAX_CACHE:
            oldest = min(_EXPORT_CACHE.items(), key=lambda x: x[1][0])[0]
            _EXPORT_CACHE.pop(oldest, None)


def _store_zip(data: bytes) -> str:
    _purge_cache()
    token = secrets.token_urlsafe(24)
    with _CACHE_LOCK:
        _EXPORT_CACHE[token] = (time.time(), data)
    return token


def store_export_zip(data: bytes) -> str:
    """供 Agent 工具等复用：缓存 ZIP 并返回下载 token。"""
    return _store_zip(data)


class LatexZipRequest(BaseModel):
    markdown: str = Field(..., description="Markdown 草稿全文")
    template: str = Field("ieee", description="ieee | acm（当前仅实现 ieee）")


@router.post("/latex_zip")
def post_latex_zip(
    body: LatexZipRequest,
    x_session_id: str = Header(default=""),
):
    """
    生成 LaTeX 项目 ZIP：main.tex + references.bib + README.txt，直接下载。
    """
    md = (body.markdown or "").strip()
    if not md:
        raise HTTPException(status_code=400, detail="markdown 不能为空")
    if body.template not in ("ieee", "acm"):
        body.template = "ieee"

    sid = _session_id(x_session_id)
    try:
        zip_bytes, meta = build_latex_zip_bytes(md, sid)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"生成失败: {e}") from e

    fname = f"atomiclab_latex_{int(time.time())}.zip"
    return Response(
        content=zip_bytes,
        media_type="application/zip",
        headers={
            "Content-Disposition": f'attachment; filename="{fname}"',
            "X-Export-Meta": __import__("json").dumps(meta, ensure_ascii=False)[:2000],
        },
    )


class LatexZipJsonResponse(BaseModel):
    ok: bool = True
    download_url: str
    token: str
    meta: dict


@router.post("/latex_zip/token")
def post_latex_zip_token(body: LatexZipRequest, x_session_id: str = Header(default="")):
    """
    生成 ZIP 并返回一次性下载 URL（供 Agent 工具 / 自动化，不返回大文件体）。
    """
    md = (body.markdown or "").strip()
    if not md:
        raise HTTPException(status_code=400, detail="markdown 不能为空")
    sid = _session_id(x_session_id)
    zip_bytes, meta = build_latex_zip_bytes(md, sid)
    token = _store_zip(zip_bytes)
    # 相对路径，前端拼接 BASE_URL
    return {
        "ok": True,
        "download_url": f"/api/export/latex_zip/download/{token}",
        "token": token,
        "meta": meta,
    }


@router.get("/latex_zip/download/{token}")
def get_latex_zip_download(token: str):
    with _CACHE_LOCK:
        entry = _EXPORT_CACHE.pop(token, None)
    if not entry:
        raise HTTPException(status_code=404, detail="下载链接已失效或已使用")
    ts, data = entry
    if time.time() - ts > _CACHE_TTL:
        raise HTTPException(status_code=410, detail="下载已过期")
    return Response(
        content=data,
        media_type="application/zip",
        headers={
            "Content-Disposition": 'attachment; filename="atomiclab_latex.zip"',
        },
    )


class DebugLatexRequest(BaseModel):
    error_log: str = ""
    latex_snippet: str = ""


@router.post("/debug_latex")
def post_debug_latex(body: DebugLatexRequest):
    text = debug_latex_error(body.error_log, body.latex_snippet)
    return {"analysis": text}
