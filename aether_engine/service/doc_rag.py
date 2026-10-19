"""
文档分块 RAG 引擎（会话隔离版）
将解析后的 Markdown 按章节/段落切分后写入 ChromaDB，
用于与原子笔记并行检索。
"""

import os
import json
import logging
import re
from typing import Dict, List, Any, Optional

import chromadb
from chromadb.config import Settings as ChromaSettings

logger = logging.getLogger("aether")

# 检测是否在创空间环境
from core.paths import is_modelscope_space
IN_MODELSCOPE_SPACE = is_modelscope_space()

if IN_MODELSCOPE_SPACE:
    from core.session_store import get_session_path, init_session

_instance = None
_instances: Dict[str, "DocumentRAG"] = {}


def _split_markdown(md: str, max_chunk_chars: int = 800, overlap_chars: int = 0) -> List[Dict[str, str]]:
    """按标题/段落切块；单段超长时按 max_chunk_chars 硬切（带 overlap），解决超长文本不处理的问题。"""
    sections: List[Dict[str, str]] = []
    title = "Preamble"
    buf: List[str] = []
    overlap_chars = max(0, min(int(overlap_chars), max_chunk_chars // 2))

    def _append(text: str) -> None:
        text = text.strip()
        if text:
            sections.append({"title": title, "content": text})

    def _hard_split(long_text: str) -> None:
        step = max(1, max_chunk_chars - overlap_chars)
        for i in range(0, len(long_text), step):
            seg = long_text[i : i + max_chunk_chars].strip()
            if seg:
                sections.append({"title": title, "content": seg})

    def flush() -> None:
        if not buf:
            return
        text = "\n".join(buf).strip()
        if not text:
            return
        paragraphs = [p.strip() for p in text.split("\n\n") if p.strip()]
        current = ""
        for p in paragraphs:
            if len(p) > max_chunk_chars:  # 单段超长 → 硬切
                if current:
                    _append(current)
                    current = ""
                _hard_split(p)
                continue
            if len(current) + len(p) + 2 <= max_chunk_chars:
                current = f"{current}\n\n{p}".strip()
            else:
                if current:
                    _append(current)
                current = p
        if current:
            _append(current)

    for line in md.splitlines():
        m = re.match(r"^(#{1,6})\s+(.*)$", line)
        if m:
            flush()
            title = m.group(2).strip() or "Untitled"
            buf = []
        else:
            buf.append(line)
    flush()
    return sections


class DocumentRAG:
    def __init__(self, session_id: str = None):
        from service.embedding import get_embedding_function

        self.session_id = session_id
        self._embedding_fn = get_embedding_function()

        # 获取 ChromaDB 存储路径
        if IN_MODELSCOPE_SPACE and session_id:
            init_session(session_id)
            chroma_dir = str(get_session_path(session_id, "chroma"))
        else:
            from core.paths import data_path

            chroma_dir = str(data_path("chroma_store"))

        self.client = chromadb.Client(
            ChromaSettings(persist_directory=chroma_dir, is_persistent=True)
        )
        # 不在 collection 级绑定 embedding_function，避免与已持久化集合配置冲突
        self.collection = self.client.get_or_create_collection(
            name="doc_chunks",
            metadata={"hnsw:space": "cosine"},
        )
        logger.info(
            "[Session:%s] DocumentRAG 初始化: count=%d",
            session_id or "default",
            self.collection.count(),
        )

    def index_document(self, doc_id: str, doc_title: str, markdown: str) -> int:
        if not markdown.strip():
            return 0

        # 分块参数可用环境变量覆盖（评测扫描用）：RAG_CHUNK_SIZE / RAG_CHUNK_OVERLAP
        try:
            chunk_size = int(os.getenv("RAG_CHUNK_SIZE", "800"))
        except (TypeError, ValueError):
            chunk_size = 800
        try:
            overlap = int(os.getenv("RAG_CHUNK_OVERLAP", "0"))
        except (TypeError, ValueError):
            overlap = 0
        chunks = _split_markdown(markdown, max_chunk_chars=chunk_size, overlap_chars=overlap)
        if not chunks:
            return 0

        # 删除同文档旧索引，保证更新后可见
        try:
            self.collection.delete(where={"doc_id": doc_id})
        except Exception:
            pass

        ids = []
        docs = []
        metas = []
        for idx, c in enumerate(chunks):
            cid = f"{doc_id}::chunk::{idx}"
            ids.append(cid)
            docs.append(c["content"])
            metas.append(
                {
                    "doc_id": doc_id,
                    "doc_title": doc_title or doc_id,
                    "section_title": c["title"],
                    "chunk_index": idx,
                }
            )

        # 分批编码，避免大文档一次性编码导致内存峰值 / 原生崩溃
        embeddings = []
        _BATCH = 32
        for i in range(0, len(docs), _BATCH):
            embeddings.extend(self._embedding_fn(docs[i : i + _BATCH]))
        self.collection.add(
            ids=ids,
            documents=docs,
            metadatas=metas,
            embeddings=embeddings,
        )
        logger.info("DocumentRAG 索引完成: doc=%s chunks=%d", doc_id, len(ids))
        return len(ids)

    def search(self, query: str, top_k: int = 6) -> List[Dict[str, Any]]:
        if self.collection.count() == 0:
            return []
        query_vec = self._embedding_fn([query])[0]
        resp = self.collection.query(
            query_embeddings=[query_vec],
            n_results=min(top_k, self.collection.count()),
        )
        if not resp.get("ids") or not resp["ids"][0]:
            return []

        out: List[Dict[str, Any]] = []
        for i, cid in enumerate(resp["ids"][0]):
            md = (resp.get("metadatas") or [[{}]])[0][i] or {}
            doc = (resp.get("documents") or [[""]])[0][i] or ""
            dist = (resp.get("distances") or [[0]])[0][i]
            score = max(0, 1 - dist)
            out.append(
                {
                    "note_id": cid,
                    "summary": doc,
                    "concept": f"doc:{md.get('section_title', 'chunk')}",
                    "keywords": [],
                    "doc_title": md.get("doc_title", ""),
                    "page_num": int(md.get("chunk_index", 0)) // 3 + 1,  # 粗略估算页码
                    "bbox": [],
                    "score": round(score, 4),
                    "doc_id": md.get("doc_id", ""),
                    "source": "document",
                }
            )
        return out

    def reset(self):
        """
        DocumentRAG 为轻量无状态封装：reset 仅刷新句柄，不删除底层持久化数据。
        用于兼容 reset/demo 流程，避免 AttributeError 警告。
        """
        self.collection = self.client.get_or_create_collection(
            name="doc_chunks",
            metadata={"hnsw:space": "cosine"},
        )
        logger.debug(
            "[Session:%s] DocumentRAG reset: keep persisted collection",
            self.session_id or "default",
        )


def get_document_rag(session_id: Optional[str] = None) -> "DocumentRAG":
    """\u83b7\u53d6\u4f1a\u8bdd\u7ea7 DocumentRAG \u5b9e\u4f8b\uff08per-session \u5355\u4f8b\uff09\u3002"""
    key = session_id or "__default__"
    if key not in _instances:
        _instances[key] = DocumentRAG(session_id)
    return _instances[key]
