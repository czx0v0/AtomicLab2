import os
from dotenv import load_dotenv

# Try loading from standard paths (仅在文件存在时加载)
env_paths = [
    os.path.join(os.path.dirname(__file__), "../../.env"),
    os.path.join(os.path.dirname(__file__), "../.env"),
]
for env_path in env_paths:
    if os.path.exists(env_path):
        load_dotenv(env_path)

class Settings:
    # 应用基础配置
    APP_NAME: str = "Aether Engine"
    APP_VERSION: str = "0.1.0"
    APP_ENV: str = os.getenv("APP_ENV", "production")
    LOG_LEVEL: str = os.getenv("LOG_LEVEL", "info")
    
    # 服务器配置（ModelScope 创空间使用 7860 端口）
    UVICORN_HOST: str = os.getenv("UVICORN_HOST", "0.0.0.0")
    UVICORN_PORT: int = int(os.getenv("UVICORN_PORT", "7860"))
    
    # ModelScope API 配置
    MS_KEY: str = os.getenv("MS_KEY", "")
    
    # DeepSeek API 配置（使用环境变量）
    DEEPSEEK_API_KEY: str = os.getenv("DEEPSEEK_API_KEY", "")
    DEEPSEEK_API_BASE: str = os.getenv("DEEPSEEK_API_BASE", "https://api.deepseek.com")
    
    # 认证配置
    AUTH_PASSWORD: str = os.getenv("AUTH_PASSWORD", "")
    ENABLE_AUTH: bool = os.getenv("ENABLE_AUTH", "false").lower() == "true"
    
    # 模型缓存配置（ModelScope）
    MODELSCOPE_CACHE: str = os.getenv("MODELSCOPE_CACHE", "/mnt/workspace/.cache/modelscope")
    HF_HOME: str = os.getenv("HF_HOME", "/mnt/workspace/.cache/huggingface")
    TRANSFORMERS_CACHE: str = os.getenv("TRANSFORMERS_CACHE", "/mnt/workspace/.cache/huggingface")
    
    # MinerU 配置
    MINERU_TOOLS_CONFIG_JSON: str = os.getenv("MINERU_TOOLS_CONFIG_JSON", "/mnt/workspace/.magic-pdf.json")


settings = Settings()
