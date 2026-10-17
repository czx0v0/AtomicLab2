"""
模型 API 连通性测试：DeepSeek(chat/reasoner) + Aliyun(Qwen)。

用法：
    python scripts/test_api.py                 # 测所有已配置 key 的模型
    python scripts/test_api.py --model deepseek-reasoner   # 只测某个
    python scripts/test_api.py --list-models   # 列出各厂商可用模型名
"""
from __future__ import annotations

import argparse
import os
import time
from pathlib import Path

_REPO = Path(__file__).resolve().parent.parent


def _load_env() -> None:
    try:
        from dotenv import load_dotenv

        for env in (_REPO / ".env", _REPO.parent / ".env"):
            if env.exists():
                load_dotenv(env, override=False)
                print(f"[env] 已加载 {env}")
                break
    except ImportError:
        pass


def _client(api_key: str, base_url: str):
    from openai import OpenAI

    return OpenAI(api_key=api_key, base_url=base_url)


def test(name: str, api_key: str, base_url: str, model: str) -> None:
    if not api_key:
        print(f"[skip] {name} (model={model}): 未配置 API key")
        return
    try:
        client = _client(api_key, base_url)
        t0 = time.time()
        resp = client.chat.completions.create(
            model=model,
            messages=[{"role": "user", "content": "ping，请只回复 pong"}],
            max_tokens=512,  # 加大，避免推理模型把 token 全花在 reasoning 上
            temperature=0,
        )
        dt = (time.time() - t0) * 1000
        msg = resp.choices[0].message
        content = (msg.content or "").strip()
        reasoning = getattr(msg, "reasoning_content", None) or ""
        if not content and reasoning:
            content = f"(仅 reasoning，{len(reasoning)} 字符)"
        print(f"[OK] {name} (model={model}) {dt:.0f}ms -> {content[:40]!r}")
    except Exception as e:
        print(f"[FAIL] {name} (model={model}): {type(e).__name__}: {str(e)[:200]}")


def list_models(name: str, api_key: str, base_url: str) -> None:
    if not api_key:
        print(f"[skip] {name}: 未配置 API key，跳过列表")
        return
    try:
        client = _client(api_key, base_url)
        models = client.models.list()
        ids = sorted(m.id for m in models.data)
        print(f"[models] {name}: {ids}")
    except Exception as e:
        print(f"[FAIL] {name} 列模型失败: {type(e).__name__}: {str(e)[:200]}")


def main() -> None:
    _load_env()
    p = argparse.ArgumentParser(description="模型 API 连通性测试")
    p.add_argument("--model", default="", help="只测指定模型名")
    p.add_argument("--list-models", action="store_true", help="列出各厂商可用模型")
    args = p.parse_args()

    ds_key = os.getenv("DEEPSEEK_API_KEY", "").strip()
    ds_base = os.getenv("DEEPSEEK_API_BASE", "https://api.deepseek.com").strip()
    ali_key = os.getenv("ALIYUN_API_KEY", "").strip()
    ali_base = os.getenv("ALIYUN_API_BASE", "https://dashscope.aliyuncs.com/compatible-mode/v1").strip()

    providers = [
        ("DeepSeek", ds_key, ds_base),
        ("Aliyun", ali_key, ali_base),
    ]

    if args.list_models:
        print("=== 列出可用模型 ===")
        for name, key, base in providers:
            list_models(name, key, base)
        return

    print("=== 模型 API 连通性测试 ===")
    if args.model:
        m = args.model.strip()
        # 自动选厂商：qwen/minimax/kimi/glm/zhipu 等 → 阿里；deepseek → 官方+阿里都试
        if "qwen" in m.lower() or any(k in m.lower() for k in ("minimax", "kimi", "glm", "zhipu", "stepfun")):
            test("Aliyun", ali_key, ali_base, m)
        elif "deepseek" in m.lower():
            test("DeepSeek 官方", ds_key, ds_base, m)
            test("Aliyun(托管)", ali_key, ali_base, m)
        else:
            test("DeepSeek 官方", ds_key, ds_base, m)
            test("Aliyun", ali_key, ali_base, m)
        print("=== 完成 ===")
        return

    cases = [
        ("DeepSeek 考生", ds_key, ds_base, os.getenv("DEEPSEEK_CHAT_MODEL", "deepseek-chat")),
        ("DeepSeek 裁判", ds_key, ds_base, "deepseek-reasoner"),
        ("Aliyun 考生", ali_key, ali_base, os.getenv("ALIYUN_MODEL", "qwen3.7-flash")),
    ]
    for name, key, base, model in cases:
        test(name, key, base, model)
    print("=== 完成 ===")


if __name__ == "__main__":
    main()
