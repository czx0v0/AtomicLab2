import logging
from fastapi import APIRouter, File, Query, UploadFile, HTTPException
from fastapi.responses import StreamingResponse
from service.parser import parse_pdf_with_mineru

router = APIRouter(prefix="/parse-document", tags=["parser"])
logger = logging.getLogger("uvicorn.error")


@router.post("")
async def parse_document(
    file: UploadFile = File(...),
    method: str = Query(
        "auto",
        pattern="^(auto|txt|ocr)$",
        description="auto=全模态(慢) | txt=纯文本(快) | ocr=OCR模式",
    ),
    section_summary_mode: str = Query(
        "first_paragraph",
        pattern="^(first_paragraph|llm)$",
        description="first_paragraph=首节文本 | llm=DEEPSEEK 短摘要（需 API Key）",
    ),
):
    """
    Receives a PDF and streams extraction logs progressively, ending with the Markdown text.
    Uses Server-Sent Events (SSE).
    """
    if file.filename and not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are supported.")

    try:
        content = await file.read()
    except Exception as e:
        logger.exception("Error reading file.")
        raise HTTPException(status_code=500, detail="Failed to read file.")

    return StreamingResponse(
        parse_pdf_with_mineru(
            content,
            file.filename or "uploaded.pdf",
            method=method,
            section_summary_mode=section_summary_mode,
        ),
        media_type="text/event-stream",
    )
