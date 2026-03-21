"""
UGC 知识碎片蒸馏服务（Secretary Agent）
将口语化文本重写为结构化原子卡片：
{
  "axiom": "...",
  "method": "...",
  "boundary": "...",
  "tags": ["..."]
}
"""

import json
import logging
import os
import re
from typing import Dict, List

logger = logging.getLogger("aether")


def _fallback_distill(text: str) -> Dict[str, object]:
    """当 LLM 不可用时的兜底蒸馏，保证接口可用。"""
    normalized = re.sub(r"\s+", " ", (text or "").strip())
    short = normalized[:280]
    tags = list({w.lower() for w in re.findall(r"[a-zA-Z]{3,}", normalized)[:8]})
    return {
        "axiom": short or "未提取到核心公理",
        "method": "请补充可执行步骤；当前为口语化记录，尚未形成方法论。",
        "boundary": "该结论为草稿输入，适用范围与反例仍待验证。",
        "tags": tags[:6],
        "is_mock": True,
    }


def _extract_json(raw: str) -> Dict[str, object]:
    """尽量从 LLM 响应中抽取 JSON。"""
    if not raw:
        raise ValueError("empty response")
    start = raw.find("{")
    end = raw.rfind("}")
    if start < 0 or end <= start:
        raise ValueError("json braces not found")
    data = json.loads(raw[start : end + 1])
    if not isinstance(data, dict):
        raise ValueError("json is not an object")
    return data


async def distill_note_text(text: str) -> Dict[str, object]:
    """将 UGC 文本蒸馏为结构化原子卡片。"""
    source = (text or "").strip()
    if not source:
        return _fallback_distill(text)

    api_key = os.getenv("DEEPSEEK_API_KEY", "")
    api_base = os.getenv("DEEPSEEK_API_BASE", "https://api.deepseek.com")
    if not api_key:
        logger.warning("[Distill] DEEPSEEK_API_KEY 未配置，使用 fallback")
        return _fallback_distill(source)

    prompt = f"""
请将以下用户输入蒸馏为学术知识卡片。
你扮演“学术秘书（Secretary Agent）”：要把口语、聊天记录、网页摘录改写为严谨表述。

用户输入：
{source[:5000]}

输出要求（必须严格 JSON，且仅返回 JSON）：
{{
  "axiom": "一句话核心结论/公理",
  "method": "一句话方法路径（可执行）",
  "boundary": "一句话适用边界/限制",
  "tags": ["3-8个关键词，尽量短"]
}}
"""

    try:
        from openai import AsyncOpenAI

        client = AsyncOpenAI(api_key=api_key, base_url=api_base)
        resp = await client.chat.completions.create(
            model="deepseek-chat",
            temperature=0.2,
            max_tokens=700,
            messages=[
                {
                    "role": "system",
                    "content": "你是严谨的学术秘书。只输出合法 JSON，不要输出任何额外文字。",
                },
                {"role": "user", "content": prompt},
            ],
        )
        raw = (resp.choices[0].message.content or "").strip()
        data = _extract_json(raw)
        axiom = str(data.get("axiom", "")).strip()
        method = str(data.get("method", "")).strip()
        boundary = str(data.get("boundary", "")).strip()
        tags: List[str] = data.get("tags") if isinstance(data.get("tags"), list) else []
        tags = [str(t).strip() for t in tags if str(t).strip()][:8]
        if not (axiom and method and boundary):
            raise ValueError("missing fields in llm json")
        return {
            "axiom": axiom,
            "method": method,
            "boundary": boundary,
            "tags": tags,
            "is_mock": False,
        }
    except Exception as e:
        logger.warning("[Distill] LLM 蒸馏失败，fallback: %s", e)
        return _fallback_distill(source)
