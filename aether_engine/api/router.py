from fastapi import APIRouter

from api.health import router as health_router
from api.parser import router as parser_router
from api.notes import router as notes_router
from api.search import router as search_router
from api.translate import router as translate_router
from api.arxiv import router as arxiv_router
from api.chat import router as chat_router
from api.documents import router as documents_router
from api.domains import router as domains_router
from api.writing import router as writing_router
from api.reset import router as reset_router
from api.demo import router as demo_router
from api.atomic import router as atomic_router
from api.note import router as note_router
from api.organize import router as organize_router
from api.arxiv_secretary import router as arxiv_secretary_router
from api.export_latex import router as export_latex_router

root_router = APIRouter()
root_router.include_router(health_router)  # health 已有自己的/api 前缀
root_router.include_router(parser_router, prefix="/api")
root_router.include_router(reset_router, prefix="/api")
root_router.include_router(demo_router, prefix="/api")
root_router.include_router(notes_router, prefix="/api")
root_router.include_router(atomic_router, prefix="/api")
root_router.include_router(note_router, prefix="/api")
root_router.include_router(organize_router, prefix="/api")
root_router.include_router(arxiv_secretary_router, prefix="/api")
root_router.include_router(export_latex_router, prefix="/api")
root_router.include_router(search_router, prefix="/api")
root_router.include_router(translate_router, prefix="/api")
root_router.include_router(arxiv_router, prefix="/api")
root_router.include_router(chat_router, prefix="/api")
root_router.include_router(documents_router, prefix="/api")
root_router.include_router(domains_router, prefix="/api")
root_router.include_router(writing_router, prefix="/api")
