import logging
from fastapi import APIRouter, File, UploadFile, HTTPException
from service.parser import parse_pdf_with_mineru

router = APIRouter(prefix="/parse-document", tags=["parser"])
logger = logging.getLogger("uvicorn.error")


@router.post("")
async def parse_document(file: UploadFile = File(...)):
    """
    Receives a PDF and synchronously extracts Markdown via local MinerU CLI.
    """
    if file.filename and not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are supported.")

    try:
        content = await file.read()
        markdown_result = await parse_pdf_with_mineru(
            content, file.filename or "uploaded.pdf"
        )

        return {
            "status": "success",
            "filename": file.filename,
            "markdown": markdown_result,
        }
    except RuntimeError as re:
        logger.error(f"MinerU integration error: {re}")
        raise HTTPException(status_code=500, detail=str(re))
    except Exception as e:
        logger.exception(f"Unexpected error parsing document: {e}")
        raise HTTPException(
            status_code=500, detail="An unexpected error occurred during parsing."
        )
