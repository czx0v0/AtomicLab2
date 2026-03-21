import asyncio
import logging
import logging.config
import time
from contextlib import asynccontextmanager

from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from api.demo import warm_demo_global_assets
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
}
logging.config.dictConfig(LOGGING_CONFIG)
logger = logging.getLogger("aether")


@asynccontextmanager
async def lifespan(application: FastAPI):
    """Startup / shutdown lifecycle hook."""
    logger.info("=" * 50)
    logger.info(
        "🚀 Aether-Engine 启动中 (env=%s, version=%s)",
        settings.APP_ENV,
        settings.APP_VERSION,
    )
    logger.info(
        "   监听地址: http://%s:%s", settings.UVICORN_HOST, settings.UVICORN_PORT
    )
    logger.info(
        "   API文档:  http://%s:%s/docs", settings.UVICORN_HOST, settings.UVICORN_PORT
    )
    logger.info("=" * 50)
    # Demo 只读单例预热（不阻塞启动；失败时首次 POST /api/demo/load 仍会解析）
    try:
        asyncio.create_task(warm_demo_global_assets())
    except Exception as e:
        logger.warning("Demo 预热任务未启动: %s", e)
    yield
    logger.info("Aether-Engine 关闭中 — 释放资源…")


app = FastAPI(
    title=settings.APP_NAME,
    version=settings.APP_VERSION,
    description="AtomicLab 后端引擎：PDF解析 · GraphRAG检索 · 多智能体协同",
    lifespan=lifespan,
)

# ── CORS（允许前端跨域并携带凭证，与 Vite proxy 端口一致）──────────────
# 使用 * 时浏览器不允许携带 credentials，故显式列出 origin
_app_origins = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:5174",
    "http://127.0.0.1:5174",
    "http://0.0.0.0:5173",
    "http://0.0.0.0:5174",
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_app_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["*"],
)


# ── 请求日志 Middleware ───────────────────────────────────────────────
@app.middleware("http")
async def log_requests(request: Request, call_next):
    start_time = time.time()
    print(f"→ {request.method} {request.url.path}")  # Debug print
    logger.info("→ %s %s", request.method, request.url.path)
    response = await call_next(request)
    duration = (time.time() - start_time) * 1000
    print(
        f"← {request.method} {request.url.path} [{response.status_code}] {duration:.2f}ms"
    )  # Debug print
    logger.info(
        "← %s %s [%d] %.2fms",
        request.method,
        request.url.path,
        response.status_code,
        duration,
    )
    return response


app.include_router(root_router)

# ── parse-images 静态目录（PDF 解析图片持久化）─────────────────────────
_parse_images_dir = Path(__file__).resolve().parent / "data" / "parse_images"
_parse_images_dir.mkdir(parents=True, exist_ok=True)
app.mount(
    "/api/parse-images",
    StaticFiles(directory=str(_parse_images_dir)),
    name="parse-images",
)

# ── 前端静态资源（SPA 模式）──────────────────────────────────────────────
# 容器环境：静态文件在 /home/user/app/static（与 Dockerfile 一致）
_static_dir = Path("/home/user/app/static")
if not _static_dir.exists():
    # 本地开发：静态文件在 aether_engine/../static
    _static_dir = Path(__file__).resolve().parent.parent / "static"

if _static_dir.exists():
    # 挂载 assets 目录
    _assets_dir = _static_dir / "assets"
    if _assets_dir.exists():
        app.mount("/assets", StaticFiles(directory=str(_assets_dir)), name="assets")

    # 根路由返回 index.html
    from fastapi.responses import FileResponse

    @app.get("/", include_in_schema=False)
    async def root():
        return FileResponse(str(_static_dir / "index.html"))

    # SPA 回退：所有非 API 路由返回 index.html
    @app.get("/{full_path:path}", include_in_schema=False)
    async def spa_fallback(full_path: str):
        # 排除 API 路由和静态文件
        if full_path.startswith("api/") or full_path.startswith("assets/"):
            return {"detail": "Not Found"}
        return FileResponse(str(_static_dir / "index.html"))
