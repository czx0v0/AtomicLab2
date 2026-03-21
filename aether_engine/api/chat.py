"""
AgenticRAG 聊天 API（Router + Tools + GraphRAG）
Tools:
- search_local_knowledge: 本地混合检索（向量 + BM25 + Graph 1-hop）
- search_arxiv: 外网检索（arXiv）
- fetch_arxiv_recommendations: 学术秘书，拉取 arXiv 最新论文并由 LLM 过滤后写入收件箱
"""

import json
import logging
import os
import re
import threading
import time
from datetime import datetime
from pathlib import Path
from typing import Dict, Generator, List, Optional, Tuple

from fastapi import APIRouter, Header, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from api.search import IN_MODELSCOPE_SPACE, _search_pipeline

router = APIRouter(prefix="/chat", tags=["chat"])
logger = logging.getLogger("aether")


class ChatRequest(BaseModel):
    question: str
    history: Optional[List[dict]] = None
    top_k: int = 5
    max_rounds: int = 2
    # peer_review：审稿；writer：强制写作工具落编辑器（与 peer_review 互斥，由前端保证）。
    mode: Optional[str] = None


class AgentStep(BaseModel):
    agent: str
    content: str
    related_notes: Optional[List[dict]] = None
    score: Optional[float] = None


class ChatResponse(BaseModel):
    answer: str
    steps: List[AgentStep]
    sources: List[dict]
    action: Optional[dict] = None
    agent_traces: Optional[List[dict]] = None
    retrieved_cards: Optional[List[dict]] = None
    elapsed_ms: Optional[int] = None


class FeedbackRequest(BaseModel):
    message_id: str
    session_id: str
    rating: int  # 1 / -1
    user_comment: str = ""
    retrieved_contexts: Optional[List[dict]] = None
    answer_text: str = ""


_FEEDBACK_LOG = Path("data/feedback_log.json")
_FEEDBACK_LOCK = threading.Lock()

_SYNTHESIS_SYSTEM_BASE = (
    "你是高级学术 Copilot。"
    "根据用户意图回答：细节问题严格引用；通用/指令问题自然表达。"
    "用户消息中会给出 <document_chunks>、<atomic_notes>、<graph_relations> 等检索分区时，"
    "须综合利用各分区信息作答，并优先依据 PDF 原文分块与图谱关系；不要忽略图谱区。"
    "不要向用户暴露检索流程、卡片编号来源等底层实现。"
)

_PEER_REVIEW_ACTION_SUFFIX = (
    "\n\n【审稿模式】在 Markdown 正文之后，必须另起一行输出且仅输出下列机器可读块（不要 Markdown 代码围栏）：\n"
    '<action_plan>{"action":"replace","new_text":"..."}</action_plan>\n'
    "其中 action 只能为 replace（整篇替换草稿）、insert（在光标处插入）、append（追加到文末）三者之一；"
    "new_text 为建议写入左侧编辑器的完整 Markdown 字符串（JSON 中需正确转义引号与换行）。"
)


def _synthesis_system_prompt(peer_review: bool) -> str:
    if peer_review:
        return _SYNTHESIS_SYSTEM_BASE + _PEER_REVIEW_ACTION_SUFFIX
    return _SYNTHESIS_SYSTEM_BASE


def _peer_review_user_suffix() -> str:
    return "\n\n请在给出审稿意见后，在末尾严格按系统要求输出 <action_plan> JSON 块。"


def _sse_event(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


def _normalize_retrieved_cards(sources: List[dict], max_n: int = 16) -> List[dict]:
    """结构化检索卡片，供前端时间轴展示。"""
    out: List[dict] = []
    for s in (sources or [])[:max_n]:
        nid = str(s.get("note_id") or "").strip() or "unknown"
        stype = str(s.get("source") or "note")
        snippet = (s.get("summary") or s.get("concept") or "")[: 320]
        out.append(
            {
                "id": nid,
                "type": stype,
                "snippet": snippet,
                "score": s.get("score"),
                "doc_title": s.get("doc_title"),
                "page_num": s.get("page_num"),
            }
        )
    return out


def _seeker_channel_summary(sources: List[dict]) -> str:
    if not sources:
        return ""
    counts: Dict[str, int] = {}
    for s in sources:
        src = str(s.get("source") or "unknown")
        counts[src] = counts.get(src, 0) + 1
    parts = [f"{k}: {v} 条" for k, v in sorted(counts.items(), key=lambda x: -x[1])]
    return "检索通道分布：" + " · ".join(parts)


def _reviewer_heuristic(sources: List[dict]) -> dict:
    scores = [float(s.get("score") or 0) for s in sources if s.get("score") is not None]
    avg = sum(scores) / len(scores) if scores else 0.55
    grade = min(10.0, max(4.0, round(avg * 10, 1)))
    status = "success" if grade >= 6.5 else "warning"
    detail = (
        f"证据融合评分约 {grade:.1f}/10，通过。"
        if status == "success"
        else f"相关度约 {grade:.1f}/10，建议核对引用与原文。"
    )
    return {"status": status, "detail": detail, "score": grade}


def _build_agent_traces(
    detail_mode: bool,
    tool_logs: List[str],
    sources: List[dict],
    router_detail: str,
    has_evidence: bool,
    synthesizer_note: str = "已生成最终回答。",
) -> List[dict]:
    """
    Agent 可观测性：Router → Seeker（工具/通道）→ Reviewer → Synthesizer。
    """
    traces: List[dict] = []
    intent = "学术检索与证据合成" if detail_mode else "通用/开放问答"
    traces.append(
        {
            "step": "Router",
            "status": "success",
            "detail": f"意图：{intent}。{router_detail[:500]}",
        }
    )
    if tool_logs:
        for log in tool_logs[:10]:
            traces.append({"step": "Seeker", "status": "success", "detail": log})
    else:
        traces.append(
            {
                "step": "Seeker",
                "status": "warning" if not has_evidence else "success",
                "detail": "路由未产生显式 tool 日志；可能已走强制本地检索或直答。"
                if not has_evidence
                else "本地检索已合并（无独立 tool 日志行）。",
            }
        )
    ch = _seeker_channel_summary(sources)
    if ch:
        traces.append({"step": "Seeker", "status": "success", "detail": ch})
    if not has_evidence:
        traces.append(
            {
                "step": "Reviewer",
                "status": "warning",
                "detail": "无检索证据，将使用通用回答或诚实说明局限。",
                "score": 0.0,
            }
        )
    else:
        rt = _reviewer_heuristic(sources)
        traces.append(
            {
                "step": "Reviewer",
                "status": rt["status"],
                "detail": rt["detail"],
                "score": rt.get("score"),
            }
        )
    traces.append({"step": "Synthesizer", "status": "success", "detail": synthesizer_note})
    return traces


def _is_factual_question(q: str) -> bool:
    ql = (q or "").lower()
    patterns = [
        r"\bwhat\b",
        r"\bhow\b",
        r"\bwhy\b",
        r"\bwhen\b",
        r"\bwhich\b",
        r"\bcompare\b",
        r"\bexplain\b",
        r"\bdefinition\b",
        r"是什么",
        r"怎么",
        r"为何",
        r"对比",
        r"解释",
        r"依据",
    ]
    return any(re.search(p, ql) for p in patterns)


def _is_research_detail_question(q: str) -> bool:
    """
    判定是否属于“必须优先走本地文献/RAG并给引用”的细节型问题。
    """
    ql = (q or "").lower()
    patterns = [
        r"文献",
        r"论文",
        r"这篇",
        r"该文",
        r"章节",
        r"页码",
        r"图\d+",
        r"表\d+",
        r"实验",
        r"数据集",
        r"结果",
        r"指标",
        r"doi",
        r"citation",
        r"according to",
        r"in (the )?paper",
        r"dataset",
        r"ablation",
        r"appendix",
        # 检索 / RAG 技术词：应优先查本地笔记与实现说明
        r"\brrf\b",
        r"reciprocal rank",
        r"\bbm25\b",
        r"\bembedding\b",
        r"\bvector\b",
        r"hybrid (search|retrieval)",
        r"\brerank\b",
        r"graph\s*rag",
        r"\brag\b",
        r"知识库",
        r"本地检索",
        r"混合检索",
        r"向量检索",
        r"倒排",
    ]
    return any(re.search(p, ql) for p in patterns)


def _should_force_local_when_router_skips_tools(q: str) -> bool:
    """事实型 / 文献细节 / 技术检索类问题：路由未选工具时也强制走本地检索。"""
    return _is_research_detail_question(q) or _is_factual_question(q)


def _is_editor_action_intent(q: str) -> bool:
    """
    判定是否为“应触发写作工具”意图。
    """
    q = (q or "").strip()
    if not q:
        return False
    patterns = [
        r"帮我写",
        r"请你写",
        r"写一段",
        r"写个",
        r"续写",
        r"扩写",
        r"润色",
        r"改写",
        r"重写",
        r"整理成",
        r"添加到正文",
        r"插入正文",
        r"放到左侧",
        r"生成到编辑器",
        r"起草",
        r"撰写",
        r"生成一段",
        r"输出到",
        r"落稿",
        r"补一段",
        r"写一版",
        r"写",
        r"\b[Ww]rite\b",
        r"\b[Dd]raft\b",
        r"\bgenerate\b",
        r"\bcompose\b",
        r"produce\s+a\s+paragraph",
    ]
    return any(re.search(p, q) for p in patterns)


def _iter_editor_sse_chunks(text: str, chunk_size: int = 48) -> Generator[str, None, None]:
    t = text or ""
    for i in range(0, len(t), chunk_size):
        yield t[i : i + chunk_size]


def _plan_editor_action(question: str, force: bool = False) -> Optional[dict]:
    """
    使用 function-calling 生成编辑器动作。
    返回: {"function":"update_markdown_editor","action_type":"append|replace|insert","content":"..."}
    force=True（写作模式）：跳过关键词意图检测，直接调用写作工具。
    """
    if not force and not _is_editor_action_intent(question):
        return None

    api_key = os.getenv("DEEPSEEK_API_KEY")
    api_base = os.getenv("DEEPSEEK_API_BASE", "https://api.deepseek.com")
    if api_key:
        try:
            from openai import OpenAI

            client = OpenAI(api_key=api_key, base_url=api_base)
            tools = [
                {
                    "type": "function",
                    "function": {
                        "name": "update_markdown_editor",
                        "description": "将 Markdown 内容写入左侧编辑器",
                        "parameters": {
                            "type": "object",
                            "properties": {
                                "action_type": {
                                    "type": "string",
                                    "enum": ["append", "replace", "insert"],
                                },
                                "content": {
                                    "type": "string",
                                    "description": "要写入编辑器的 Markdown 文本",
                                },
                            },
                            "required": ["action_type", "content"],
                        },
                    },
                }
            ]
            sys_writing = (
                "你是写作 Agent。"
                "当用户表达“帮我写/润色/添加到正文”意图时，必须调用 update_markdown_editor，"
                "禁止输出常规解释文本。"
                "action_type 选择规则："
                "1) 润色/改写已有草稿 -> replace；"
                "2) 明确要求插入某处 -> insert；"
                "3) 其它写作生成默认 -> append。"
                "content 必须是可直接放入论文草稿的 Markdown。"
            )
            if force:
                sys_writing += " 用户已开启「写作模式」，必须调用 update_markdown_editor 将结果写入编辑器。"
            resp = client.chat.completions.create(
                model="deepseek-chat",
                messages=[
                    {"role": "system", "content": sys_writing},
                    {"role": "user", "content": question},
                ],
                tools=tools,
                tool_choice={"type": "function", "function": {"name": "update_markdown_editor"}},
                temperature=0.2,
                max_tokens=900,
            )
            msg = resp.choices[0].message
            if msg.tool_calls:
                tc = msg.tool_calls[0]
                args = json.loads(tc.function.arguments or "{}")
                action_type = (args.get("action_type") or "append").strip().lower()
                if action_type not in {"append", "replace", "insert"}:
                    action_type = "append"
                content = (args.get("content") or "").strip()
                if content:
                    return {
                        "function": "update_markdown_editor",
                        "action_type": action_type,
                        "content": content,
                    }
        except Exception as e:
            logger.warning("写作工具规划失败，降级到直接生成: %s", e)

    # 无 key / function-calling 失败时降级：直接生成 Markdown 并默认 append
    fallback = _call_deepseek(
        system_prompt=(
            "你是学术写作助手。请只输出可直接粘贴到论文草稿的 Markdown 正文，不要解释。"
        ),
        user_prompt=f"用户需求：{question}",
        max_tokens=900,
    )
    content = (fallback or "").strip()
    if not content:
        content = f"### 草稿片段\n\n{question}\n"
    action_type = "replace" if re.search(r"润色|改写|重写", question) else "append"
    return {
        "function": "update_markdown_editor",
        "action_type": action_type,
        "content": content,
    }


def _call_deepseek(system_prompt: str, user_prompt: str, max_tokens: int = 1200) -> str:
    api_key = os.getenv("DEEPSEEK_API_KEY")
    api_base = os.getenv("DEEPSEEK_API_BASE", "https://api.deepseek.com")
    if not api_key:
        return ""
    from openai import OpenAI

    client = OpenAI(api_key=api_key, base_url=api_base)
    resp = client.chat.completions.create(
        model="deepseek-chat",
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        max_tokens=max_tokens,
        temperature=0.2,
    )
    return (resp.choices[0].message.content or "").strip()


def _stream_deepseek(system_prompt: str, user_prompt: str, max_tokens: int = 1200) -> Generator[str, None, None]:
    api_key = os.getenv("DEEPSEEK_API_KEY")
    api_base = os.getenv("DEEPSEEK_API_BASE", "https://api.deepseek.com")
    if not api_key:
        return
    from openai import OpenAI

    client = OpenAI(api_key=api_key, base_url=api_base)
    stream = client.chat.completions.create(
        model="deepseek-chat",
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        max_tokens=max_tokens,
        temperature=0.2,
        stream=True,
    )
    for chunk in stream:
        delta = chunk.choices[0].delta
        if delta.content:
            yield delta.content


def _get_chat_llm_config() -> dict:
    """
    仅用于 /api/chat 主回答链路。
    默认 deepseek；当 CHAT_LLM_PROVIDER=aliyun 时切换到 DashScope OpenAI 兼容接口。
    """
    provider = (os.getenv("CHAT_LLM_PROVIDER", "deepseek") or "deepseek").strip().lower()
    if provider == "aliyun":
        return {
            "provider": "aliyun",
            "api_key": os.getenv("ALIYUN_API_KEY", ""),
            "base_url": os.getenv(
                "ALIYUN_API_BASE", "https://dashscope.aliyuncs.com/compatible-mode/v1"
            ),
            "model": os.getenv("ALIYUN_MODEL", "qwen3.5-flash"),
        }
    return {
        "provider": "deepseek",
        "api_key": os.getenv("DEEPSEEK_API_KEY", ""),
        "base_url": os.getenv("DEEPSEEK_API_BASE", "https://api.deepseek.com"),
        "model": os.getenv("DEEPSEEK_CHAT_MODEL", "deepseek-chat"),
    }


def _call_chat_llm(system_prompt: str, user_prompt: str, max_tokens: int = 1200) -> str:
    cfg = _get_chat_llm_config()
    api_key = cfg.get("api_key", "")
    if not api_key:
        return ""
    from openai import OpenAI

    client = OpenAI(api_key=api_key, base_url=cfg.get("base_url"))
    resp = client.chat.completions.create(
        model=cfg.get("model"),
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        max_tokens=max_tokens,
        temperature=0.2,
    )
    return (resp.choices[0].message.content or "").strip()


def _stream_chat_llm(system_prompt: str, user_prompt: str, max_tokens: int = 1200) -> Generator[str, None, None]:
    cfg = _get_chat_llm_config()
    api_key = cfg.get("api_key", "")
    if not api_key:
        return
    from openai import OpenAI

    client = OpenAI(api_key=api_key, base_url=cfg.get("base_url"))
    stream = client.chat.completions.create(
        model=cfg.get("model"),
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        max_tokens=max_tokens,
        temperature=0.2,
        stream=True,
    )
    for chunk in stream:
        delta = chunk.choices[0].delta
        if delta.content:
            yield delta.content


def _search_arxiv_external(query: str, limit: int = 3) -> List[dict]:
    import httpx

    out: List[dict] = []
    try:
        url = "https://export.arxiv.org/api/query"
        params = {
            "search_query": f"all:{query}",
            "start": 0,
            "max_results": limit,
            "sortBy": "relevance",
            "sortOrder": "descending",
        }
        resp = httpx.get(url, params=params, timeout=10.0)
        resp.raise_for_status()
        entries = re.findall(r"<entry>(.*?)</entry>", resp.text, re.DOTALL)
        for e in entries[:limit]:
            title_m = re.search(r"<title>(.*?)</title>", e, re.DOTALL)
            abs_m = re.search(r"<summary>(.*?)</summary>", e, re.DOTALL)
            id_m = re.search(r"<id>(.*?)</id>", e, re.DOTALL)
            title = re.sub(r"\s+", " ", (title_m.group(1) if title_m else "")).strip()
            abstract = re.sub(r"\s+", " ", (abs_m.group(1) if abs_m else "")).strip()
            raw_id = id_m.group(1) if id_m else ""
            aid = raw_id.split("/abs/")[-1] if "/abs/" in raw_id else raw_id
            out.append(
                {
                    "note_id": f"arxiv::{aid}",
                    "summary": abstract,
                    "concept": f"arXiv:{title[:40]}",
                    "keywords": [],
                    "doc_title": title,
                    "page_num": 0,
                    "bbox": [],
                    "score": 0.52,
                    "source": "arxiv",
                    "url": f"https://arxiv.org/abs/{aid}" if aid else "",
                }
            )
    except Exception as e:
        logger.warning("ArXiv 外网检索失败: %s", e)
    return out


def _tool_search_local(query: str, top_k: int, session_id: Optional[str]) -> dict:
    return _search_pipeline(
        query=query,
        top_k=max(3, top_k),
        max_rounds=2,
        session_id=session_id,
    )


def _global_search_for_chat(
    query: str,
    top_k: int,
    session_id: Optional[str],
    max_rounds: int = 2,
) -> dict:
    """与 POST /search/global 一致：全库混合检索，供 Chat 基线合并。"""
    eff_k = max(8, top_k, 12)
    return _search_pipeline(
        query=query,
        top_k=eff_k,
        doc_id=None,
        max_rounds=max_rounds,
        session_id=session_id,
    )


def _route_with_tools(
    question: str,
    top_k: int,
    session_id: Optional[str],
    max_rounds: int = 2,
) -> Tuple[List[dict], List[str], str]:
    """
    返回：(sources, tool_logs, local_context)。
    约束：事实型问题必须调用 tools；若本地为空，需要决定 arXiv 或诚实告知。
    """
    api_key = os.getenv("DEEPSEEK_API_KEY")
    api_base = os.getenv("DEEPSEEK_API_BASE", "https://api.deepseek.com")

    sources: List[dict] = []
    tool_logs: List[str] = []
    local_context = ""

    detail_mode = _is_research_detail_question(question)

    # 无 API key 时，降级路由：细节问题优先本地；通用问题不强制外部检索
    if not api_key:
        local = _global_search_for_chat(question, top_k, session_id, max_rounds)
        local_hits = local.get("results", [])
        local_context = local.get("context", "")
        if local_hits:
            tool_logs.append(f"search_local_knowledge('{question[:40]}...') -> {len(local_hits)}")
            sources.extend(local_hits[: max(top_k, 6)])
        elif detail_mode:
            arxiv_hits = _search_arxiv_external(question, limit=3)
            tool_logs.append(f"search_arxiv('{question[:40]}...') -> {len(arxiv_hits)}")
            sources.extend(arxiv_hits)
        return sources, tool_logs, local_context

    from openai import OpenAI

    client = OpenAI(api_key=api_key, base_url=api_base)
    tools = [
        {
            "type": "function",
            "function": {
                "name": "search_local_knowledge",
                "description": "检索本地知识库（向量+BM25+Graph 1-hop/2-hop）",
                "parameters": {
                    "type": "object",
                    "properties": {"keywords": {"type": "string"}},
                    "required": ["keywords"],
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "search_arxiv",
                "description": "检索外网 arXiv 论文摘要",
                "parameters": {
                    "type": "object",
                    "properties": {"keywords": {"type": "string"}},
                    "required": ["keywords"],
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "fetch_arxiv_recommendations",
                "description": "学术秘书：按关键词从 arXiv 拉取最新论文，经 LLM 过滤后写入收件箱",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "keyword": {"type": "string"},
                        "research_goal": {"type": "string"},
                    },
                    "required": ["keyword"],
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "export_latex",
                "description": "将 Markdown 草稿转为 IEEEtran LaTeX 项目（main.tex + references.bib），返回一次性下载链接",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "markdown": {
                            "type": "string",
                            "description": "完整 Markdown 草稿；若为空则无法生成",
                        }
                    },
                    "required": ["markdown"],
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "debug_latex_error",
                "description": "根据 pdflatex/Overleaf 报错日志与相关 LaTeX 片段，分析原因并给出修改建议",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "error_log": {"type": "string"},
                        "latex_snippet": {"type": "string"},
                    },
                    "required": ["error_log"],
                },
            },
        },
    ]
    messages = [
        {
            "role": "system",
            "content": (
                "你是一个高级学术 Copilot 的路由智能体。"
                "当用户询问具体文献、数据、研究细节时，优先调用 search_local_knowledge，并在必要时补充 search_arxiv。"
                "当用户希望追踪某方向最新 arXiv 论文、需要秘书预读过滤并入库推荐时，调用 fetch_arxiv_recommendations。"
                "当用户要求导出 LaTeX、打包 IEEE 论文、生成 .bib 时，调用 export_latex（需用户提供或粘贴 Markdown 全文）。"
                "当用户粘贴 LaTeX 编译报错日志时，调用 debug_latex_error。"
                "当用户询问通用概念、闲聊、或要求执行写作/润色类指令时，可以选择不调用工具。"
                "只做路由决策，不输出最终答案。"
            ),
        },
        {"role": "user", "content": question},
    ]

    # 允许最多两轮 tool call
    for _ in range(2):
        resp = client.chat.completions.create(
            model="deepseek-chat",
            messages=messages,
            tools=tools,
            tool_choice="auto",
            temperature=0,
            max_tokens=300,
        )
        msg = resp.choices[0].message
        tool_calls = msg.tool_calls or []

        # 细节问题且未调用 tool，则强制本地检索
        if not tool_calls and detail_mode:
            local = _global_search_for_chat(question, top_k, session_id, max_rounds)
            local_hits = local.get("results", [])
            local_context = local.get("context", "")
            sources.extend(local_hits[: max(top_k, 6)])
            tool_logs.append(f"search_local_knowledge('{question[:40]}...') -> {len(local_hits)} [forced]")
            break

        if not tool_calls:
            break

        messages.append(
            {
                "role": "assistant",
                "content": msg.content or "",
                "tool_calls": [tc.model_dump() for tc in tool_calls],
            }
        )
        for tc in tool_calls:
            name = tc.function.name
            try:
                args = json.loads(tc.function.arguments or "{}")
            except Exception:
                args = {}
            keywords = (args.get("keywords") or question).strip()

            if name == "search_local_knowledge":
                local = _global_search_for_chat(keywords, top_k, session_id, max_rounds)
                local_hits = local.get("results", [])
                local_context = local.get("context", local_context)
                sources.extend(local_hits[: max(top_k, 6)])
                tool_logs.append(f"search_local_knowledge('{keywords[:40]}...') -> {len(local_hits)}")
                tool_result = {
                    "total": len(local_hits),
                    "context": local_context[:1200],
                    "hits": [
                        {
                            "id": h.get("note_id"),
                            "source": h.get("source"),
                            "score": h.get("score"),
                            "concept": h.get("concept"),
                        }
                        for h in local_hits[:6]
                    ],
                }
            elif name == "search_arxiv":
                arxiv_hits = _search_arxiv_external(keywords, limit=3)
                sources.extend(arxiv_hits)
                tool_logs.append(f"search_arxiv('{keywords[:40]}...') -> {len(arxiv_hits)}")
                tool_result = {"total": len(arxiv_hits), "hits": arxiv_hits[:3]}
            elif name == "fetch_arxiv_recommendations":
                from service.arxiv_secretary import run_fetch_and_filter

                kw = (args.get("keyword") or keywords or question).strip()
                goal = (args.get("research_goal") or "").strip()
                out = run_fetch_and_filter(kw, goal, session_id=session_id, max_results=5)
                n_new = len(out.get("items") or [])
                tool_logs.append(f"fetch_arxiv_recommendations('{kw[:40]}...') -> {n_new} 条入收件箱")
                tool_result = out
            elif name == "export_latex":
                from api.export_latex import store_export_zip
                from service.latex_exporter import build_latex_zip_bytes

                md = (args.get("markdown") or "").strip()
                if not md:
                    tool_result = {
                        "ok": False,
                        "error": "请提供 markdown 参数。可请用户粘贴草稿，或到 Write 页面使用「导出为 LaTeX 项目」按钮。",
                    }
                else:
                    zip_bytes, meta = build_latex_zip_bytes(md, session_id)
                    token = store_export_zip(zip_bytes)
                    tool_result = {
                        "ok": True,
                        "download_url": f"/api/export/latex_zip/download/{token}",
                        "meta": meta,
                        "hint": "将 download_url 发给用户，在前端同域打开即可下载 ZIP。",
                    }
                tool_logs.append("export_latex -> ZIP 已生成" if tool_result.get("ok") else "export_latex -> 缺少 markdown")
            elif name == "debug_latex_error":
                from service.latex_exporter import debug_latex_error as _dbg

                analysis = _dbg(
                    args.get("error_log") or "",
                    args.get("latex_snippet") or "",
                )
                tool_result = {"analysis": analysis}
                tool_logs.append("debug_latex_error -> 已分析日志")
            else:
                tool_result = {"total": 0}

            messages.append(
                {
                    "role": "tool",
                    "tool_call_id": tc.id,
                    "name": name,
                    "content": json.dumps(tool_result, ensure_ascii=False),
                }
            )

    # 细节问题的兜底：本地为空时可补 arXiv
    has_local = any(s.get("source") != "arxiv" for s in sources)
    if not has_local and detail_mode:
        arxiv_hits = _search_arxiv_external(question, limit=3)
        if arxiv_hits:
            sources.extend(arxiv_hits)
            tool_logs.append(f"search_arxiv('{question[:40]}...') -> {len(arxiv_hits)} [fallback]")

    # 与 /search/global 对齐：始终再合并一次全库混合检索，避免 Router 漏调工具时缺少 PDF 分块/笔记/图谱
    if api_key:
        try:
            bl = _global_search_for_chat(question, top_k, session_id, max_rounds)
            bl_hits = bl.get("results") or []
            for it in bl_hits:
                sources.append(it)
            bl_ctx = (bl.get("context") or "").strip()
            if bl_ctx:
                local_context = bl_ctx
            tool_logs.append(f"baseline_global_merge -> {len(bl_hits)} [pipeline]")
        except Exception as e:
            logger.warning("baseline global merge failed: %s", e)

    # 去重（无 note_id 的条目用稳定占位键保留）
    dedup = {}
    for i, s in enumerate(sources):
        sid = s.get("note_id")
        if not sid:
            sid = f"__anon_{i}_{s.get('source', 'x')}"
        if sid not in dedup or s.get("score", 0) > dedup[sid].get("score", 0):
            dedup[sid] = s
    merged = sorted(dedup.values(), key=lambda x: x.get("score", 0), reverse=True)
    out_cap = min(16, max(10, top_k))
    return merged[:out_cap], tool_logs, local_context


def _bucket_for_evidence(source: Optional[str]) -> str:
    """将 search 通道映射到 XML 分区名。"""
    src = (source or "unknown").strip()
    if src in ("doc_vector", "doc_bm25"):
        return "document_chunks"
    if src in ("note_vector", "note_bm25", "screenshot_ocr"):
        return "atomic_notes"
    if src in ("graph_1hop", "graph_2hop"):
        return "graph_relations"
    if src == "arxiv":
        return "external_papers"
    return "other"


def _build_synthesis_prompt(
    question: str, sources: List[dict], local_context: str, detail_mode: bool
) -> str:
    if not sources:
        tail = (
            "（注：本地文献库暂无该特定细节，此为通用学术解释）"
            if detail_mode
            else ""
        )
        return f"用户问题：{question}\n\n请直接给出清晰、自然的人类表达答案。{tail}"

    order = (
        "document_chunks",
        "atomic_notes",
        "graph_relations",
        "external_papers",
        "other",
    )
    buckets: Dict[str, List[dict]] = {k: [] for k in order}
    for s in sources[:16]:
        b = _bucket_for_evidence(s.get("source"))
        if b in buckets:
            buckets[b].append(s)
        else:
            buckets["other"].append(s)

    if detail_mode:
        requirements = (
            "回答要求：研究/技术细节问题，严格基于证据作答；凡引用或复述某条证据，必须在对应句末使用半角角标 [1] [2]（与下方分区内全局编号一致）；"
            "图谱分区内可用 [G1] 等与 graph_ref 对齐。\n\n"
        )
    else:
        requirements = (
            "回答要求：已提供检索证据时请优先采用证据内容；凡直接来自某条证据的句子，在句末标注半角 [1][2]（编号与下方分区内列表一致）。"
            "可补充通用知识，无证据支撑处请说明。不要使用全角［］括号作引用编号。\n\n"
        )

    xml_parts: List[str] = []
    n = 1
    tag_names = {
        "document_chunks": "document_chunks",
        "atomic_notes": "atomic_notes",
        "graph_relations": "graph_relations",
        "external_papers": "external_papers",
        "other": "other_evidence",
    }
    for key in order:
        items = buckets[key]
        if not items:
            continue
        lines: List[str] = []
        for s in items:
            src = s.get("source", "unknown")
            concept = s.get("concept", "")
            summary = s.get("summary", "")
            graph_mark = s.get("graph_ref", "")
            doc_t = s.get("doc_title") or ""
            lines.append(
                f"[{n}] src={src} doc={doc_t} concept={concept} {graph_mark}\n{summary}"
            )
            n += 1
        tag = tag_names[key]
        xml_parts.append(f"<{tag}>\n" + "\n\n".join(lines) + f"\n</{tag}>")

    body = "\n\n".join(xml_parts)
    # local_context 与分区内容同源时不再重复拼接长文本
    extra = ""
    if local_context and len(local_context) > 400 and not xml_parts:
        extra = "\n\n<fusion_context>\n" + local_context[:2000] + "\n</fusion_context>"

    return f"用户问题：{question}\n\n{requirements}检索证据（分区 XML）：\n\n{body}{extra}"


def _general_fallback_answer(question: str) -> str:
    api_key = os.getenv("DEEPSEEK_API_KEY")
    if api_key:
        out = _call_deepseek(
            system_prompt=(
                "你是高级学术 Copilot。"
                "用自然、友好的方式回答，不要提及检索流程或系统限制。"
                "若问题涉及具体文献细节但无证据，可在结尾加注释。"
            ),
            user_prompt=(
                f"用户问题：{question}\n"
                "请给出可执行、清晰、不过度模板化的回答。"
            ),
            max_tokens=900,
        )
        if out:
            return out
    return f"{question} 这个问题可以从通用学术视角来理解：先定义核心概念，再给出常见用法与注意事项。（注：本地文献库暂无该特定细节，此为通用学术解释）"


def _append_feedback_record(record: dict) -> None:
    _FEEDBACK_LOG.parent.mkdir(parents=True, exist_ok=True)
    with _FEEDBACK_LOCK:
        existing = []
        if _FEEDBACK_LOG.exists():
            try:
                existing = json.loads(_FEEDBACK_LOG.read_text(encoding="utf-8"))
                if not isinstance(existing, list):
                    existing = []
            except Exception:
                existing = []
        existing.append(record)
        _FEEDBACK_LOG.write_text(
            json.dumps(existing, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )


@router.post("", response_model=ChatResponse)
def chat(body: ChatRequest, x_session_id: str = Header(default="")):
    if not body.question.strip():
        raise HTTPException(status_code=400, detail="问题不能为空")

    t0 = time.perf_counter()
    session_id = x_session_id if IN_MODELSCOPE_SPACE else None
    steps: List[dict] = []
    mode_raw = (body.mode or "").strip().lower()
    peer_review = mode_raw == "peer_review"
    writer_mode = mode_raw == "writer"

    if peer_review:
        editor_action = None
    elif writer_mode:
        editor_action = _plan_editor_action(body.question, force=True)
    else:
        editor_action = _plan_editor_action(body.question, force=False)
    if editor_action:
        answer = "✅ 已为您将内容生成至左侧编辑器。"
        steps.append({"agent": "writer", "content": "写作工具已触发。"})
        traces = [
            {"step": "Router", "status": "success", "detail": "识别为写作/编辑意图，调用写作工具。"},
            {"step": "Synthesizer", "status": "success", "detail": "内容已下发至编辑器。"},
        ]
        return {
            "answer": answer,
            "steps": [AgentStep(**s) for s in steps],
            "sources": [],
            "action": editor_action,
            "agent_traces": traces,
            "retrieved_cards": [],
            "elapsed_ms": int((time.perf_counter() - t0) * 1000),
        }

    sources, tool_logs, local_context = _route_with_tools(
        body.question,
        top_k=body.top_k,
        session_id=session_id,
        max_rounds=body.max_rounds,
    )
    detail_mode = _is_research_detail_question(body.question)
    router_txt = "已完成上下文准备。"
    if tool_logs:
        router_txt += "\n\n" + "\n".join(f"• {t}" for t in tool_logs)
    steps.append(
        {
            "agent": "router",
            "content": router_txt,
            "related_notes": sources[:5],
        }
    )
    if sources:
        n_local = sum(1 for s in sources if (s.get("source") or "") != "arxiv")
        n_arxiv = sum(1 for s in sources if s.get("source") == "arxiv")
        rev = f"证据速览：共 {len(sources)} 条（本地文献 {n_local} 条"
        if n_arxiv:
            rev += f"，arXiv {n_arxiv} 条"
        rev += "）。将据此生成回答。"
        steps.append({"agent": "reviewer", "content": rev, "related_notes": sources[:3]})

    # 无证据时：仍给自然答案，不向用户暴露底层检索流程
    if not sources:
        api_key_ns = _get_chat_llm_config().get("api_key", "")
        if peer_review and api_key_ns:
            answer = _call_chat_llm(
                system_prompt=_synthesis_system_prompt(True),
                user_prompt=body.question + _peer_review_user_suffix(),
                max_tokens=1400,
            )
        else:
            answer = _general_fallback_answer(body.question)
            if detail_mode and "本地文献库暂无该特定细节" not in answer:
                answer = answer.rstrip() + "\n\n（注：本地文献库暂无该特定细节，此为通用学术解释）"
        steps.append({"agent": "synthesizer", "content": answer})
        router_txt_full = router_txt
        agent_traces = _build_agent_traces(
            detail_mode,
            tool_logs,
            [],
            router_txt_full,
            has_evidence=False,
            synthesizer_note="无检索证据，已生成通用/诚实回答。",
        )
        return {
            "answer": answer,
            "steps": [AgentStep(**s) for s in steps],
            "sources": [],
            "agent_traces": agent_traces,
            "retrieved_cards": [],
            "elapsed_ms": int((time.perf_counter() - t0) * 1000),
        }

    api_key = _get_chat_llm_config().get("api_key", "")
    if api_key:
        user_prompt = _build_synthesis_prompt(
            body.question, sources, local_context, detail_mode=detail_mode
        )
        if peer_review:
            user_prompt = user_prompt + _peer_review_user_suffix()
        answer = _call_chat_llm(
            system_prompt=_synthesis_system_prompt(peer_review),
            user_prompt=user_prompt,
            max_tokens=1400,
        )
    else:
        answer = "未配置聊天模型 API KEY（DEEPSEEK_API_KEY 或 ALIYUN_API_KEY）。以下为检索结果摘要：\n\n" + "\n".join(
            f"- [{i+1}] {s.get('concept','')} {s.get('summary','')[:120]}" for i, s in enumerate(sources[:6])
        )

    steps.append({"agent": "synthesizer", "content": answer})
    agent_traces = _build_agent_traces(
        detail_mode,
        tool_logs,
        sources,
        router_txt,
        has_evidence=True,
        synthesizer_note="已生成带引用的最终回答。",
    )
    return {
        "answer": answer,
        "steps": [AgentStep(**s) for s in steps],
        "sources": sources[:8],
        "agent_traces": agent_traces,
        "retrieved_cards": _normalize_retrieved_cards(sources),
        "elapsed_ms": int((time.perf_counter() - t0) * 1000),
    }


def _chat_stream_generator(
    question: str,
    top_k: int,
    session_id: Optional[str],
    mode: Optional[str] = None,
    max_rounds: int = 2,
) -> Generator[str, None, None]:
    t0 = time.perf_counter()
    mode_raw = (mode or "").strip().lower()
    peer_review = mode_raw == "peer_review"
    writer_mode = mode_raw == "writer"
    if peer_review:
        editor_action = None
    elif writer_mode:
        editor_action = _plan_editor_action(question, force=True)
    else:
        editor_action = _plan_editor_action(question, force=False)
    if editor_action:
        content_preview = (editor_action.get("content") or "").strip()
        if writer_mode and content_preview:
            yield _sse_event(
                "step",
                {"agent": "writer", "content": "写作内容流式下发…", "streaming": True},
            )
            for chunk in _iter_editor_sse_chunks(content_preview):
                yield _sse_event("editor_delta", {"token": chunk})
        yield _sse_event("action", editor_action)
        traces = [
            {"step": "Router", "status": "success", "detail": "识别为写作/编辑意图，调用写作工具。"},
            {"step": "Synthesizer", "status": "success", "detail": "内容已下发至编辑器。"},
        ]
        yield _sse_event(
            "done",
            {
                "sources": [],
                "action": editor_action,
                "agent_traces": traces,
                "retrieved_cards": [],
                "elapsed_ms": int((time.perf_counter() - t0) * 1000),
            },
        )
        return

    yield _sse_event("step", {"agent": "router", "content": "正在理解你的意图并准备上下文..."})
    sources, tool_logs, local_context = _route_with_tools(
        question, top_k=top_k, session_id=session_id, max_rounds=max_rounds
    )
    detail_mode = _is_research_detail_question(question)
    router_detail = "上下文已准备完成。"
    if tool_logs:
        router_detail += "\n\n" + "\n".join(f"• {t}" for t in tool_logs)
    yield _sse_event(
        "step",
        {
            "agent": "router",
            "content": router_detail,
            "related_notes": sources[:5],
        },
    )

    if not sources:
        api_key_ns = _get_chat_llm_config().get("api_key", "")
        if peer_review and api_key_ns:
            yield _sse_event("step", {"agent": "synthesizer", "content": "", "streaming": True})
            up_ns = question + _peer_review_user_suffix()
            for tk in _stream_chat_llm(
                system_prompt=_synthesis_system_prompt(True),
                user_prompt=up_ns,
                max_tokens=1400,
            ):
                yield _sse_event("delta", {"token": tk})
            traces = _build_agent_traces(
                detail_mode,
                tool_logs,
                [],
                router_detail,
                has_evidence=False,
                synthesizer_note="无检索证据，审稿模式流式生成完成。",
            )
            yield _sse_event(
                "done",
                {
                    "sources": [],
                    "agent_traces": traces,
                    "retrieved_cards": [],
                    "elapsed_ms": int((time.perf_counter() - t0) * 1000),
                },
            )
            return
        msg = _general_fallback_answer(question)
        if detail_mode and "本地文献库暂无该特定细节" not in msg:
            msg = msg.rstrip() + "\n\n（注：本地文献库暂无该特定细节，此为通用学术解释）"
        yield _sse_event("step", {"agent": "synthesizer", "content": msg})
        traces = _build_agent_traces(
            detail_mode,
            tool_logs,
            [],
            router_detail,
            has_evidence=False,
            synthesizer_note="无检索证据，已生成通用回答。",
        )
        yield _sse_event(
            "done",
            {
                "sources": [],
                "agent_traces": traces,
                "retrieved_cards": [],
                "elapsed_ms": int((time.perf_counter() - t0) * 1000),
            },
        )
        return

    api_key = _get_chat_llm_config().get("api_key", "")
    if not api_key:
        fallback = "未配置聊天模型 API KEY（DEEPSEEK_API_KEY 或 ALIYUN_API_KEY）。以下为检索结果摘要：\n\n" + "\n".join(
            f"- [{i+1}] {s.get('concept','')} {s.get('summary','')[:120]}" for i, s in enumerate(sources[:6])
        )
        yield _sse_event("step", {"agent": "synthesizer", "content": fallback})
        traces = _build_agent_traces(
            detail_mode,
            tool_logs,
            sources,
            router_detail,
            has_evidence=True,
            synthesizer_note="未配置 LLM，仅返回检索摘要。",
        )
        yield _sse_event(
            "done",
            {
                "sources": sources[:8],
                "agent_traces": traces,
                "retrieved_cards": _normalize_retrieved_cards(sources),
                "elapsed_ms": int((time.perf_counter() - t0) * 1000),
            },
        )
        return

    n_loc = sum(1 for s in sources if (s.get("source") or "") != "arxiv")
    n_ax = sum(1 for s in sources if s.get("source") == "arxiv")
    rev_msg = f"证据速览：共 {len(sources)} 条（本地文献 {n_loc} 条"
    if n_ax:
        rev_msg += f"，arXiv {n_ax} 条"
    rev_msg += "）。开始生成回答…"
    yield _sse_event(
        "step",
        {"agent": "reviewer", "content": rev_msg, "related_notes": sources[:3]},
    )

    yield _sse_event("step", {"agent": "synthesizer", "content": "", "streaming": True})
    up = _build_synthesis_prompt(
        question, sources, local_context, detail_mode=detail_mode
    )
    if peer_review:
        up = up + _peer_review_user_suffix()
    for tk in _stream_chat_llm(
        system_prompt=_synthesis_system_prompt(peer_review),
        user_prompt=up,
        max_tokens=1400,
    ):
        yield _sse_event("delta", {"token": tk})
    traces = _build_agent_traces(
        detail_mode,
        tool_logs,
        sources,
        router_detail,
        has_evidence=True,
        synthesizer_note="流式生成最终回答完成。",
    )
    yield _sse_event(
        "done",
        {
            "sources": sources[:8],
            "agent_traces": traces,
            "retrieved_cards": _normalize_retrieved_cards(sources),
            "elapsed_ms": int((time.perf_counter() - t0) * 1000),
        },
    )


@router.post("/stream")
def chat_stream(body: ChatRequest, x_session_id: str = Header(default="")):
    if not body.question.strip():
        raise HTTPException(status_code=400, detail="问题不能为空")
    session_id = x_session_id if IN_MODELSCOPE_SPACE else None
    return StreamingResponse(
        _chat_stream_generator(
            body.question,
            top_k=body.top_k,
            session_id=session_id,
            mode=body.mode,
            max_rounds=body.max_rounds,
        ),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.post("/feedback")
def chat_feedback(body: FeedbackRequest, x_session_id: str = Header(default="")):
    if body.rating not in (1, -1):
        raise HTTPException(status_code=400, detail="rating 只能是 1 或 -1")

    header_sid = x_session_id if IN_MODELSCOPE_SPACE else ""
    final_sid = (body.session_id or header_sid or "").strip()

    record = {
        "timestamp": datetime.utcnow().isoformat() + "Z",
        "message_id": body.message_id,
        "session_id": final_sid,
        "rating": body.rating,
        "user_comment": (body.user_comment or "").strip(),
        "answer_text": body.answer_text or "",
        "retrieved_contexts": body.retrieved_contexts or [],
    }

    threading.Thread(target=_append_feedback_record, args=(record,), daemon=True).start()
    logger.info(
        "[Feedback] message_id=%s rating=%s session=%s",
        body.message_id,
        body.rating,
        (final_sid or "")[:16],
    )
    return {"ok": True}
