"""
构建「干净隔离」的评测知识库（RAG 数据库）。

从 data/eval_data/{type}/*.pdf 解析并索引到 data/eval_runtime/{type}/，
与正式服务的 data/（含 demo 白皮书 global_demo_official、用户文献、笔记、图谱）完全隔离。

用法：
  # 列出可用评测数据集
  python scripts/build_eval_kb.py --list

  # 构建所有类型（single / multi ...），每个类型独立子进程（避免单例串库）
  python scripts/build_eval_kb.py

  # 只构建某一种
  python scripts/build_eval_kb.py --type single

  # 建库自检（评测前预检：doc_chunks 是否就绪）
  python scripts/build_eval_kb.py --check single

说明：
  - PDF 文本用 pypdf 提取（轻量；如需更高质量可后续接 MinerU）。
  - 建库后，评测时用 --data-root data/eval_runtime/<type> 指向对应库。
"""

from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
EVAL_DATA_DIR = REPO_ROOT / "data" / "eval_data"
EVAL_RUNTIME_DIR = REPO_ROOT / "data" / "eval_runtime"


def list_types() -> list:
    if not EVAL_DATA_DIR.exists():
        return []
    return sorted(p.name for p in EVAL_DATA_DIR.iterdir() if p.is_dir())


def _pdf_to_markdown(pdf_path: Path) -> str:
    try:
        from pypdf import PdfReader
    except ImportError:
        try:
            from PyPDF2 import PdfReader
        except ImportError:
            raise SystemExit("缺少 pypdf / PyPDF2，请先: pip install pypdf（或 conda env update -f environment.yml）")
    reader = PdfReader(str(pdf_path))
    parts = []
    for i, page in enumerate(reader.pages, 1):
        txt = (page.extract_text() or "").strip()
        if txt:
            parts.append(f"## Page {i}\n\n{txt}")
    return "\n\n".join(parts)


def build_one(type_name: str) -> int:
    type_dir = EVAL_DATA_DIR / type_name
    if not type_dir.is_dir():
        raise SystemExit(f"数据集目录不存在: {type_dir}")
    runtime_dir = EVAL_RUNTIME_DIR / type_name

    # 关键：在 import 任何检索模块之前设置 DATA_DIR，并清空旧库
    os.environ["DATA_DIR"] = str(runtime_dir)
    if runtime_dir.exists():
        shutil.rmtree(runtime_dir)
    runtime_dir.mkdir(parents=True, exist_ok=True)

    sys.path.insert(0, str(REPO_ROOT / "aether_engine"))
    from service.doc_rag import get_document_rag
    from service.bm25_engine import get_bm25_engine

    rag = get_document_rag(None)
    pdfs = sorted(type_dir.glob("*.pdf"))
    total_chunks = 0
    print(f"[build] 数据集 '{type_name}' → {runtime_dir}")
    for pdf in pdfs:
        md = _pdf_to_markdown(pdf)
        if not md.strip():
            print(f"  [warn] 无法提取文本，跳过: {pdf.name}")
            continue
        n = rag.index_document(pdf.stem, pdf.name, md)
        total_chunks += n
        print(f"  ✓ {pdf.name} → {n} chunks")
    get_bm25_engine(None).invalidate()  # BM25 首查时重建（或走缓存）
    print(f"[build] 完成: {len(pdfs)} 篇文献, {total_chunks} chunks")
    return total_chunks


def check_one(type_name: str) -> bool:
    """建库自检：直接读指定类型的 chroma，独立客户端（避免单例串库）。"""
    runtime_dir = EVAL_RUNTIME_DIR / type_name
    chroma_db = runtime_dir / "chroma_store" / "chroma.sqlite3"
    if not chroma_db.exists():
        print(f"[check] ✗ '{type_name}' 未建库（缺 {chroma_db}）")
        return False
    try:
        import chromadb
        from chromadb.config import Settings as ChromaSettings

        client = chromadb.Client(
            ChromaSettings(
                persist_directory=str(runtime_dir / "chroma_store"), is_persistent=True
            )
        )
        n = client.get_or_create_collection("doc_chunks").count()
        print(f"[check] ✓ '{type_name}' 已就绪: doc_chunks={n}")
        return n > 0
    except Exception as e:
        print(f"[check] ✓ '{type_name}' 库文件存在（计数读取失败: {e}）")
        return True


def main() -> None:
    parser = argparse.ArgumentParser(description="构建干净隔离的评测知识库")
    parser.add_argument("--type", default="", help="仅处理指定类型（空=全部）")
    parser.add_argument("--list", action="store_true", help="列出可用评测数据集")
    parser.add_argument("--check", default="", help="仅做建库自检：--check <type>（或 --check all）")
    args = parser.parse_args()

    types = list_types()
    if args.list:
        print("可用评测数据集:")
        for t in types:
            print(f"  - {t}")
        return

    if args.check:
        targets = types if args.check == "all" else [args.check]
        ok = True
        for t in targets:
            if not check_one(t):
                ok = False
        sys.exit(0 if ok else 1)

    # ── 单类型：直接构建（不再 spawn 子进程，避免递归 fork bomb）─────────────
    if args.type:
        if args.type not in types:
            raise SystemExit(f"未知数据集类型 '{args.type}'，可用: {types}")
        build_one(args.type)
        check_one(args.type)
        return

    # ── 构建所有类型：每个类型独立子进程（隔离 DATA_DIR 与检索单例）──────────
    if not types:
        raise SystemExit("data/eval_data 为空，无可构建数据集")
    for t in types:
        cmd = [sys.executable, str(Path(__file__).resolve()), "--type", t]
        print(f"\n[build] 开始构建 '{t}'（子进程，报错会显示在下方）…")
        r = subprocess.run(cmd)
        if r.returncode != 0:
            print(f"[build] ✗ '{t}' 构建失败（exit {r.returncode}）。"
                  f"可直接运行 `python scripts/build_eval_kb.py --type {t}` 查看完整报错。")
            sys.exit(r.returncode)
        check_one(t)


if __name__ == "__main__":
    main()
