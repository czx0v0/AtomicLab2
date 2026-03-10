"""
ArXiv 文献检索与下载 API
通过 ArXiv 公开 API 检索学术论文并支持 PDF 下载。
"""
import asyncio
import logging
import re
import urllib.parse
from typing import List, Optional

import httpx
from fastapi import APIRouter, HTTPException, BackgroundTasks
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

router = APIRouter(prefix="/arxiv", tags=["arxiv"])
logger = logging.getLogger("aether")

ARXIV_API = "https://export.arxiv.org/api/query"
ARXIV_PDF = "https://arxiv.org/pdf"


class ArxivSearchRequest(BaseModel):
    query: str
    max_results: int = 10
    sort_by: str = "relevance"  # relevance | lastUpdatedDate | submittedDate


class ArxivPaper(BaseModel):
    arxiv_id: str
    title: str
    authors: List[str]
    abstract: str
    published: str
    pdf_url: str
    categories: List[str]


def _parse_arxiv_response(xml_text: str) -> List[dict]:
    """简单解析 ArXiv Atom XML 响应。"""
    papers = []

    # 提取所有 entry 块
    entries = re.findall(r"<entry>(.*?)</entry>", xml_text, re.DOTALL)
    for entry in entries:
        def get_tag(tag, text):
            m = re.search(rf"<{tag}[^>]*>(.*?)</{tag}>", text, re.DOTALL)
            return m.group(1).strip() if m else ""

        # arxiv ID
        raw_id = get_tag("id", entry)
        arxiv_id = raw_id.split("/abs/")[-1] if "/abs/" in raw_id else raw_id

        # 标题（去掉换行）
        title = re.sub(r"\s+", " ", get_tag("title", entry))

        # 摘要
        abstract = re.sub(r"\s+", " ", get_tag("summary", entry))

        # 作者
        authors = re.findall(r"<name>(.*?)</name>", entry)

        # 发布日期
        published = get_tag("published", entry)[:10]

        # PDF 链接
        pdf_links = re.findall(r'href="(https://arxiv\.org/pdf/[^"]+)"', entry)
        pdf_url = pdf_links[0] if pdf_links else f"https://arxiv.org/pdf/{arxiv_id}.pdf"

        # 类别
        categories = re.findall(r'<category term="([^"]+)"', entry)

        if arxiv_id and title:
            papers.append(
                {
                    "arxiv_id": arxiv_id,
                    "title": title,
                    "authors": authors,
                    "abstract": abstract,
                    "published": published,
                    "pdf_url": pdf_url,
                    "categories": categories,
                }
            )
    return papers


@router.post("/search")
async def search_arxiv(body: ArxivSearchRequest):
    """检索 ArXiv 论文。"""
    if not body.query.strip():
        raise HTTPException(status_code=400, detail="检索词不能为空")

    logger.info("ArXiv 检索: query='%s', max=%d", body.query, body.max_results)

    params = {
        "search_query": f"all:{urllib.parse.quote(body.query)}",
        "start": 0,
        "max_results": min(body.max_results, 20),
        "sortBy": body.sort_by,
        "sortOrder": "descending",
    }

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(ARXIV_API, params=params)
            resp.raise_for_status()
            papers = _parse_arxiv_response(resp.text)
            logger.info("ArXiv 返回 %d 篇论文", len(papers))
            return {"papers": papers, "total": len(papers), "query": body.query}
    except httpx.TimeoutException:
        raise HTTPException(status_code=504, detail="ArXiv 请求超时，请稍后重试")
    except Exception as e:
        logger.error("ArXiv 检索失败: %s", e)
        raise HTTPException(status_code=500, detail=f"检索失败: {str(e)}")


@router.get("/download/{arxiv_id:path}")
async def download_arxiv_pdf(arxiv_id: str):
    """
    代理下载 ArXiv PDF（解决 CORS 问题）。
    arxiv_id 示例: 1706.03762 或 cs/0612101
    """
    # 清理 ID，防止路径注入
    arxiv_id = re.sub(r"[^\w./\-]", "", arxiv_id)
    pdf_url = f"{ARXIV_PDF}/{arxiv_id}.pdf"
    logger.info("代理下载 ArXiv PDF: %s", pdf_url)

    try:
        async def stream_pdf():
            async with httpx.AsyncClient(timeout=60.0, follow_redirects=True) as client:
                async with client.stream("GET", pdf_url) as resp:
                    resp.raise_for_status()
                    async for chunk in resp.aiter_bytes(chunk_size=8192):
                        yield chunk

        return StreamingResponse(
            stream_pdf(),
            media_type="application/pdf",
            headers={"Content-Disposition": f'attachment; filename="{arxiv_id}.pdf"'},
        )
    except Exception as e:
        logger.error("PDF 下载失败: %s", e)
        raise HTTPException(status_code=500, detail=f"下载失败: {str(e)}")
