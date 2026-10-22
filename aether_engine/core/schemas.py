"""结构化 Schema（Pydantic）：检索证据 + Reviewer 门控输出。

用于边界校验 + 缺省兜底，保证 agent 间传递的结构化中间态字段完整。
"""
from typing import Any, List, Optional

from pydantic import BaseModel, Field


class RetrievedSource(BaseModel):
    """检索证据（Seeker 输出 → Reviewer/Synthesizer 输入）。"""

    note_id: str = ""
    source: str = "note"
    score: Optional[float] = None
    concept: str = ""
    summary: str = ""
    doc_id: str = ""
    doc_title: str = ""
    page: Optional[int] = None
    bbox: Optional[List[float]] = None
    session_doc_unlinked: bool = False
    graph_ref: str = ""
    extra: dict = Field(default_factory=dict)  # 兜底：未枚举字段


class ReviewerResult(BaseModel):
    """Reviewer 门控输出（sufficient/score/reason/suggestion）。"""

    sufficient: bool = True
    score: float = 5.0
    reason: str = ""
    suggestion: str = ""
