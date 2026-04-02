#!/usr/bin/env python3
"""
用 DEEPSEEK_API_KEY 对 demo_markdown.md 分节并逐节生成 LLM 短摘要，
写回 demo_static_bundle.json 的 sections 与 demo_notes。

不导入 service.parser（避免拉取 httpx 等重依赖），分节逻辑与 regen_bundle_from_markdown 一致。

用法（在 aether_engine 目录下）:
  set DEEPSEEK_API_KEY=... && python tools/enrich_demo_bundle_llm.py
  python tools/enrich_demo_bundle_llm.py --allow-fallback   # 无 Key 时用首段英文 fallback
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import os
import sys
from pathlib import Path

_TOOLS = Path(__file__).resolve().parent
_ROOT = _TOOLS.parent
_spec = importlib.util.spec_from_file_location("_regen", _TOOLS / "regen_bundle_from_markdown.py")
_regen = importlib.util.module_from_spec(_spec)
assert _spec.loader is not None
_spec.loader.exec_module(_regen)
_split_sections = _regen._split_sections


def _llm_enhance_summary(title: str, content: str, fallback: str) -> str:
    api_key = os.getenv("DEEPSEEK_API_KEY", "").strip()
    api_base = os.getenv("DEEPSEEK_API_BASE", "https://api.deepseek.com")
    if not api_key:
        return fallback
    try:
        from openai import OpenAI

        client = OpenAI(api_key=api_key, base_url=api_base)
        resp = client.chat.completions.create(
            model=os.getenv("DEEPSEEK_CHAT_MODEL", "deepseek-chat"),
            messages=[
                {
                    "role": "system",
                    "content": "你是学术文献摘要助手，请输出一句简洁中文摘要（不超过70字）。",
                },
                {
                    "role": "user",
                    "content": f"章节标题: {title}\n\n章节内容:\n{content[:1200]}",
                },
            ],
            max_tokens=120,
            temperature=0.2,
        )
        ans = (resp.choices[0].message.content or "").strip()
        return ans or fallback
    except Exception as e:
        print(f"[warn] LLM 章节摘要失败，使用首段 fallback: {e}", file=sys.stderr)
        return fallback


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument(
        "--allow-fallback",
        action="store_true",
        help="未设置 DEEPSEEK_API_KEY 时仍写出文件（摘要为首段 fallback）",
    )
    args = ap.parse_args()

    if not (os.getenv("DEEPSEEK_API_KEY", "") or "").strip() and not args.allow_fallback:
        print(
            "错误: 未设置 DEEPSEEK_API_KEY。设置环境变量后重试，或加 --allow-fallback",
            file=sys.stderr,
        )
        sys.exit(1)

    demo_dir = _ROOT / "demo_data"
    md_path = demo_dir / "demo_markdown.md"
    out_path = demo_dir / "demo_static_bundle.json"

    md = md_path.read_text(encoding="utf-8")
    sections = _split_sections(md)

    existing: dict = {}
    if out_path.exists():
        existing = json.loads(out_path.read_text(encoding="utf-8"))

    doc_id = existing.get("doc_id", "global_demo_official")
    title = existing.get("title", "demo_paper.pdf")
    old_notes = existing.get("demo_notes") or []

    enriched = []
    for sec in sections:
        fb = sec["summary"]
        enhanced = _llm_enhance_summary(sec["title"], sec["content"], fb)
        enriched.append(
            {
                "title": sec["title"],
                "content": sec["content"],
                "summary": enhanced,
                "image_refs": sec.get("image_refs", []),
            }
        )

    demo_notes = []
    for i, sec in enumerate(enriched):
        note = {
            "id": f"demo_seed_{i}",
            "type": "idea",
            "content": sec["summary"],
            "keywords": [],
            "tags": [],
            "source": "demo_seed",
            "doc_id": doc_id,
            "page": 1,
            "bbox": [],
        }
        if i < len(old_notes):
            old = old_notes[i]
            note["page"] = old.get("page", note["page"])
            note["bbox"] = old.get("bbox", note["bbox"])
            if old.get("keywords") is not None:
                note["keywords"] = old["keywords"]
            if old.get("tags") is not None:
                note["tags"] = old["tags"]
        demo_notes.append(note)

    bundle = {
        "doc_id": doc_id,
        "title": title,
        "markdown": md,
        "sections": enriched,
        "demo_notes": demo_notes,
    }
    out_path.write_text(json.dumps(bundle, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {out_path} ({len(enriched)} sections)")


if __name__ == "__main__":
    main()
