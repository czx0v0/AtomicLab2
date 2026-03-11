"""
ModelScope 创空间入口文件
Aether-Engine FastAPI 服务
"""

import os
import sys

# 添加项目路径
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "aether_engine"))

# 检测是否在 ModelScope 创空间环境
IN_MODELSCOPE_SPACE = os.path.exists("/mnt/workspace")

if IN_MODELSCOPE_SPACE:
    # ══════════════════════════════════════════════════════════════
    # ModelScope 创空间专用配置
    # ══════════════════════════════════════════════════════════════

    # 创空间持久化存储目录
    MODEL_CACHE_DIR = "/mnt/workspace/.cache/huggingface"
    MODELSCOPE_CACHE_DIR = "/mnt/workspace/.cache/modelscope"

    # 设置模型缓存环境变量（仅在未设置时）
    if "TRANSFORMERS_CACHE" not in os.environ:
        os.environ["TRANSFORMERS_CACHE"] = MODEL_CACHE_DIR
    if "HF_HOME" not in os.environ:
        os.environ["HF_HOME"] = MODEL_CACHE_DIR
    if "MODELSCOPE_CACHE" not in os.environ:
        os.environ["MODELSCOPE_CACHE"] = MODELSCOPE_CACHE_DIR

    print(f"[Config] ModelScope 创空间环境")
    print(f"[Config] HuggingFace 缓存: {MODEL_CACHE_DIR}")
    print(f"[Config] ModelScope 缓存: {MODELSCOPE_CACHE_DIR}")

    # ══════════════════════════════════════════════════════════════
    # MinerU 自动初始化（创空间无终端访问权限）
    # ══════════════════════════════════════════════════════════════
    MINERU_MODELS_DIR = "/mnt/workspace/models/MinerU"
    MINERU_CONFIG_FILE = "/mnt/workspace/.magic-pdf.json"

    # 自动创建 MinerU 配置文件
    if not os.path.exists(MINERU_CONFIG_FILE):
        try:
            os.makedirs(MINERU_MODELS_DIR, exist_ok=True)
            import json

            config_content = {
                "models-dir": MINERU_MODELS_DIR,
                "layoutreader-model-dir": f"{MINERU_MODELS_DIR}/ReadingOrder/layout_reader",
                "device-mode": "cpu",
            }
            with open(MINERU_CONFIG_FILE, "w") as f:
                json.dump(config_content, f, indent=2)
            print(f"[Config] 已创建 MinerU 配置文件: {MINERU_CONFIG_FILE}")
        except Exception as e:
            print(f"[Config] 创建 MinerU 配置文件失败: {e}")

    # 设置 MinerU 环境变量
    os.environ.setdefault("MINERU_TOOLS_CONFIG_JSON", MINERU_CONFIG_FILE)

    # 自动下载 MinerU 模型（首次使用时）
    def setup_mineru_models():
        """检查并下载 MinerU 模型"""
        try:
            # 首先检查 mineru 是否已安装
            try:
                import magic_pdf

                print("[Config] ✓ MinerU 已安装")
            except ImportError:
                print("[Config] ⚠️ MinerU 未安装，PDF 功能将不可用")
                return

            model_files = (
                os.listdir(MINERU_MODELS_DIR)
                if os.path.exists(MINERU_MODELS_DIR)
                else []
            )
            # 检查是否有实际的模型文件（不仅仅是目录）
            has_model_files = any(
                f.endswith(".pt")
                or f.endswith(".pth")
                or f.endswith(".onnx")
                or "." in f
                for f in model_files
            )

            if not has_model_files:
                print("[Config] MinerU 模型目录为空，尝试自动下载模型...")
                print("[Config] 这可能需要几分钟时间（约3GB）...")
                import subprocess

                result = subprocess.run(
                    ["python", "-m", "magic_pdf.cli.model_download"],
                    capture_output=True,
                    text=True,
                    timeout=600,  # 10分钟超时
                )
                if result.returncode == 0:
                    print("[Config] ✓ MinerU 模型下载完成")
                else:
                    print(f"[Config] ⚠️ MinerU 模型下载失败: {result.stderr}")
            else:
                print(f"[Config] ✓ MinerU 模型已存在 ({len(model_files)} 个文件)")
        except Exception as e:
            print(f"[Config] MinerU 初始化失败（非关键功能）: {e}")

    setup_mineru_models()

else:
    # 本地开发环境 - 使用默认配置
    print("[Config] 本地开发环境")
    print("[Config] 使用系统默认缓存配置")

# 导入 FastAPI 应用
from aether_engine.main import app

# 启动会话清理调度器（仅在创空间环境）
if IN_MODELSCOPE_SPACE:
    from aether_engine.core.session_store import start_cleanup_scheduler, cleanup_all_sessions
    # 启动时清理所有旧会话
    cleanup_all_sessions()
    # 启动定时清理（每5分钟检查一次）
    start_cleanup_scheduler(interval_seconds=300)

if __name__ == "__main__":
    import uvicorn
    
    # 从环境变量获取配置
    host = os.getenv("UVICORN_HOST", "0.0.0.0")
    port = int(os.getenv("UVICORN_PORT", "7860"))  # ModelScope 默认端口
    
    uvicorn.run(app, host=host, port=port)
