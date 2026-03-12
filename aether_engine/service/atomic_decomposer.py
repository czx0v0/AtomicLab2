"""
原子知识解构服务
================
基于 LLM 将学术笔记解构为三层结构：
  - Axiom（公理）：核心概念或事实
  - Methodology（方法）：技术路径或方法
  - Boundary（边界）：适用范围和限制

分类：Method / Definition / Formula / Context / Data / Result / Insight
"""

import hashlib
import json
import logging
import os
from typing import Dict, List, Optional

logger = logging.getLogger("aether")

# 内存缓存（进程级）
_cache: Dict[str, dict] = {}


def _cache_key(content: str) -> str:
    return hashlib.md5(content.encode()).hexdigest()


async def decompose_note(
    note_content: str,
    note_id: str = "note_0",
    doc_id: str = "",
) -> dict:
    """
    将一条学术笔记解构为原子知识列表。

    Returns:
        {
            "note_id": str,
            "doc_id": str,
            "atoms": [ { knowledge_id, axiom, methodology, boundary,
                          category, confidence, tags } ],
            "is_mock": bool   # True 时说明 API Key 未配置
        }
    """
    key = _cache_key(note_content)
    if key in _cache:
        cached = dict(_cache[key])
        cached["note_id"] = note_id
        cached["doc_id"] = doc_id
        return cached

    api_key = os.getenv("DEEPSEEK_API_KEY", "")
    api_base = os.getenv("DEEPSEEK_API_BASE", "https://api.deepseek.com")

    if not api_key:
        logger.warning("[AtomicDecomposer] DEEPSEEK_API_KEY 未配置，返回空解构")
        return {
            "note_id": note_id,
            "doc_id": doc_id,
            "atoms": [],
            "is_mock": True,
            "message": "DEEPSEEK_API_KEY 未配置，原子解构不可用",
        }

    # ── 构建提示词 ────────────────────────────────────────────────────────────
    content = note_content[:800]

    prompt = f"""请对以下学术笔记进行原子知识解构，提取核心知识的三层结构。

笔记内容：
{content}

解构要求：
1. 将内容分解为 1~3 个原子知识
2. 每个原子知识包含三层：
   - Axiom（公理）：核心概念或事实（一句话）
   - Methodology（方法）：技术路径或方法（一句话）
   - Boundary（边界）：适用范围和限制（一句话）
3. 分类为以下之一：Method / Definition / Formula / Context / Data / Result / Insight

只输出 JSON，不要任何说明文字：
{{
  "atoms": [
    {{
      "axiom": "核心概念或事实",
      "methodology": "技术路径或方法",
      "boundary": "适用范围和限制",
      "category": "Method",
      "confidence": 0.9,
      "tags": ["标签1", "标签2"]
    }}
  ]
}}"""

    # ── 调用 LLM ─────────────────────────────────────────────────────────────
    try:
        from openai import AsyncOpenAI

        client = AsyncOpenAI(api_key=api_key, base_url=api_base)
        resp = await client.chat.completions.create(
            model="deepseek-chat",
            messages=[
                {
                    "role": "system",
                    "content": "你是学术知识解构专家。只输出合法 JSON，不要任何说明文字。",
                },
                {"role": "user", "content": prompt},
            ],
            max_tokens=800,
            temperature=0.3,
        )
        raw = resp.choices[0].message.content.strip()
    except Exception as e:
        logger.error("[AtomicDecomposer] LLM 调用失败: %s", e)
        return {
            "note_id": note_id,
            "doc_id": doc_id,
            "atoms": [],
            "is_mock": False,
            "message": f"LLM 调用失败: {e}",
        }

    # ── 解析 JSON ─────────────────────────────────────────────────────────────
    atoms: List[dict] = []
    try:
        js = raw[raw.find("{") : raw.rfind("}") + 1]
        data = json.loads(js)
        for i, item in enumerate(data.get("atoms", [])):
            atoms.append(
                {
                    "knowledge_id": f"{note_id}_atom_{i}",
                    "axiom": item.get("axiom", ""),
                    "methodology": item.get("methodology", ""),
                    "boundary": item.get("boundary", ""),
                    "category": item.get("category", "Insight"),
                    "confidence": float(item.get("confidence", 0.8)),
                    "tags": item.get("tags", []),
                }
            )
    except Exception as e:
        logger.warning("[AtomicDecomposer] JSON 解析失败: %s | raw=%s", e, raw[:200])

    result = {
        "note_id": note_id,
        "doc_id": doc_id,
        "atoms": atoms,
        "is_mock": False,
    }
    _cache[key] = result
    return result


def clear_cache():
    _cache.clear()
