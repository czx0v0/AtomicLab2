#!/usr/bin/env python3
"""
从 demo_markdown.md 按 parser.py 中 _first_text_paragraph_summary / _split_sections
逻辑重新生成 demo_static_bundle.json（sections、markdown、demo_notes.content）。
无需 httpx 或网络依赖。
"""
from __future__ import annotations

import json
import re
from pathlib import Path

_SECTION_SUMMARY_MAX_CHARS = 8000


def _first_text_paragraph_summary(section_body: str) -> str:
    """
    取章节首节可见文字摘要：跳过段首空行与图片行，自第一条正文起收集至第一个空行；
    若正文中再遇图片行则结束（摘要仅保留连续文本块）。总长上限 _SECTION_SUMMARY_MAX_CHARS。
    """
    lines = section_body.splitlines()
    buf: list[str] = []
    started = False
    for line in lines:
        clean = line.strip()
        if not clean:
            if started:
                break
            continue
        if clean.startswith("!"):
            if started:
                break
            continue
        started = True
        buf.append(clean)
    text = "\n".join(buf).strip()
    if len(text) <= _SECTION_SUMMARY_MAX_CHARS:
        return text
    cut = text[: _SECTION_SUMMARY_MAX_CHARS]
    tail = cut[-200:]
    sp = tail.rfind(" ")
    if sp > 0:
        cut = cut[: len(cut) - len(tail) + sp].rstrip()
    return cut


def _split_sections(md: str) -> list:
    """将 Markdown 拆分为章节列表（与 modelspace-deploy/aether_engine/service/parser.py 一致）"""
    sections = []
    title = "Preamble"
    buf = []

    def flush():
        if not buf:
            return
        text = "\n".join(buf).strip()
        if not text:
            return
        summary = _first_text_paragraph_summary(text)
        image_refs = re.findall(r"!\[[^\]]*\]\(([^)]+)\)", text)
        sections.append(
            {
                "title": title,
                "content": text,
                "summary": summary,
                "image_refs": image_refs,
            }
        )

    for line in md.splitlines():
        m = re.match(r"^(#{1,6})\s+(.*)$", line)
        if m:
            flush()
            title = m.group(2).strip() or "Untitled"
            buf = []
        else:
            buf.append(line)
    flush()
    return sections


def main() -> None:
    root = Path(__file__).resolve().parent.parent
    demo_dir = root / "demo_data"
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

    demo_notes = []
    for i, sec in enumerate(sections):
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
        "sections": sections,
        "demo_notes": demo_notes,
    }
    out_path.write_text(json.dumps(bundle, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {out_path} ({len(sections)} sections)")


if __name__ == "__main__":
    main()
