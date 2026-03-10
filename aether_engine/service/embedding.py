"""
共享 Embedding 函数
使用 ModelScope 上的 SentenceTransformer 模型（384 维），避免 ChromaDB 默认 ONNX 下载阻塞。
模型缓存在 MODELSCOPE_CACHE（/home/user/.cache/modelscope）。
"""

import os
import logging
from typing import Optional

from chromadb.api.types import EmbeddingFunction, Documents, Embeddings

logger = logging.getLogger("aether")

_model = None

# ModelScope 模型映射（将 HuggingFace 模型名映射到 ModelScope）
# 参考 ModelScope 官方模型仓库命名规范
MODELSCOPE_MODEL_MAP = {
    "paraphrase-multilingual-MiniLM-L12-v2": "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2",
    "BAAI/bge-reranker-v2-m3": "BAAI/bge-reranker-v2-m3",
}


def _get_model():
    """懒加载 SentenceTransformer（单例），使用 ModelScope 模型源。"""
    global _model
    if _model is None:
        logger.info(
            "加载 SentenceTransformer 模型 (paraphrase-multilingual-MiniLM-L12-v2)..."
        )

        # 设置 ModelScope 环境变量
        os.environ.setdefault("MODELSCOPE_CACHE", "/home/user/.cache/modelscope")
        os.environ.setdefault("HF_HOME", "/home/user/.cache/modelscope/hf")
        os.environ.setdefault("TRANSFORMERS_CACHE", "/home/user/.cache/modelscope/hf")

        from sentence_transformers import SentenceTransformer

        # 使用 ModelScope 模型 ID
        model_name = "paraphrase-multilingual-MiniLM-L12-v2"
        modelscope_id = MODELSCOPE_MODEL_MAP.get(model_name, model_name)

        try:
            # 尝试从 ModelScope 加载
            _model = SentenceTransformer(modelscope_id, trust_remote_code=True)
            logger.info("从 ModelScope 加载模型成功: %s", modelscope_id)
        except Exception as e:
            logger.warning("从 ModelScope 加载失败，尝试 HuggingFace: %s", e)
            _model = SentenceTransformer(model_name)

        logger.info(
            "SentenceTransformer 加载完成 (dim=%d)",
            _model.get_sentence_embedding_dimension(),
        )
    return _model


class LocalEmbeddingFunction(EmbeddingFunction):
    """基于本地 SentenceTransformer 的 ChromaDB 嵌入函数。"""

    def __call__(self, input: Documents) -> Embeddings:
        model = _get_model()
        embeddings = model.encode(
            list(input), show_progress_bar=False, normalize_embeddings=True
        )
        return embeddings.tolist()


# 单例
_ef_instance: Optional[LocalEmbeddingFunction] = None


def get_embedding_function() -> LocalEmbeddingFunction:
    global _ef_instance
    if _ef_instance is None:
        _ef_instance = LocalEmbeddingFunction()
    return _ef_instance
