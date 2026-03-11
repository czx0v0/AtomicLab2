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
    # 关键：不硬编码 models-dir，让 mineru 使用自身默认路径
    # mineru-models-download 默认下到 ~/.cache/magic-pdf/ 或 MODELSCOPE_CACHE
    # 若 models-dir 路径不存在，magic-pdf 会静默退出(exit 0)不产生任何输出
    # ══════════════════════════════════════════════════════════════
    MINERU_CONFIG_FILE = "/mnt/workspace/.magic-pdf.json"

    # 设置 MinerU 环境变量（先于配置文件生成）
    os.environ.setdefault("MINERU_TOOLS_CONFIG_JSON", MINERU_CONFIG_FILE)
    # 关键：创空间内无法访问 HuggingFace，必须使用 ModelScope 模型源
    os.environ["MINERU_MODEL_SOURCE"] = "modelscope"

    # 自动创建/更新 MinerU 配置文件
    try:
        import json

        _need_write = True
        if os.path.exists(MINERU_CONFIG_FILE):
            try:
                with open(MINERU_CONFIG_FILE, "r") as _f:
                    _existing = json.load(_f)
                # 如果旧配置包含不存在的 models-dir，需要更新
                _old_models_dir = _existing.get("models-dir", "")
                if _old_models_dir and os.path.isdir(_old_models_dir):
                    _need_write = False  # 路径存在，保留旧配置
                    print(
                        f"[Config] MinerU 配置文件有效，models-dir: {_old_models_dir}"
                    )
                elif not _old_models_dir:
                    _need_write = False  # 没有 models-dir，使用默认路径
                    print(f"[Config] MinerU 配置文件有效，使用默认模型路径")
                else:
                    print(
                        f"[Config] MinerU 配置文件中 models-dir 不存在: {_old_models_dir}，将更新"
                    )
            except Exception:
                pass

        if _need_write:
            # 不设置 models-dir，让 mineru 自动查找
            config_content = {"device-mode": "cpu"}
            with open(MINERU_CONFIG_FILE, "w") as f:
                json.dump(config_content, f, indent=2)
            print(
                f"[Config] 已更新 MinerU 配置文件: {MINERU_CONFIG_FILE} (不指定models-dir，使用默认路径)"
            )
    except Exception as e:
        print(f"[Config] 创建 MinerU 配置文件失败: {e}")

    # 打印 magic-pdf 模型可能存在的路径（方便排查）
    _possible_model_dirs = [
        "/root/.cache/magic-pdf/models",
        f"{MODELSCOPE_CACHE_DIR}/models",
        os.path.expanduser("~/.cache/magic-pdf/models"),
    ]
    for _d in _possible_model_dirs:
        if os.path.exists(_d):
            _files = os.listdir(_d)
            print(f"[Config] MinerU 模型目录已找到: {_d} ({len(_files)} 个文件)")
            break
    else:
        print("[Config] 未找到 MinerU 模型目录，首次解析将触发自动下载")

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

            # 检查所有可能的模型目录
            model_found = False
            for model_dir in _possible_model_dirs:
                if os.path.exists(model_dir):
                    model_files = os.listdir(model_dir)
                    # 检查是否有实际的模型文件（不仅仅是目录）
                    has_model_files = any(
                        f.endswith(".pt")
                        or f.endswith(".pth")
                        or f.endswith(".onnx")
                        or f.endswith(".bin")
                        or os.path.isdir(os.path.join(model_dir, f))
                        for f in model_files
                    )
                    if has_model_files:
                        print(
                            f"[Config] ✓ MinerU 模型已存在: {model_dir} ({len(model_files)} 个文件)"
                        )
                        model_found = True
                        break

            if not model_found:
                print("[Config] MinerU 模型目录为空，从 ModelScope 下载模型...")
                print("[Config] 这可能需要几分钟时间（约3GB）...")
                import subprocess
                import shutil

                # 查找 mineru-models-download 命令
                download_cmd = shutil.which("mineru-models-download")
                if not download_cmd:
                    print("[Config] ⚠️ mineru-models-download 命令不存在，跳过模型下载")
                    return

                result = subprocess.run(
                    [download_cmd, "--source", "modelscope"],
                    capture_output=True,
                    text=True,
                    timeout=600,  # 10分钟超时
                    env={**os.environ, "MINERU_MODEL_SOURCE": "modelscope"},
                )
                if result.returncode == 0:
                    print("[Config] ✓ MinerU 模型下载完成")
                    if result.stdout:
                        print(f"[Config] stdout: {result.stdout[-300:]}")
                else:
                    print(f"[Config] ⚠️ MinerU 模型下载失败 (exit {result.returncode})")
                    if result.stderr:
                        print(f"[Config] stderr: {result.stderr[-300:]}")
                    if result.stdout:
                        print(f"[Config] stdout: {result.stdout[-300:]}")
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
    from aether_engine.core.session_store import (
        start_cleanup_scheduler,
        cleanup_all_sessions,
    )

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
