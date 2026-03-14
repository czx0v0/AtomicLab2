"""
共享 Embedding 函数
使用本地 SentenceTransformer 模型（384 维），避免 ChromaDB 默认 ONNX 下载阻塞。
模型缓存在 HF_HOME（D:\models\.cache\huggingface）。
"""
import logging
from typing import Optional

from chromadb.api.types import EmbeddingFunction, Documents, Embeddings

logger = logging.getLogger("aether")

_model = None


def _get_model():
    """懒加载 SentenceTransformer（单例）。"""
    global _model
    if _model is None:
        logger.info("加载 SentenceTransformer 模型 (paraphrase-multilingual-MiniLM-L12-v2)...")
        from sentence_transformers import SentenceTransformer
        # 显式指定 device='cpu'，避免 meta tensor 导致的 "Cannot copy out of meta tensor"（索引/向量同步时报错）
        _model = SentenceTransformer("paraphrase-multilingual-MiniLM-L12-v2", device="cpu")
        logger.info("SentenceTransformer 加载完成 (dim=%d)", _model.get_sentence_embedding_dimension())
    return _model


class LocalEmbeddingFunction(EmbeddingFunction):
    """基于本地 SentenceTransformer 的 ChromaDB 嵌入函数。"""

    def __call__(self, input: Documents) -> Embeddings:
        model = _get_model()
        embeddings = model.encode(list(input), show_progress_bar=False, normalize_embeddings=True)
        return embeddings.tolist()


# 单例
_ef_instance: Optional[LocalEmbeddingFunction] = None


def get_embedding_function() -> LocalEmbeddingFunction:
    global _ef_instance
    if _ef_instance is None:
        _ef_instance = LocalEmbeddingFunction()
    return _ef_instance
