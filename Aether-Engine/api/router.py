from fastapi import APIRouter

from api.health import router as health_router
from api.parser import router as parser_router
from api.notes import router as notes_router
from api.search import router as search_router
from api.translate import router as translate_router
from api.arxiv import router as arxiv_router

root_router = APIRouter()
root_router.include_router(health_router)
root_router.include_router(parser_router, prefix="/api")
root_router.include_router(notes_router, prefix="/api")
root_router.include_router(search_router, prefix="/api")
root_router.include_router(translate_router, prefix="/api")
root_router.include_router(arxiv_router, prefix="/api")
