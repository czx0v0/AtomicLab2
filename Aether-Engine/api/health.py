import time

from fastapi import APIRouter

router = APIRouter(prefix="/api", tags=["health"])

_start_time = time.time()


@router.get("/health")
def health_check() -> dict:
    return {
        "status": "ok",
        "uptime_seconds": round(time.time() - _start_time, 2),
    }
