"""
轻量级笔记 RAG 引擎（会话隔离版）
直接从 notes.json 加载笔记并建立 ChromaDB 向量索引，
无需复杂的 Document/Section/AtomicNote 模型。
"""

import json
import logging
import os
import re
import hashlib
from pathlib import Path
from typing import List, Dict, Any, Optional

import chromadb
from chromadb.config import Settings as ChromaSettings

logger = logging.getLogger("aether")

NOTES_FILE = Path("data/notes.json")
CHROMA_DIR = "data/chroma_store"

# 检测是否在创空间环境
IN_MODELSCOPE_SPACE = os.path.exists("/mnt/workspace")

# per-session 实例字典（key: session_id 或 "__default__"）
_instances: Dict[str, "NoteRAG"] = {}


class NoteRAG:
    """基于 ChromaDB 的笔记向量检索引擎。"""

    def __init__(self, session_id: Optional[str] = None):
        from service.embedding import get_embedding_function

        self.session_id = session_id
        self._embedding_fn = get_embedding_function()

        # 根据 session 确定路径
        if IN_MODELSCOPE_SPACE and session_id:
            from core.session_store import get_session_path, init_session

            init_session(session_id)
            self.notes_file = get_session_path(session_id, "notes.json")
            chroma_dir = str(get_session_path(session_id, "chroma"))
        else:
            self.notes_file = NOTES_FILE
            chroma_dir = CHROMA_DIR

        self.client = chromadb.Client(
            ChromaSettings(persist_directory=chroma_dir, is_persistent=True)
        )
        # 不在 collection 级绑定 embedding_function，避免与已持久化集合配置冲突
        self.collection = self.client.get_or_create_collection(
            name="notes",
            metadata={"hnsw:space": "cosine"},
        )
        logger.info(
            "[Session:%s] NoteRAG 初始化: collection=%s, count=%d",
            session_id or "default",
            "notes",
            self.collection.count(),
        )

    def _note_index_text(self, note: Dict[str, Any]) -> str:
        """构建笔记索引文本：content + 原子字段 + tags + 轻量元信息。"""
        content = str(note.get("content", "") or "").strip()
        axiom = str(note.get("axiom", "") or "").strip()
        method = str(note.get("method", "") or note.get("methodology", "") or "").strip()
        boundary = str(note.get("boundary", "") or "").strip()

        tags_raw = note.get("tags") or note.get("keywords") or []
        tags: List[str] = []
        if isinstance(tags_raw, list):
            tags = [str(t).strip() for t in tags_raw if str(t).strip()]

        doc_name = str(note.get("source_name", "") or "").strip()
        doc_id = str(note.get("doc_id", "") or "").strip()
        page = str(note.get("page", "") or "").strip()
        note_type = str(note.get("type", "") or "").strip()

        parts = [
            content,
            axiom and f"Axiom: {axiom}",
            method and f"Method: {method}",
            boundary and f"Boundary: {boundary}",
            tags and f"Tags: {' '.join(tags[:16])}",
            doc_name and f"Document: {doc_name}",
            doc_id and f"DocID: {doc_id}",
            page and f"Page: {page}",
            note_type and f"Type: {note_type}",
        ]
        text = "\n".join([p for p in parts if p])
        # 避免异常长文本拖慢 embedding
        return text[:6000]

    def _text_digest(self, text: str) -> str:
        return hashlib.md5(text.encode("utf-8")).hexdigest()

    def _extract_keywords_from_text(self, text: str, limit: int = 8) -> List[str]:
        words = re.findall(r"[A-Za-z][A-Za-z0-9_\-]{2,}|[\u4e00-\u9fff]{2,8}", text or "")
        out: List[str] = []
        seen = set()
        for w in words:
            k = w.strip().lower()
            if not k or k in seen:
                continue
            seen.add(k)
            out.append(k)
            if len(out) >= limit:
                break
        return out

    def sync_notes(self):
        """从 notes.json 同步到 ChromaDB（增量+更新）。"""
        if not self.notes_file.exists():
            return 0
        try:
            notes = json.loads(self.notes_file.read_text(encoding="utf-8"))
        except Exception:
            return 0
        valid_notes = [n for n in notes if n.get("id")]
        if not valid_notes:
            return 0

        note_ids = [str(n["id"]) for n in valid_notes]
        existing_meta_by_id: Dict[str, Dict[str, Any]] = {}
        try:
            if self.collection.count() > 0:
                existing = self.collection.get(ids=note_ids, include=["metadatas"])
                ids_got = existing.get("ids") or []
                metas_got = existing.get("metadatas") or []
                for i, nid in enumerate(ids_got):
                    if isinstance(nid, str):
                        existing_meta_by_id[nid] = metas_got[i] if i < len(metas_got) else {}
        except Exception:
            existing_meta_by_id = {}

        upsert_ids: List[str] = []
        upsert_docs: List[str] = []
        upsert_metas: List[Dict[str, Any]] = []

        for n in valid_notes:
            nid = str(n["id"])
            index_text = self._note_index_text(n)
            if not index_text.strip():
                continue
            digest = self._text_digest(index_text)
            old_digest = str((existing_meta_by_id.get(nid) or {}).get("digest", "") or "")
            if digest == old_digest:
                continue

            keywords = self._extract_keywords_from_text(index_text, limit=8)
            upsert_ids.append(nid)
            upsert_docs.append(index_text)
            upsert_metas.append(
                {
                    "type": n.get("type", "other"),
                    "page": n.get("page", 0) or 0,
                    "doc_id": n.get("doc_id", "") or "",
                    "source_name": n.get("source_name", "") or "",
                    "bbox": json.dumps(n.get("bbox", [])),
                    "translation": n.get("translation", "") or "",
                    "keywords": json.dumps(keywords, ensure_ascii=False),
                    "digest": digest,
                }
            )

        if upsert_ids:
            embeddings = self._embedding_fn(upsert_docs)
            self.collection.upsert(
                ids=upsert_ids,
                documents=upsert_docs,
                metadatas=upsert_metas,
                embeddings=embeddings,
            )
            logger.info(
                "[Session:%s] 同步/更新 %d 条笔记到向量库",
                self.session_id or "default",
                len(upsert_ids),
            )

        # 清理已不存在于 notes.json 的脏索引
        try:
            if self.collection.count() > 0:
                all_ids = set(self.collection.get().get("ids") or [])
                live_ids = set(note_ids)
                stale_ids = list(all_ids - live_ids)
                if stale_ids:
                    self.collection.delete(ids=stale_ids)
        except Exception:
            pass

        return len(upsert_ids)

    def search(self, query: str, top_k: int = 5) -> List[Dict[str, Any]]:
        """向量语义检索笔记。"""
        self.sync_notes()  # 每次检索前同步

        if self.collection.count() == 0:
            return []

        query_vec = self._embedding_fn([query])[0]
        results = self.collection.query(
            query_embeddings=[query_vec],
            n_results=min(top_k, self.collection.count()),
        )

        if not results["ids"] or not results["ids"][0]:
            return []

        out = []
        for i, note_id in enumerate(results["ids"][0]):
            meta = results["metadatas"][0][i] if results["metadatas"] else {}
            doc = results["documents"][0][i] if results["documents"] else ""
            distance = results["distances"][0][i] if results.get("distances") else 0
            score = max(0, 1 - distance)  # cosine distance → similarity

            bbox_raw = meta.get("bbox", "[]")
            try:
                bbox = json.loads(bbox_raw)
            except Exception:
                bbox = []

            out.append(
                {
                    "note_id": note_id,
                    "summary": doc,
                    "concept": meta.get("type", "other"),
                    "keywords": (
                        json.loads(meta.get("keywords", "[]"))
                        if isinstance(meta.get("keywords"), str)
                        else []
                    ),
                    "doc_title": meta.get("source_name", ""),
                    "doc_id": meta.get("doc_id", ""),
                    "page_num": int(meta.get("page", 0)),
                    "bbox": bbox,
                    "score": round(score, 4),
                    "translation": meta.get("translation", ""),
                }
            )

        return out

    def delete_note(self, note_id: str):
        """从向量库删除笔记。"""
        try:
            self.collection.delete(ids=[note_id])
        except Exception:
            pass

    def reset(self):
        """重建索引。"""
        try:
            self.client.delete_collection("notes")
        except Exception:
            pass
        self.collection = self.client.get_or_create_collection(
            name="notes",
            metadata={"hnsw:space": "cosine"},
        )
        self.sync_notes()


def get_note_rag(session_id: Optional[str] = None) -> NoteRAG:
    """\u83b7\u53d6\u4f1a\u8bdd\u7ea7 NoteRAG \u5b9e\u4f8b\uff08per-session \u5355\u4f8b\uff09\u3002"""
    key = session_id or "__default__"
    if key not in _instances:
        _instances[key] = NoteRAG(session_id)
    return _instances[key]
