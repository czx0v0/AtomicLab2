"""
LLM 客户端单一事实来源。

统一 deepseek / aliyun 两套提供商，供 chat / writing / translate /
atomic_decomposer / note_distiller / latex_exporter / arxiv_secretary 等复用，
避免「model=deepseek-chat 硬编码 + DEEPSEEK_API_KEY 直读」散落各处导致
ALIYUN 提供商下路由失效。

用法：
    from core.llm import get_llm_config
    cfg = get_llm_config()          # {provider, api_key, base_url, model}
    from openai import OpenAI
    client = OpenAI(api_key=cfg["api_key"], base_url=cfg["base_url"])
    resp = client.chat.completions.create(model=cfg["model"], ...)
"""
import os


def get_llm_config() -> dict:
    """返回 provider-aware 的 LLM 配置（默认 deepseek，CHAT_LLM_PROVIDER=aliyun 时切换）。"""
    provider = (os.getenv("CHAT_LLM_PROVIDER", "deepseek") or "deepseek").strip().lower()
    if provider == "aliyun":
        return {
            "provider": "aliyun",
            "api_key": os.getenv("ALIYUN_API_KEY", ""),
            "base_url": os.getenv(
                "ALIYUN_API_BASE", "https://dashscope.aliyuncs.com/compatible-mode/v1"
            ),
            "model": os.getenv("ALIYUN_MODEL", "qwen3.7-flash"),
        }
    return {
        "provider": "deepseek",
        "api_key": os.getenv("DEEPSEEK_API_KEY", ""),
        "base_url": os.getenv("DEEPSEEK_API_BASE", "https://api.deepseek.com"),
        "model": os.getenv("DEEPSEEK_CHAT_MODEL", "deepseek-chat"),
    }
