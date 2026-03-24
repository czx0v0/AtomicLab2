"""
BM25 关键词检索引擎
基于 rank-bm25 + jieba 中文分词，为笔记和文档切块提供关键词检索通道。
支持增量更新、多字段加权、持久化。
"""

import json
import logging
import os
import re
import threading
from pathlib import Path
from typing import List, Dict, Any, Tuple, Optional

import jieba
from rank_bm25 import BM25Okapi

logger = logging.getLogger("aether")

NOTES_FILE = Path("data/notes.json")


# 检测是否在创空间环境
IN_MODELSCOPE_SPACE = os.path.exists("/mnt/workspace")

# 停用词（高频无意义词）
_STOP_WORDS = {
    "的",
    "了",
    "在",
    "是",
    "我",
    "有",
    "和",
    "就",
    "不",
    "人",
    "都",
    "一",
    "一个",
    "上",
    "也",
    "很",
    "到",
    "说",
    "要",
    "去",
    "你",
    "会",
    "着",
    "没有",
    "看",
    "好",
    "自己",
    "这",
    "他",
    "她",
    "它",
    "们",
    "那",
    "被",
    "the",
    "a",
    "an",
    "is",
    "are",
    "was",
    "were",
    "be",
    "been",
    "being",
    "have",
    "has",
    "had",
    "do",
    "does",
    "did",
    "will",
    "would",
    "could",
    "should",
    "may",
    "might",
    "shall",
    "can",
    "need",
    "dare",
    "ought",
    "to",
    "of",
    "in",
    "for",
    "on",
    "with",
    "at",
    "by",
    "from",
    "as",
    "into",
    "about",
    "through",
    "between",
    "after",
    "and",
    "but",
    "or",
    "not",
    "no",
    "this",
    "that",
    "these",
    "those",
    "it",
    "its",
}


def tokenize_zh(text: str) -> List[str]:
    """
    中英文混合分词：jieba 切中文 + regex 切英文 token。
    过滤停用词和单字符。
    """
    if not text:
        return []
    text = text.lower().strip()
    tokens = list(jieba.cut_for_search(text))
    # 补充英文 token（jieba 可能不分割英文词组）
    en_tokens = re.findall(r"[a-zA-Z][a-zA-Z0-9\-]{1,}", text)
    all_tokens = tokens + en_tokens
    # 过滤
    return [
        t.strip()
        for t in all_tokens
        if t.strip() and len(t.strip()) > 1 and t.strip() not in _STOP_WORDS
    ]


class BM25Engine:
    """
    BM25 检索引擎，维护两个独立索引：
    - notes: 原子笔记卡片
    - doc_chunks: 文档原文切块
    """

    def __init__(self, session_id: Optional[str] = None):
        self.session_id = session_id
        self._lock = threading.RLock()

        # 会话层笔记文件路径
        if IN_MODELSCOPE_SPACE and session_id:
            from core.session_store import get_session_path, init_session

            init_session(session_id)
            self.notes_file = get_session_path(session_id, "notes.json")
        else:
            self.notes_file = NOTES_FILE

        # 索引 ID 列表（与 BM25 corpus 对齐）
        self._note_ids: List[str] = []
        self._note_corpus: List[List[str]] = []
        self._note_meta: List[Dict[str, Any]] = []
        self._note_bm25: Optional[BM25Okapi] = None

        self._doc_ids: List[str] = []
        self._doc_corpus: List[List[str]] = []
        self._doc_meta: List[Dict[str, Any]] = []
        self._doc_bm25: Optional[BM25Okapi] = None

        self._note_id_set: set = set()
        self._doc_id_set: set = set()

    # ── Notes 索引 ───────────────────────────────────────────────────────────

    def build_notes_index(self):
        """从 notes.json 构建/重建 BM25 索引。"""
        with self._lock:
            if not self.notes_file.exists():
                return 0

            try:
                notes = json.loads(self.notes_file.read_text(encoding="utf-8"))
            except Exception:
                return 0

            self._note_ids = []
            self._note_corpus = []
            self._note_meta = []
            self._note_id_set = set()

        for n in notes:
            nid = n.get("id", "")
            content = n.get("content", "").strip()
            if not nid or not content:
                continue

            # 多字段拼接（标题/翻译权重更高，重复加入）
            translation = n.get("translation", "") or ""
            source_name = n.get("source_name", "") or ""
            # 字段加权：重要字段 token 重复以提升 BM25 权重
            weighted_text = (
                f"{content} {content} {translation} {source_name} {source_name}"
            )
            tokens = tokenize_zh(weighted_text)

            if not tokens:
                continue

            self._note_ids.append(nid)
            self._note_corpus.append(tokens)
            self._note_meta.append(
                {
                    "content": content,
                    "type": n.get("type", "other"),
                    "page": int(n.get("page", 0) or 0),
                    "bbox": n.get("bbox", []),
                    "doc_id": n.get("doc_id", "") or "",
                    "translation": translation,
                    "source_name": source_name,
                    "screenshot": n.get("screenshot", ""),
                }
            )
            self._note_id_set.add(nid)

            if self._note_corpus:
                self._note_bm25 = BM25Okapi(self._note_corpus)
                logger.info("BM25 Notes 索引构建完成: %d 条", len(self._note_ids))
            else:
                self._note_bm25 = None

            return len(self._note_ids)

    def search_notes(self, query: str, top_k: int = 10) -> List[Dict[str, Any]]:
        """BM25 检索笔记，返回带分数的结果列表。"""
        with self._lock:
            if not self._note_bm25 or not self._note_ids:
                self.build_notes_index()

            if not self._note_bm25 or not self._note_ids:
                return []

            tokens = tokenize_zh(query)
            if not tokens:
                return []

            scores = self._note_bm25.get_scores(tokens)

            # 取 top_k
            scored = [(i, s) for i, s in enumerate(scores) if s > 0]
            scored.sort(key=lambda x: x[1], reverse=True)
            scored = scored[:top_k]

            if not scored:
                return []

            # 归一化分数到 [0, 1]
            max_score = scored[0][1]
            results = []
            for idx, raw_score in scored:
                meta = self._note_meta[idx]
                norm_score = raw_score / max_score if max_score > 0 else 0
                results.append(
                    {
                        "note_id": self._note_ids[idx],
                        "summary": meta["content"],
                        "concept": meta["type"],
                        "keywords": tokens[:6],
                        "doc_title": meta["source_name"],
                        "doc_id": meta.get("doc_id", ""),
                        "page_num": meta["page"],
                        "bbox": meta["bbox"],
                        "score": round(norm_score, 4),
                        "source": "note_bm25",
                    }
                )

            return results

    # ── Document Chunks 索引 ─────────────────────────────────────────────────

    def build_doc_index_from_chromadb(self):
        """从 DocumentRAG ChromaDB 读取所有切块构建 BM25 索引。"""
        with self._lock:
            try:
                from service.doc_rag import get_document_rag

                doc_rag = get_document_rag(self.session_id)
                if doc_rag.collection.count() == 0:
                    return 0

                raw = doc_rag.collection.get(include=["documents", "metadatas"])
            except Exception as e:
                logger.warning("BM25 读取 DocumentRAG 失败: %s", e)
                return 0

            self._doc_ids = []
            self._doc_corpus = []
            self._doc_meta = []
            self._doc_id_set = set()

        for i, cid in enumerate(raw.get("ids", [])):
            doc_text = (raw.get("documents") or [""])[i] or ""
            md = (raw.get("metadatas") or [{}])[i] or {}

            if not doc_text.strip():
                continue

            title = md.get("doc_title", "")
            section = md.get("section_title", "")
            # 字段加权：标题和章节名重复以提升权重
            weighted_text = f"{title} {title} {section} {section} {doc_text}"
            tokens = tokenize_zh(weighted_text)

            if not tokens:
                continue

            self._doc_ids.append(cid)
            self._doc_corpus.append(tokens)
            self._doc_meta.append(
                {
                    "content": doc_text,
                    "doc_title": title,
                    "section_title": section,
                    "doc_id": md.get("doc_id", ""),
                    "chunk_index": int(md.get("chunk_index", i)),
                }
            )
            self._doc_id_set.add(cid)

            if self._doc_corpus:
                self._doc_bm25 = BM25Okapi(self._doc_corpus)
                logger.info("BM25 DocChunks 索引构建完成: %d 条", len(self._doc_ids))
            else:
                self._doc_bm25 = None

            return len(self._doc_ids)

    def search_docs(self, query: str, top_k: int = 10) -> List[Dict[str, Any]]:
        """BM25 检索文档切块。"""
        with self._lock:
            if not self._doc_bm25 or not self._doc_ids:
                self.build_doc_index_from_chromadb()

            if not self._doc_bm25 or not self._doc_ids:
                return []

            tokens = tokenize_zh(query)
            if not tokens:
                return []

            scores = self._doc_bm25.get_scores(tokens)
            scored = [(i, s) for i, s in enumerate(scores) if s > 0]
            scored.sort(key=lambda x: x[1], reverse=True)
            scored = scored[:top_k]

            if not scored:
                return []

            max_score = scored[0][1]
            results = []
            for idx, raw_score in scored:
                if idx >= len(self._doc_meta) or idx >= len(self._doc_ids):
                    continue
                meta = self._doc_meta[idx]
                norm_score = raw_score / max_score if max_score > 0 else 0
                results.append(
                    {
                        "note_id": self._doc_ids[idx],
                        "summary": meta["content"],
                        "concept": f"doc:{meta['section_title'] or 'chunk'}",
                        "keywords": tokens[:6],
                        "doc_title": meta["doc_title"],
                        "page_num": meta.get("chunk_index", 0) // 3 + 1,
                        "bbox": [],
                        "score": round(norm_score, 4),
                        "source": "doc_bm25",
                        "doc_id": meta["doc_id"],
                    }
                )

            return results

    def invalidate(self):
        """标记索引需要重建（当笔记或文档发生变化时调用）。"""
        self._note_bm25 = None
        self._note_ids = []
        self._doc_bm25 = None
        self._doc_ids = []


# per-session 实例字典
_instances: Dict[str, BM25Engine] = {}


def get_bm25_engine(session_id: Optional[str] = None) -> BM25Engine:
    """\u83b7\u53d6\u4f1a\u8bdd\u7ea7 BM25Engine \u5b9e\u4f8b\uff08per-session \u5355\u4f8b\uff09\u3002"""
    key = session_id or "__default__"
    if key not in _instances:
        _instances[key] = BM25Engine(session_id)
    return _instances[key]
