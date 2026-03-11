"""
会话隔离存储模块
支持多用户 Demo 场景，数据按 session_id 隔离，1小时后自动清理

重要设计决策：
- 会话数据存储在 /tmp，而非持久化存储
- 文献、笔记等数据刷新页面后不保留（Demo 体验模式）
- 重启服务时自动清空所有会话
"""

import os
import time
import shutil
import threading
from pathlib import Path
from datetime import datetime, timedelta
from typing import Dict, Optional, Any, List
import logging

logger = logging.getLogger("aether")

# 会话数据根目录：使用 /tmp 确保数据不持久化
SESSION_ROOT = Path("/tmp/atomiclab_sessions")
SESSION_ROOT.mkdir(parents=True, exist_ok=True)

# 会话过期时间（秒）
SESSION_EXPIRE_SECONDS = 3600  # 1小时

# 内存中的会话元数据
_session_metadata: Dict[str, dict] = {}
_lock = threading.Lock()


def get_session_dir(session_id: str) -> Path:
    """获取会话数据目录"""
    return SESSION_ROOT / session_id


def init_session(session_id: str) -> Path:
    """初始化会话目录，记录活跃时间"""
    with _lock:
        session_dir = get_session_dir(session_id)
        session_dir.mkdir(parents=True, exist_ok=True)

        # 创建子目录
        (session_dir / "documents").mkdir(exist_ok=True)
        (session_dir / "chroma").mkdir(exist_ok=True)

        _session_metadata[session_id] = {
            "created_at": datetime.utcnow(),
            "last_active": datetime.utcnow(),
            "dir": str(session_dir),
        }
        logger.info(f"[Session] 初始化会话: {session_id}")
        return session_dir


def touch_session(session_id: str):
    """更新会话活跃时间"""
    with _lock:
        if session_id in _session_metadata:
            _session_metadata[session_id]["last_active"] = datetime.utcnow()


def get_session_path(session_id: str, *paths: str) -> Path:
    """获取会话内的文件路径"""
    touch_session(session_id)
    return get_session_dir(session_id).joinpath(*paths)


def is_session_valid(session_id: str) -> bool:
    """检查会话是否有效（未过期）"""
    with _lock:
        if session_id not in _session_metadata:
            # 检查目录是否存在（可能是旧会话）
            session_dir = get_session_dir(session_id)
            if session_dir.exists():
                # 恢复会话元数据
                _session_metadata[session_id] = {
                    "created_at": datetime.utcnow(),
                    "last_active": datetime.utcnow(),
                    "dir": str(session_dir),
                }
                return True
            return False

        last_active = _session_metadata[session_id]["last_active"]
        if datetime.utcnow() - last_active > timedelta(seconds=SESSION_EXPIRE_SECONDS):
            return False
        return True


def cleanup_expired_sessions():
    """清理过期会话数据"""
    with _lock:
        now = datetime.utcnow()
        expired_sessions = []

        for session_id, meta in list(_session_metadata.items()):
            last_active = meta["last_active"]
            if now - last_active > timedelta(seconds=SESSION_EXPIRE_SECONDS):
                expired_sessions.append(session_id)

        for session_id in expired_sessions:
            try:
                session_dir = get_session_dir(session_id)
                if session_dir.exists():
                    shutil.rmtree(session_dir)
                    logger.info(f"[Session] 清理过期会话: {session_id}")
                del _session_metadata[session_id]
            except Exception as e:
                logger.error(f"[Session] 清理会话失败 {session_id}: {e}")


def start_cleanup_scheduler(interval_seconds: int = 300):
    """启动定时清理任务（每5分钟检查一次）"""

    def cleanup_loop():
        while True:
            time.sleep(interval_seconds)
            try:
                cleanup_expired_sessions()
            except Exception as e:
                logger.error(f"[Session] 清理任务出错: {e}")

    thread = threading.Thread(target=cleanup_loop, daemon=True)
    thread.start()
    logger.info(f"[Session] 启动清理调度器，间隔 {interval_seconds} 秒")


# 会话级数据存储（内存 + 文件混合）
class SessionDataStore:
    """会话数据存储，支持笔记、文档元数据等"""

    _memory_store: Dict[str, Dict[str, Any]] = {}

    @classmethod
    def get(cls, session_id: str, key: str, default=None):
        """获取会话数据"""
        touch_session(session_id)
        session_data = cls._memory_store.get(session_id, {})
        return session_data.get(key, default)

    @classmethod
    def set(cls, session_id: str, key: str, value: Any):
        """设置会话数据"""
        touch_session(session_id)
        if session_id not in cls._memory_store:
            cls._memory_store[session_id] = {}
        cls._memory_store[session_id][key] = value

    @classmethod
    def delete(cls, session_id: str, key: str):
        """删除会话数据"""
        touch_session(session_id)
        if session_id in cls._memory_store and key in cls._memory_store[session_id]:
            del cls._memory_store[session_id][key]

    @classmethod
    def cleanup_session(cls, session_id: str):
        """清理会话内存数据"""
        if session_id in cls._memory_store:
            del cls._memory_store[session_id]


# 启动时清理所有旧会话（重启后）
def cleanup_all_sessions():
    """清理所有会话数据（用于重启后）"""
    try:
        for session_dir in SESSION_ROOT.iterdir():
            if session_dir.is_dir():
                shutil.rmtree(session_dir)
                logger.info(f"[Session] 清理旧会话: {session_dir.name}")
        _session_metadata.clear()
        SessionDataStore._memory_store.clear()
    except Exception as e:
        logger.error(f"[Session] 清理所有会话失败: {e}")
