"""
统一数据根目录解析。

评测 / 建库脚本可通过环境变量 DATA_DIR 把「数据根」切到隔离目录
（例如 data/eval_runtime/single），从而与正式服务的 data/（含 demo 白皮书、
用户文献、笔记、图谱）彻底隔离，保证干净评测。

用法：
  os.environ["DATA_DIR"] = "data/eval_runtime/single"   # 在 import 检索模块前设置
  from core.paths import data_path
  chroma_dir = data_path("chroma_store")
"""
import os
from pathlib import Path


def data_root() -> Path:
    """返回数据根目录（默认 CWD 下的 data/）。"""
    return Path(os.getenv("DATA_DIR", "data"))


def data_path(*parts) -> Path:
    """返回数据根目录下的相对路径。"""
    return data_root().joinpath(*parts)
