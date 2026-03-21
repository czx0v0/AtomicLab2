"""
课题研究待办：LLM 生成 JSON 列表（与 Goal Map 计划一致）。
"""
from __future__ import annotations

import json
import logging
import os
import re
import uuid
from typing import Any, Dict, List

logger = logging.getLogger("aether")


def _call_planner_llm(system: str, user: str, max_tokens: int = 2000) -> str:
    api_key = os.getenv("DEEPSEEK_API_KEY")
    api_base = os.getenv("DEEPSEEK_API_BASE", "https://api.deepseek.com")
    if not api_key:
        return ""
    from openai import OpenAI

    client = OpenAI(api_key=api_key, base_url=api_base)
    resp = client.chat.completions.create(
        model=os.getenv("DEEPSEEK_CHAT_MODEL", "deepseek-chat"),
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        max_tokens=max_tokens,
        temperature=0.25,
    )
    return (resp.choices[0].message.content or "").strip()


def _strip_json_fence(s: str) -> str:
    s = s.strip()
    s = re.sub(r"^```(?:json)?\s*", "", s, flags=re.I)
    s = re.sub(r"\s*```\s*$", "", s)
    return s.strip()


def generate_research_todos(
    *,
    title: str = "",
    target_journal: str = "",
    goal: str = "",
    status: str = "",
) -> List[Dict[str, Any]]:
    """
    返回 [{ "id": str, "text": str }] ，id 由服务端生成 UUID。
    无 API Key 时返回基于模板的离线列表。
    """
    title = (title or "").strip() or "当前课题"
    tj = (target_journal or "").strip() or "未指定"
    goal = (goal or "").strip()
    st = (status or "").strip() or "未知阶段"

    system = (
        "你是科研规划助手。只输出**一个** JSON 对象，不要 Markdown 围栏。"
        '格式严格为：{"items":[{"text":"..."},...]}，6 到 12 条，'
        "每条 text 为一句可执行的中文待办（动词开头、可检验）。"
        "覆盖：文献调研、方法/实验设计、写作与修改、投稿准备等，贴合用户课题目标。"
    )
    user = (
        f"课题标题：{title}\n"
        f"投稿/毕业目标：{tj}\n"
        f"当前阶段：{st}\n"
        f"课题目标/计划：\n{goal or '（未填写，请根据标题推断合理步骤）'}\n"
    )

    raw = _call_planner_llm(system, user, max_tokens=2000)
    raw = _strip_json_fence(raw)
    items: List[Dict[str, Any]] = []
    try:
        data = json.loads(raw)
        arr = data.get("items") if isinstance(data, dict) else None
        if isinstance(arr, list):
            for it in arr:
                if isinstance(it, dict) and isinstance(it.get("text"), str) and it["text"].strip():
                    items.append({"id": str(uuid.uuid4()), "text": it["text"].strip()[:500]})
                elif isinstance(it, str) and it.strip():
                    items.append({"id": str(uuid.uuid4()), "text": it.strip()[:500]})
    except Exception as e:
        logger.warning("planner JSON parse failed: %s", e)

    if not items:
        items = [
            {"id": str(uuid.uuid4()), "text": f"检索与「{title}」相关的高被引综述 5–8 篇并做笔记"},
            {"id": str(uuid.uuid4()), "text": "整理研究问题、假设与贡献点（各 1 段）"},
            {"id": str(uuid.uuid4()), "text": "完成方法/实验设计小节初稿并与导师对齐"},
            {"id": str(uuid.uuid4()), "text": "完成论文初稿并自查逻辑与引用格式"},
            {"id": str(uuid.uuid4()), "text": f"按 {tj} 要求检查篇幅、匿名与补充材料"},
        ]
    return items[:16]
