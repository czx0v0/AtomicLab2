import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI

from api.router import root_router
from config.settings import settings

logger = logging.getLogger("uvicorn.error")


@asynccontextmanager
async def lifespan(application: FastAPI):
    """Startup / shutdown lifecycle hook."""
    logger.info("Aether-Engine starting up (env=%s)", settings.APP_ENV)
    yield
    # ---------- graceful shutdown ----------
    logger.info("Aether-Engine shutting down — releasing resources …")
    # Close DB pools, flush caches, cancel background tasks here.


app = FastAPI(
    title=settings.APP_NAME,
    version=settings.APP_VERSION,
    lifespan=lifespan,
)

app.include_router(root_router)
