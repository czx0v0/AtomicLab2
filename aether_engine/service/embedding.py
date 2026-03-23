"""
共享 Embedding 函数
在 ModelScope 创空间中优先使用 ModelScope 下载并离线加载 embedding 模型，
避免访问 HuggingFace 导致网络不可达。
本地若需同样走 ModelScope，设置环境变量 EMBEDDING_USE_MODELSCOPE=1（见 modelspace-deploy/README.md「本地运行」）。
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


def _use_modelscope_download() -> bool:
    """创空间默认走 ModelScope；本地也可设 EMBEDDING_USE_MODELSCOPE=1 避免直连 HuggingFace。"""
    v = os.getenv("EMBEDDING_USE_MODELSCOPE", "").strip().lower()
    if v in ("1", "true", "yes", "on"):
        return True
    return IN_MODELSCOPE_SPACE


def _download_model_from_modelscope(model_name: str) -> Optional[str]:
    """从 ModelScope 下载 embedding 模型到本地缓存目录，返回本地路径。"""
    if not _use_modelscope_download():
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

    default_cache = "/mnt/workspace/.cache/modelscope" if IN_MODELSCOPE_SPACE else os.path.expanduser("~/.cache/modelscope")
    cache_dir = os.getenv("MODELSCOPE_CACHE", default_cache)
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

                if _use_modelscope_download():
                    local_model_path = _download_model_from_modelscope(MODEL_NAME)
                    if local_model_path:
                        model_path = local_model_path
                    elif IN_MODELSCOPE_SPACE:
                        logger.info(
                            "未从 ModelScope 获得路径，尝试使用 HF_HOME/transformers 已有缓存（local_files_only）"
                        )
                    if IN_MODELSCOPE_SPACE:
                        st_kwargs["local_files_only"] = True

                # 显式指定 device='cpu'，避免 meta tensor 导致的同步报错
                try:
                    _model = SentenceTransformer(model_path, **st_kwargs)
                except Exception as e:
                    if IN_MODELSCOPE_SPACE:
                        raise RuntimeError(
                            "创空间 Embedding 模型不可用：请确保已安装 modelscope 且能从 ModelScope "
                            "下载 sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2，"
                            "或将模型完整放入 HF_HOME/TRANSFORMERS_CACHE 后重试。"
                        ) from e
                    raise
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
