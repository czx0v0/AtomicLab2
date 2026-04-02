"""按需 LLM 章节摘要（与流式解析中的 _llm_enhance_summary 同源）。"""

import asyncio
import os

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from service.parser import _llm_enhance_summary, _split_sections

router = APIRouter(prefix="/sections", tags=["sections"])


class LlmSummarizeBody(BaseModel):
    markdown: str = Field("", description="与当前文献一致的完整 Markdown")


@router.post("/llm-summarize")
async def llm_summarize_sections(body: LlmSummarizeBody):
    md = (body.markdown or "").strip()
    if not md:
        raise HTTPException(status_code=400, detail="markdown 不能为空")

    if not (os.getenv("DEEPSEEK_API_KEY", "") or "").strip():
        raise HTTPException(
            status_code=503,
            detail="未配置 DEEPSEEK_API_KEY，无法生成智能摘要",
        )

    sections = _split_sections(md)
    out = []
    for sec in sections:
        try:
            enhanced = await asyncio.to_thread(
                _llm_enhance_summary,
                sec["title"],
                sec["content"],
                sec["summary"],
            )
        except Exception as e:
            raise HTTPException(
                status_code=503,
                detail=f"LLM 摘要失败: {e!s}",
            ) from e
        out.append(
            {
                "title": sec["title"],
                "content": sec["content"],
                "summary": enhanced,
                "image_refs": sec.get("image_refs", []),
            }
        )

    return {"sections": out}
