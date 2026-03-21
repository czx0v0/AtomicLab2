"""
共享 Embedding 函数
在 ModelScope 创空间中优先使用 ModelScope 下载并离线加载 embedding 模型，
避免访问 HuggingFace 导致网络不可达。
"""
import logging
import os
import threading
from typing import Optional

from chromadb.api.types import EmbeddingFunction, Documents, Embeddings

logger = logging.getLogger("aether")

_model = None
_model_lock = threading.Lock()
MODEL_NAME = "paraphrase-multilingual-MiniLM-L12-v2"
IN_MODELSCOPE_SPACE = os.path.exists("/mnt/workspace")


def _download_model_from_modelscope(model_name: str) -> Optional[str]:
    """仅在创空间下从 ModelScope 下载模型，返回本地路径。"""
    if not IN_MODELSCOPE_SPACE:
        return None

    ms_mapping = {
        "paraphrase-multilingual-MiniLM-L12-v2": "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2",
        "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2": "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2",
    }
    ms_model_name = ms_mapping.get(model_name, model_name)

    try:
        from modelscope import snapshot_download
    except ImportError:
        logger.warning("modelscope 未安装，无法下载 embedding 模型")
        return None

    cache_dir = os.getenv("MODELSCOPE_CACHE", "/mnt/workspace/.cache/modelscope")
    try:
        logger.info("从 ModelScope 下载 embedding 模型: %s", ms_model_name)
        local_path = snapshot_download(ms_model_name, cache_dir=cache_dir)
        logger.info("ModelScope embedding 模型就绪: %s", local_path)
        return local_path
    except Exception as e:
        logger.warning("ModelScope 下载 embedding 模型失败: %s", e)
        return None


def _get_model():
    """懒加载 SentenceTransformer（单例，线程安全；避免并发构造触发 meta tensor 竞态）。"""
    global _model
    if _model is None:
        with _model_lock:
            if _model is None:
                logger.info("加载 SentenceTransformer 模型 (%s)...", MODEL_NAME)
                from sentence_transformers import SentenceTransformer

                model_path = MODEL_NAME
                cache_folder = os.getenv("SENTENCE_TRANSFORMERS_HOME")
                st_kwargs = {"device": "cpu"}
                if cache_folder:
                    st_kwargs["cache_folder"] = cache_folder

                if IN_MODELSCOPE_SPACE:
                    # 创空间统一走 ModelScope/本地缓存，禁止运行时访问 HuggingFace。
                    local_model_path = _download_model_from_modelscope(MODEL_NAME)
                    if local_model_path:
                        model_path = local_model_path
                    st_kwargs["local_files_only"] = True

                # 显式指定 device='cpu'，避免 meta tensor 导致的同步报错
                _model = SentenceTransformer(model_path, **st_kwargs)
                logger.info(
                    "SentenceTransformer 加载完成 (dim=%d)",
                    _model.get_sentence_embedding_dimension(),
                )
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
