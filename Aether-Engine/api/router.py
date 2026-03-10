from fastapi import APIRouter

from api.health import router as health_router
from api.parser import router as parser_router

root_router = APIRouter()
root_router.include_router(health_router)
root_router.include_router(parser_router, prefix="/api")
