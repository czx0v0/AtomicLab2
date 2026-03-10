"""
ModelScope 创空间入口文件
Aether-Engine FastAPI 服务
"""

import os
import sys

# 设置 ModelScope 环境变量（替代 HuggingFace）
os.environ["MODELSCOPE_CACHE"] = "/home/user/.cache/modelscope"
os.environ["HF_HOME"] = "/home/user/.cache/modelscope/hf"  # 兼容某些库
os.environ["TRANSFORMERS_CACHE"] = "/home/user/.cache/modelscope/hf"

# 添加项目路径
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "aether_engine"))

# 导入 FastAPI 应用
from aether_engine.main import app

if __name__ == "__main__":
    import uvicorn

    # 从环境变量获取配置
    host = os.getenv("UVICORN_HOST", "0.0.0.0")
    port = int(os.getenv("UVICORN_PORT", "7860"))  # ModelScope 默认端口

    uvicorn.run(app, host=host, port=port)
