"""
原子能力编排层（可插拔）。
默认保持现有行为，仅在 ATOMIC_ENGINE=heuristic 时走轻量规则路径，便于实验对照。
"""

import os
from typing import Dict

from service.atomic_decomposer import decompose_note as llm_decompose_note
from service.note_distiller import distill_note_text as llm_distill_note_text


def _engine_mode() -> str:
    return (os.getenv("ATOMIC_ENGINE", "default") or "default").strip().lower()


async def distill_note_text(text: str) -> Dict[str, object]:
    mode = _engine_mode()
    if mode == "heuristic":
        from service.note_distiller import _fallback_distill

        return _fallback_distill(text or "")
    return await llm_distill_note_text(text)


async def decompose_note(
    note_content: str,
    note_id: str = "note_0",
    doc_id: str = "",
) -> Dict[str, object]:
    mode = _engine_mode()
    if mode == "heuristic":
        return {
            "note_id": note_id,
            "doc_id": doc_id,
            "atoms": [],
            "is_mock": True,
            "message": "ATOMIC_ENGINE=heuristic，返回空解构（实验模式）",
        }
    return await llm_decompose_note(note_content, note_id, doc_id)
