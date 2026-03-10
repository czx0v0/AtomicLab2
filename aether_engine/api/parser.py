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
        parse_pdf_with_mineru(content, file.filename or "uploaded.pdf", method=method),
        media_type="text/event-stream",
    )
