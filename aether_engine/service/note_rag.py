"""
轻量级笔记 RAG 引擎（会话隔离版）
直接从 notes.json 加载笔记并建立 ChromaDB 向量索引，
无需复杂的 Document/Section/AtomicNote 模型。
"""

import json
import logging
import os
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

    def sync_notes(self):
        """从 notes.json 同步到 ChromaDB（增量）。"""
        if not self.notes_file.exists():
            return 0
        try:
            notes = json.loads(self.notes_file.read_text(encoding="utf-8"))
        except Exception:
            return 0

        existing_ids = (
            set(self.collection.get()["ids"]) if self.collection.count() > 0 else set()
        )
        new_notes = [n for n in notes if n.get("id") and n["id"] not in existing_ids]

        if not new_notes:
            return 0

        ids = []
        documents = []
        metadatas = []
        for n in new_notes:
            content = n.get("content", "").strip()
            if not content:
                continue
            ids.append(n["id"])
            documents.append(content)
            metadatas.append(
                {
                    "type": n.get("type", "other"),
                    "page": n.get("page", 0) or 0,
                    "doc_id": n.get("doc_id", "") or "",
                    "source_name": n.get("source_name", "") or "",
                    "bbox": json.dumps(n.get("bbox", [])),
                    "translation": n.get("translation", "") or "",
                }
            )

        if ids:
            embeddings = self._embedding_fn(documents)
            self.collection.add(
                ids=ids,
                documents=documents,
                metadatas=metadatas,
                embeddings=embeddings,
            )
            logger.info(
                "[Session:%s] 同步 %d 条笔记到向量库",
                self.session_id or "default",
                len(ids),
            )

        return len(ids)

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
                    "keywords": [],
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
