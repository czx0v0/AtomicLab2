"""

从 demo_data/demo_markdown.md、data/demo_cache.json，或 demo_paper.pdf（MinerU 一次性解析）

生成 demo_static_bundle.json（与运行时静态 bundle 结构一致）。



用法（在 aether_engine 目录下，已配置 PYTHONPATH 时）:

  python tools/export_demo_static.py

  python tools/export_demo_static.py --from-cache

  python tools/export_demo_static.py --from-pdf

"""

from __future__ import annotations


import argparse

import asyncio

import json
import os

import sys

from pathlib import Path

from typing import Optional, Tuple


_ENGINE_ROOT = Path(__file__).resolve().parent.parent

_MS_ROOT = _ENGINE_ROOT.parent

if str(_ENGINE_ROOT) not in sys.path:

    sys.path.insert(0, str(_ENGINE_ROOT))


DEMO_DIR = _ENGINE_ROOT / "demo_data"

DEMO_PDF = (DEMO_DIR / "demo_paper.pdf").resolve()

PUBLIC_DEMO_PDF = (_MS_ROOT / "public" / "demo_paper.pdf").resolve()

DEMO_DOC_ID = "global_demo_official"


def _find_demo_pdf() -> Optional[Path]:
    """与 api/demo._find_demo_pdf 相同候选顺序，便于本地导出与线上一致。"""

    candidates = [
        PUBLIC_DEMO_PDF,
        Path.cwd() / "public" / "demo_paper.pdf",
        DEMO_PDF,
        Path.cwd() / "demo_data" / "demo_paper.pdf",
        Path.cwd() / "Aether-Engine" / "demo_data" / "demo_paper.pdf",
        _ENGINE_ROOT / "demo_data" / "demo_paper.pdf",
    ]

    for p in candidates:

        try:

            if p.resolve().exists():

                return p.resolve()

        except (OSError, RuntimeError):

            continue

    return None


def _build_demo_notes(markdown: str, sections: list) -> list:

    notes = []

    for idx, sec in enumerate((sections or [])[:8]):

        text = (sec.get("summary") or sec.get("content") or "").strip()

        if not text:

            continue

        notes.append(
            {
                "id": f"demo_seed_{idx}",
                "type": "idea",
                "content": text[:240],
                "keywords": [],
                "tags": [],
                "source": "demo_seed",
                "doc_id": DEMO_DOC_ID,
                "page": int(idx / 2) + 1,
                "bbox": [],
            }
        )

    return notes


def _validate_export_payload(md: str, sections: list, source: str) -> None:
    if not (md or "").strip():
        raise RuntimeError(f"{source} 数据无效：markdown 为空")
    if not isinstance(sections, list) or not sections:
        raise RuntimeError(f"{source} 数据无效：sections 为空或格式错误")


async def _parse_pdf_to_markdown_and_sections(path: Path) -> Tuple[str, list]:

    from service.parser import parse_pdf_with_mineru, _split_sections

    content = path.read_bytes()

    markdown = ""

    error_messages: list[str] = []

    async for raw in parse_pdf_with_mineru(content, path.name, method="auto"):

        if not raw.startswith("data: "):

            continue

        try:

            payload = json.loads(raw[6:].strip())

        except Exception:

            continue

        status = payload.get("status")

        if status == "success":

            markdown = payload.get("markdown", "") or ""

        elif status == "error":

            msg = (payload.get("message") or "").strip()

            if msg:

                error_messages.append(msg)

    if not markdown.strip():

        if error_messages:

            detail = "；".join(dict.fromkeys(error_messages))

            raise RuntimeError(f"MinerU 解析失败：{detail}")

        raise RuntimeError(
            "MinerU 解析失败：未生成 markdown（无 error 事件；请检查 MINERU 环境与 PDF）"
        )

    sections = _split_sections(markdown)

    return markdown, sections


def _write_bundle(
    demo_dir: Path, md: str, sections: list, demo_notes: list, source: str
) -> None:

    bundle = {
        "doc_id": DEMO_DOC_ID,
        "title": "demo_paper.pdf",
        "markdown": md,
        "sections": sections,
        "demo_notes": demo_notes,
    }

    out = demo_dir / "demo_static_bundle.json"
    md_out = demo_dir / "demo_markdown.md"
    sections_out = demo_dir / "sections_demo.json"
    notes_out = demo_dir / "notes_demo.json"

    out.write_text(json.dumps(bundle, ensure_ascii=False, indent=2), encoding="utf-8")

    md_out.write_text(md, encoding="utf-8")
    sections_out.write_text(
        json.dumps({"doc_name": "demo_paper.pdf", "sections": sections}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    notes_out.write_text(json.dumps(demo_notes, ensure_ascii=False, indent=2), encoding="utf-8")

    print(
        f"[OK] source={source} sections={len(sections)} notes={len(demo_notes)} "
        f"bundle={out} markdown={md_out} sections_demo={sections_out} notes_demo={notes_out}"
    )


def main() -> None:

    parser = argparse.ArgumentParser(description="导出 demo 静态 bundle")

    src = parser.add_mutually_exclusive_group()

    src.add_argument(
        "--from-cache",
        action="store_true",
        help="从 aether_engine/data/demo_cache.json 读取（需本地曾跑过解析）",
    )

    src.add_argument(
        "--from-pdf",
        action="store_true",
        help="对 demo_paper.pdf 运行 MinerU 一次，生成与 PDF 一致的 markdown/sections",
    )

    parser.add_argument(
        "--parse-timeout",
        type=int,
        default=900,
        help="MinerU 本地 CLI 超时秒数（通过 MINERU_PARSE_TIMEOUT 传递，默认 900）",
    )

    args = parser.parse_args()

    demo_dir = DEMO_DIR

    demo_dir.mkdir(parents=True, exist_ok=True)

    if args.from_cache:

        cache_path = _ENGINE_ROOT / "data" / "demo_cache.json"

        if not cache_path.exists():

            print(
                f"缺少 {cache_path}，请去掉 --from-cache 或先运行 MinerU 生成缓存",
                file=sys.stderr,
            )

            sys.exit(1)

        print(f"[INFO] source=cache path={cache_path}")
        raw = json.loads(cache_path.read_text(encoding="utf-8"))

        md = raw.get("markdown") or ""

        sections = raw.get("sections") or []
        _validate_export_payload(md, sections, "cache")

        demo_notes = raw.get("demo_notes") or _build_demo_notes(md, sections)
        if not isinstance(demo_notes, list):
            raise RuntimeError("cache 数据无效：demo_notes 必须为 list")

        _write_bundle(demo_dir, md, sections, demo_notes, "cache")

        return

    if args.from_pdf:
        os.environ["MINERU_PARSE_TIMEOUT"] = str(max(60, int(args.parse_timeout)))

        pdf = _find_demo_pdf()

        if not pdf:

            print(
                "未找到 demo_paper.pdf。请将文件放入 aether_engine/demo_data/ 或 modelspace-deploy/public/。",
                file=sys.stderr,
            )

            sys.exit(1)

        print(f"[INFO] source=pdf path={pdf}", file=sys.stderr)
        print(f"解析 PDF: {pdf}（耗时取决于 MinerU）…", file=sys.stderr)

        try:

            md, sections = asyncio.run(_parse_pdf_to_markdown_and_sections(pdf))

        except RuntimeError as e:

            print(str(e), file=sys.stderr)

            sys.exit(1)

        _validate_export_payload(md, sections, "pdf")
        demo_notes = _build_demo_notes(md, sections)

        _write_bundle(demo_dir, md, sections, demo_notes, "pdf")

        return

    print(
        "默认模式已禁用，避免手写 markdown 导致假数据回流。"
        "请使用 --from-pdf（推荐）或 --from-cache。",
        file=sys.stderr,
    )
    print("示例：python tools/export_demo_static.py --from-pdf", file=sys.stderr)
    sys.exit(1)


if __name__ == "__main__":

    main()
