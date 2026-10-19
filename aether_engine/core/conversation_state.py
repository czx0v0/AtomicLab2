"""会话级工作记忆（ConversationState）持久化。

用于多轮对话的「工作记忆」：记录当前意图、最近检索证据、未解决子问题、
已确认结论，跨轮持久化（避免每轮无状态、重复检索）。

用法：
    from core.conversation_state import load_state, save_state, ConversationState
    state = load_state(session_id)      # 加载（不存在返回默认空状态）
    state.turn += 1
    state.last_question = question
    save_state(session_id, state)       # 持久化（线程安全）

设计约定：
    - Pydantic 强类型（字段校验 + 默认值 + 序列化）；
    - 持久化失败不抛异常（不影响主流程）；
    - 损坏/缺失字段自动回退默认值；
    - 文件按会话隔离：data/conversation_state_{sid}.json（尊重 DATA_DIR）。
"""
import threading
from pathlib import Path
from typing import List, Optional

from pydantic import BaseModel, Field

from core.paths import data_path
from core.session import sanitize_session_id

_lock = threading.RLock()


class ConversationState(BaseModel):
    """会话工作记忆（强类型）。"""

    intent: str = ""                        # 当前任务意图
    evidence_cache: List[dict] = Field(default_factory=list)   # 最近检索证据
    subquestions: List[str] = Field(default_factory=list)      # 未解决子问题（多跳拆解）
    concluded: List[str] = Field(default_factory=list)         # 已确认结论（每轮 1-2 句摘要）
    last_question: str = ""                 # 上一轮问题（判断追问用）
    turn: int = 0                           # 轮次


def _state_file(session_id: Optional[str]) -> Path:
    sid = sanitize_session_id(session_id or "")
    return data_path(f"conversation_state_{sid}.json")


def load_state(session_id: Optional[str]) -> ConversationState:
    """加载会话工作记忆；不存在或损坏则返回默认空状态。"""
    p = _state_file(session_id)
    try:
        if p.exists():
            return ConversationState.model_validate_json(p.read_text(encoding="utf-8"))
    except Exception:
        pass
    return ConversationState()


def save_state(session_id: Optional[str], state: ConversationState) -> None:
    """持久化会话工作记忆（线程安全，失败静默）。"""
    p = _state_file(session_id)
    with _lock:
        try:
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text(state.model_dump_json(indent=2), encoding="utf-8")
        except Exception:
            pass


def clear_state(session_id: Optional[str]) -> None:
    """清空会话工作记忆（删除状态文件，失败静默）。"""
    p = _state_file(session_id)
    with _lock:
        try:
            if p.exists():
                p.unlink()
        except Exception:
            pass
