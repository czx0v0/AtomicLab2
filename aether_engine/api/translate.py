"""
翻译 API
调用 DeepSeek API 进行学术文本翻译。
"""

import logging
import os
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter(prefix="/translate", tags=["translate"])
logger = logging.getLogger("aether")


class TranslateRequest(BaseModel):
    text: str
    source_lang: str = "auto"
    target_lang: str = "zh"


@router.post("")
async def translate_text(body: TranslateRequest):
    """将学术文本翻译为目标语言（默认中文）。"""
    if not body.text.strip():
        raise HTTPException(status_code=400, detail="翻译内容不能为空")

    if len(body.text) > 5000:
        raise HTTPException(status_code=400, detail="文本长度不能超过 5000 字符")

    logger.info("收到翻译请求: %d 字符 -> %s", len(body.text), body.target_lang)

    api_key = os.getenv("DEEPSEEK_API_KEY")
    api_base = os.getenv("DEEPSEEK_API_BASE", "https://api.deepseek.com")

    if not api_key:
        logger.warning("DEEPSEEK_API_KEY 未配置，返回 mock 翻译")
        return {
            "translation": f"[Mock 翻译] {body.text[:100]}...",
            "source_lang": body.source_lang,
            "target_lang": body.target_lang,
            "is_mock": True,
        }

    try:
        from openai import AsyncOpenAI

        client = AsyncOpenAI(api_key=api_key, base_url=api_base)

        lang_map = {"zh": "中文", "en": "English", "ja": "日語", "ko": "한국어"}
        target = lang_map.get(body.target_lang, body.target_lang)

        resp = await client.chat.completions.create(
            model="deepseek-chat",
            messages=[
                {
                    "role": "system",
                    "content": f"你是专业的学术翻译助手。请将以下文本翻译成{target}，保留专业术语准确性，直接输出翻译结果，不要添加任何解释。",
                },
                {"role": "user", "content": body.text},
            ],
            max_tokens=2000,
            temperature=0.3,
        )
        translation = resp.choices[0].message.content.strip()
        logger.info("翻译成功: %d 字符 -> %d 字符", len(body.text), len(translation))
        return {
            "translation": translation,
            "source_lang": body.source_lang,
            "target_lang": body.target_lang,
        }
    except Exception as e:
        logger.error("翻译失败: %s", e)
        raise HTTPException(status_code=500, detail=f"翻译服务暂时不可用: {str(e)}")
