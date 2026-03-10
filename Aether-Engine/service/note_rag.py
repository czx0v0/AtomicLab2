"""
轻量级笔记 RAG 引擎
直接从 notes.json 加载笔记并建立 ChromaDB 向量索引，
无需复杂的 Document/Section/AtomicNote 模型。
"""
import json
import logging
from pathlib import Path
from typing import List, Dict, Any

import chromadb
from chromadb.config import Settings as ChromaSettings

logger = logging.getLogger("aether")

NOTES_FILE = Path("data/notes.json")
CHROMA_DIR = "data/chroma_store"

# 单例
_instance = None


class NoteRAG:
    """基于 ChromaDB 的笔记向量检索引擎。"""

    def __init__(self):
        from service.embedding import get_embedding_function
        self.client = chromadb.Client(
            ChromaSettings(persist_directory=CHROMA_DIR, is_persistent=True)
        )
        self.collection = self.client.get_or_create_collection(
            name="notes",
            metadata={"hnsw:space": "cosine"},
            embedding_function=get_embedding_function(),
        )
        logger.info("NoteRAG 初始化: collection=%s, count=%d", "notes", self.collection.count())

    def sync_notes(self):
        """从 notes.json 同步到 ChromaDB（增量）。"""
        if not NOTES_FILE.exists():
            return 0
        try:
            notes = json.loads(NOTES_FILE.read_text(encoding="utf-8"))
        except Exception:
            return 0

        existing_ids = set(self.collection.get()["ids"]) if self.collection.count() > 0 else set()
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
            metadatas.append({
                "type": n.get("type", "other"),
                "page": n.get("page", 0) or 0,
                "bbox": json.dumps(n.get("bbox", [])),
                "translation": n.get("translation", "") or "",
            })

        if ids:
            self.collection.add(ids=ids, documents=documents, metadatas=metadatas)
            logger.info("同步 %d 条笔记到向量库", len(ids))

        return len(ids)

    def search(self, query: str, top_k: int = 5) -> List[Dict[str, Any]]:
        """向量语义检索笔记。"""
        self.sync_notes()  # 每次检索前同步

        if self.collection.count() == 0:
            return []

        results = self.collection.query(
            query_texts=[query],
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

            out.append({
                "note_id": note_id,
                "summary": doc,
                "concept": meta.get("type", "other"),
                "keywords": [],
                "doc_title": "",
                "page_num": int(meta.get("page", 0)),
                "bbox": bbox,
                "score": round(score, 4),
                "translation": meta.get("translation", ""),
            })

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


def get_note_rag() -> NoteRAG:
    """获取单例 NoteRAG 实例。"""
    global _instance
    if _instance is None:
        _instance = NoteRAG()
    return _instance
