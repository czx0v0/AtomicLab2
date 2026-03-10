import logging
import logging.config
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from api.router import root_router
from config.settings import settings

# ── 日志配置 ──────────────────────────────────────────────────────────
LOGGING_CONFIG = {
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {
        "detailed": {
            "format": "%(asctime)s [%(levelname)s] %(name)s: %(message)s",
            "datefmt": "%Y-%m-%d %H:%M:%S",
        }
    },
    "handlers": {
        "console": {
            "class": "logging.StreamHandler",
            "formatter": "detailed",
            "stream": "ext://sys.stdout",
        }
    },
    "root": {"handlers": ["console"], "level": settings.LOG_LEVEL.upper()},
    "loggers": {
        "uvicorn": {"handlers": ["console"], "level": "INFO", "propagate": False},
        "uvicorn.error": {"handlers": ["console"], "level": "INFO", "propagate": False},
        "uvicorn.access": {"handlers": ["console"], "level": "INFO", "propagate": False},
    },
}
logging.config.dictConfig(LOGGING_CONFIG)
logger = logging.getLogger("aether")


@asynccontextmanager
async def lifespan(application: FastAPI):
    """Startup / shutdown lifecycle hook."""
    logger.info("="*50)
    logger.info("🚀 Aether-Engine 启动中 (env=%s, version=%s)", settings.APP_ENV, settings.APP_VERSION)
    logger.info("   监听地址: http://%s:%s", settings.UVICORN_HOST, settings.UVICORN_PORT)
    logger.info("   API文档:  http://%s:%s/docs", settings.UVICORN_HOST, settings.UVICORN_PORT)
    logger.info("="*50)
    yield
    logger.info("Aether-Engine 关闭中 — 释放资源…")


app = FastAPI(
    title=settings.APP_NAME,
    version=settings.APP_VERSION,
    description="AtomicLab 后端引擎：PDF解析 · GraphRAG检索 · 多智能体协同",
    lifespan=lifespan,
)

# ── CORS（允许本地前端跨域访问）──────────────────────────────────────
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173", "*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(root_router)
