"""
ArXiv 学术追踪秘书：拉取最新论文 + LLM 预读过滤 + 收件箱持久化。
"""
from __future__ import annotations

import json
import logging
import re
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

import httpx

from api.arxiv import ARXIV_API, _parse_arxiv_response

logger = logging.getLogger("aether")

# 与 api.notes 一致
import os

IN_MODELSCOPE_SPACE = os.path.exists("/mnt/workspace")


def _get_inbox_path(session_id: Optional[str] = None) -> Path:
    if IN_MODELSCOPE_SPACE and session_id:
        from core.session_store import get_session_path, init_session

        init_session(session_id)
        return get_session_path(session_id, "arxiv_inbox.json")
    return Path("data/arxiv_inbox.json")


def _load_inbox(session_id: Optional[str] = None) -> Dict[str, Any]:
    p = _get_inbox_path(session_id)
    if p.exists():
        try:
            return json.loads(p.read_text(encoding="utf-8"))
        except Exception:
            pass
    return {"items": [], "last_keyword": "", "last_research_goal": ""}


def _save_inbox(data: Dict[str, Any], session_id: Optional[str] = None) -> None:
    p = _get_inbox_path(session_id)
    p.parent.mkdir(parents=True, exist=True)
    p.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def fetch_arxiv_latest(keyword: str, max_results: int = 5) -> List[dict]:
    """
    按关键词拉取 arXiv 最新提交（与需求一致的 query 形态）。
    search_query=all:"keyword"&sortBy=submittedDate&sortOrder=desc
    """
    kw = (keyword or "").strip()
    if not kw:
        return []
    # arXiv API：短语搜索用引号包裹
    q = f'all:"{kw}"'
    params = {
        "search_query": q,
        "start": 0,
        "max_results": min(max(max_results, 1), 20),
        "sortBy": "submittedDate",
        "sortOrder": "descending",
    }
    try:
        with httpx.Client(timeout=20.0) as client:
            resp = client.get(ARXIV_API, params=params)
            resp.raise_for_status()
            papers = _parse_arxiv_response(resp.text)
            return papers[:max_results]
    except Exception as e:
        logger.warning("fetch_arxiv_latest failed: %s", e)
        return []


def _call_llm_filter(research_goal: str, papers: List[dict]) -> List[dict]:
    """返回与 papers 顺序对齐的决策列表；无 API 时全部保留并占位。"""
    api_key = os.getenv("DEEPSEEK_API_KEY")
    api_base = os.getenv("DEEPSEEK_API_BASE", "https://api.deepseek.com")
    if not api_key or not papers:
        return [
            {
                "arxiv_id": p.get("arxiv_id"),
                "keep": True,
                "method": "(未配置 LLM，未做自动提炼；请阅读摘要)",
                "boundary": "—",
            }
            for p in papers
        ]

    payload = [
        {
            "arxiv_id": p.get("arxiv_id"),
            "title": p.get("title", "")[:400],
            "abstract": (p.get("abstract") or "")[:2500],
        }
        for p in papers
    ]
    system = (
        "你是一个严苛的学术秘书。只输出 JSON，不要 Markdown 代码块，不要任何解释文字。"
    )
    user = f"""用户的当前研究课题是：{research_goal}

以下是最新 {len(payload)} 篇文献的标题与摘要（JSON）：
{json.dumps(payload, ensure_ascii=False)}

请阅读摘要，过滤掉与用户课题不相关的论文；对保留的论文用一句话概括其核心创新点（Method）和局限性（Boundary）。

严格输出一个 JSON 数组，长度与输入论文数量相同，按相同顺序，每项格式：
{{"arxiv_id": "与输入一致", "keep": true/false, "method": "一句话创新/方法", "boundary": "一句话局限"}}

若某篇不相关，设 keep 为 false，method/boundary 可为空字符串。"""

    from openai import OpenAI

    client = OpenAI(api_key=api_key, base_url=api_base)
    resp = client.chat.completions.create(
        model="deepseek-chat",
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        max_tokens=2000,
        temperature=0.2,
    )
    text = (resp.choices[0].message.content or "").strip()
    text = re.sub(r"^```(?:json)?\s*", "", text)
    text = re.sub(r"\s*```\s*$", "", text)
    try:
        arr = json.loads(text)
        if isinstance(arr, list) and len(arr) == len(papers):
            return arr
    except Exception as e:
        logger.warning("LLM JSON parse failed: %s", e)
    # 回退：全保留
    return [
        {
            "arxiv_id": p.get("arxiv_id"),
            "keep": True,
            "method": "(LLM 输出解析失败，请手动阅读)",
            "boundary": "—",
        }
        for p in papers
    ]


def run_fetch_and_filter(
    keyword: str,
    research_goal: str,
    session_id: Optional[str] = None,
    max_results: int = 5,
) -> Dict[str, Any]:
    """
    拉取 → LLM 过滤 → 写入收件箱（type: arxiv_recommendation）。
    返回 { "items": [新写入项...], "all_inbox_count": n }
    """
    papers = fetch_arxiv_latest(keyword, max_results=max_results)
    if not papers:
        return {"items": [], "message": "ArXiv 无结果或请求失败", "all_inbox_count": 0}

    decisions = _call_llm_filter(research_goal or keyword, papers)
    by_id = {d.get("arxiv_id"): d for d in decisions if isinstance(d, dict)}

    inbox = _load_inbox(session_id)
    items: List[dict] = inbox.get("items") or []
    new_items: List[dict] = []
    now = datetime.utcnow().isoformat() + "Z"

    for p in papers:
        aid = p.get("arxiv_id")
        d = by_id.get(aid) or {}
        keep = d.get("keep", True)
        if keep is False:
            continue
        rec = {
            "id": str(uuid.uuid4()),
            "type": "arxiv_recommendation",
            "keyword": keyword.strip(),
            "research_goal": (research_goal or "").strip(),
            "arxiv_id": aid,
            "title": p.get("title", ""),
            "summary": p.get("abstract", ""),
            "published": p.get("published", ""),
            "abs_url": f"https://arxiv.org/abs/{aid}" if aid else "",
            "pdf_url": p.get("pdf_url", ""),
            "method": (d.get("method") or "").strip() or "—",
            "boundary": (d.get("boundary") or "").strip() or "—",
            "created_at": now,
        }
        # 去重：同 arxiv_id 则更新
        items = [x for x in items if x.get("arxiv_id") != aid]
        items.insert(0, rec)
        new_items.append(rec)

    inbox["items"] = items
    inbox["last_keyword"] = keyword.strip()
    inbox["last_research_goal"] = (research_goal or "").strip()
    _save_inbox(inbox, session_id)

    return {
        "items": new_items,
        "all_inbox_count": len(items),
        "keyword": keyword.strip(),
    }


def list_inbox(session_id: Optional[str] = None) -> Dict[str, Any]:
    data = _load_inbox(session_id)
    return {
        "items": data.get("items") or [],
        "last_keyword": data.get("last_keyword", ""),
        "last_research_goal": data.get("last_research_goal", ""),
    }


def get_item_by_id(item_id: str, session_id: Optional[str] = None) -> Optional[dict]:
    for it in _load_inbox(session_id).get("items") or []:
        if it.get("id") == item_id:
            return it
    return None
