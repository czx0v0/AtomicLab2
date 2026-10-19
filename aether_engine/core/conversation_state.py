"""会话级工作记忆（ConversationState）持久化。

用于多轮对话的「工作记忆」：记录当前意图、最近检索证据、未解决子问题、
已确认结论，跨轮持久化（避免每轮无状态、重复检索）。

用法：
    from core.conversation_state import load_state, save_state
    state = load_state(session_id)      # 加载（不存在返回空状态）
    state["turn"] += 1
    state["last_question"] = question
    save_state(session_id, state)       # 持久化（线程安全）

设计约定：
    - 持久化失败不抛异常（不影响主流程）；
    - 损坏/缺失字段自动补齐为默认值；
    - 文件按会话隔离：data/conversation_state_{sid}.json（尊重 DATA_DIR）。
"""
import json
import threading
from pathlib import Path
from typing import Any, Dict, Optional

from core.paths import data_path
from core.session import sanitize_session_id

_lock = threading.RLock()


def _empty_state() -> Dict[str, Any]:
    """默认空工作记忆。"""
    return {
        "intent": "",             # 当前任务意图
        "evidence_cache": [],     # 最近检索证据（doc_id + score + 摘要）
        "subquestions": [],       # 未解决子问题（多跳拆解）
        "concluded": [],          # 已确认结论（每轮 1-2 句摘要）
        "last_question": "",      # 上一轮问题（判断追问用）
        "turn": 0,                # 轮次
    }


def _state_file(session_id: Optional[str]) -> Path:
    sid = sanitize_session_id(session_id or "")
    return data_path(f"conversation_state_{sid}.json")


def load_state(session_id: Optional[str]) -> Dict[str, Any]:
    """加载会话工作记忆；不存在或损坏则返回空状态。"""
    p = _state_file(session_id)
    try:
        if p.exists():
            data = json.loads(p.read_text(encoding="utf-8"))
            if isinstance(data, dict):
                base = _empty_state()
                base.update(data)
                return base
    except Exception:
        pass
    return _empty_state()


def save_state(session_id: Optional[str], state: Dict[str, Any]) -> None:
    """持久化会话工作记忆（线程安全，失败静默）。"""
    p = _state_file(session_id)
    with _lock:
        try:
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text(
                json.dumps(state, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
        except Exception:
            pass
