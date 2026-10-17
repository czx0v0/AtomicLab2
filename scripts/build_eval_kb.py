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
  - 默认 --source global：从全局 data/chroma_store 复制 MinerU 高质量分块（推荐，与生产一致）。
  - 备选 --source pdf：用 pypdf 重新解析（低质量，仅调试用）。
  - 建库后，评测时用 --data-root data/eval_runtime/<type> 指向对应库。
"""

from __future__ import annotations

import argparse
import json
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


def _rechunk_overlong(ids, docs, metas, embs, chunk_size: int = 800, overlap: int = 0):
    """对超长 chunk 硬切（带 overlap）并重新 embed。生产旧切分未硬切超长段落，这里兜底。"""
    from service.embedding import get_embedding_function

    ef = get_embedding_function()
    step = max(1, chunk_size - overlap)
    new_ids, new_docs, new_metas, new_embs = [], [], [], []
    overlong = 0
    for cid, doc, meta, emb in zip(ids, docs, metas, embs):
        if len(doc) <= chunk_size:
            new_ids.append(cid)
            new_docs.append(doc)
            new_metas.append(meta)
            new_embs.append(emb)
        else:
            overlong += 1
            for j in range(0, len(doc), step):
                seg = doc[j : j + chunk_size].strip()
                if not seg:
                    continue
                new_ids.append(f"{cid}::o{j // step}")
                new_docs.append(seg)
                nm = dict(meta)
                nm["chunk_index"] = int(meta.get("chunk_index", 0)) * 10000 + (j // step)
                new_metas.append(nm)
                new_embs.append(ef([seg])[0])
    if overlong:
        print(f"  [rechunk] 硬切 {overlong} 条超长 chunk")
    return new_ids, new_docs, new_metas, new_embs


def build_from_global(type_name: str) -> int:
    """从全局 data/chroma_store 复制 MinerU 高质量分块（按 doc_id 匹配 eval_data 论文）。

    生产上传流程用 MinerU 解析，全局 chroma 里已有高质量分块；
    这里按论文文件名 → documents.json 的 doc_id → 全局 chroma 的 doc_id 筛选复制，
    避免用 pypdf 重抽导致的文本质量下降。
    """
    type_dir = EVAL_DATA_DIR / type_name
    if not type_dir.is_dir():
        raise SystemExit(f"数据集目录不存在: {type_dir}")
    runtime_dir = EVAL_RUNTIME_DIR / type_name
    global_chroma = REPO_ROOT / "data" / "chroma_store"

    # 供 _rechunk_overlong 的 embedding 函数使用
    if str(REPO_ROOT / "aether_engine") not in sys.path:
        sys.path.insert(0, str(REPO_ROOT / "aether_engine"))

    def _norm(s: str) -> str:
        return "".join(str(s).lower().split())  # 小写 + 去空格，容忍 "at Scale"/"atScale"

    # 1. eval_data PDF 名 → 用于按文件名匹配 chroma
    pdf_names = [p.name for p in sorted(type_dir.glob("*.pdf"))]

    # 2. 读全局 chroma doc_chunks（含 embeddings）
    import chromadb
    from chromadb.config import Settings as ChromaSettings

    src = chromadb.Client(ChromaSettings(persist_directory=str(global_chroma), is_persistent=True))
    src_coll = src.get_or_create_collection("doc_chunks", metadata={"hnsw:space": "cosine"})
    raw = src_coll.get(include=["documents", "metadatas", "embeddings"])

    # 3. 按文件名匹配：doc_title 或 doc_id 去掉 "doc_" 前缀，规范化后与 eval_data 文件名比
    ids_raw = raw.get("ids") or []
    metas_raw = raw.get("metadatas")
    docs_raw = raw.get("documents")
    embs_raw = raw.get("embeddings")  # 可能是 numpy 数组，不能用 or 判断
    metas_raw = metas_raw if metas_raw is not None else [{}] * len(ids_raw)
    docs_raw = docs_raw if docs_raw is not None else [""] * len(ids_raw)

    sel_ids, sel_docs, sel_metas, sel_embs = [], [], [], []
    matched: dict = {p: 0 for p in pdf_names}
    for i, cid in enumerate(ids_raw):
        md = metas_raw[i] or {}
        title = str(md.get("doc_title") or "")
        did = str(md.get("doc_id") or "")
        did_name = did[len("doc_"):] if did.startswith("doc_") else did
        cand = _norm(title) or _norm(did_name)
        # 找到对应 eval_data 文件名
        for pdf in pdf_names:
            if cand == _norm(pdf):
                matched[pdf] += 1
                emb = embs_raw[i] if embs_raw is not None else None
                if emb is None:
                    break
                sel_ids.append(cid)
                sel_docs.append(docs_raw[i])
                sel_metas.append(md)
                sel_embs.append(emb)
                break

    if not sel_ids:
        existing_titles = sorted({str(m.get("doc_title", "")) for m in metas_raw if m})[:30]
        existing_ids = sorted({str(m.get("doc_id", "")) for m in metas_raw if m})[:30]
        print(f"[build] ✗ '{type_name}' 按文件名匹配后无对应分块。诊断：")
        print(f"  全局 chroma 分块总数: {len(ids_raw)}")
        print(f"  目标论文文件名: {pdf_names}")
        print(f"  全局 chroma 实际 doc_id（前30）: {existing_ids}")
        print(f"  全局 chroma 实际 doc_title（前30）: {existing_titles}")
        return 0

    # 3.5 超长 chunk 硬切 + 重新 embed（生产旧切分未硬切超长段落）
    chunk_size = int(os.getenv("RAG_CHUNK_SIZE", "800") or 800)
    overlap = int(os.getenv("RAG_CHUNK_OVERLAP", "0") or 0)
    sel_ids, sel_docs, sel_metas, sel_embs = _rechunk_overlong(
        sel_ids, sel_docs, sel_metas, sel_embs, chunk_size=chunk_size, overlap=overlap
    )

    # 4. 写目标库（清空重建）
    runtime_dir.parent.mkdir(parents=True, exist_ok=True)
    if runtime_dir.exists():
        shutil.rmtree(runtime_dir)
    runtime_dir.mkdir(parents=True, exist_ok=True)
    tgt = chromadb.Client(ChromaSettings(persist_directory=str(runtime_dir / "chroma_store"), is_persistent=True))
    tgt_coll = tgt.get_or_create_collection("doc_chunks", metadata={"hnsw:space": "cosine"})
    tgt_coll.add(ids=sel_ids, documents=sel_docs, metadatas=sel_metas, embeddings=sel_embs)

    print(f"[build] '{type_name}' 已从全局 chroma 复制 {len(sel_ids)} 条 MinerU 分块 → {runtime_dir}")
    for pdf, n in matched.items():
        print(f"  {pdf} -> {n} 条分块")

    # 校验：目标论文是否都匹配到分块
    missing = [p for p, n in matched.items() if n == 0]
    if missing:
        print(f"  [warn] 以下论文在全局 chroma 无分块（可能未解析/索引）: {missing}")
    return len(sel_ids)


def check_one(type_name: str) -> bool:
    """建库自检：读 chroma，报告分块总数 + 去重后的文档数（论文数）。"""
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
        coll = client.get_or_create_collection("doc_chunks")
        n = coll.count()
        # 统计去重后的 doc_id 数（= 论文数），用于判断是否所有论文都进了库
        raw = coll.get(include=["metadatas"])
        doc_ids = {str(m.get("doc_id", "")) for m in (raw.get("metadatas") or []) if m}
        print(f"[check] ✓ '{type_name}' 已就绪: doc_chunks={n}, 文档数={len(doc_ids)}")
        return n > 0
    except Exception as e:
        print(f"[check] ✓ '{type_name}' 库文件存在（计数读取失败: {e}）")
        return True


def main() -> None:
    parser = argparse.ArgumentParser(description="构建干净隔离的评测知识库")
    parser.add_argument("--type", default="", help="仅处理指定类型（空=全部）")
    parser.add_argument(
        "--source",
        choices=["global", "pdf"],
        default="global",
        help="数据来源：global=从全局 chroma 复制 MinerU 分块（默认，推荐）；pdf=用 pypdf 重新解析",
    )
    parser.add_argument("--list", action="store_true", help="列出可用评测数据集")
    parser.add_argument("--check", default="", help="仅做建库自检：--check <type>（或 --check all）")
    args = parser.parse_args()

    def _build_one(t: str) -> int:
        return build_from_global(t) if args.source == "global" else build_one(t)

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
        _build_one(args.type)
        check_one(args.type)
        return

    # ── 构建所有类型：每个类型独立子进程（隔离 DATA_DIR 与检索单例）──────────
    if not types:
        raise SystemExit("data/eval_data 为空，无可构建数据集")
    for t in types:
        cmd = [sys.executable, str(Path(__file__).resolve()), "--type", t, "--source", args.source]
        print(f"\n[build] 开始构建 '{t}'（子进程，报错会显示在下方）…")
        r = subprocess.run(cmd)
        if r.returncode != 0:
            print(f"[build] ✗ '{t}' 构建失败（exit {r.returncode}）。"
                  f"可直接运行 `python scripts/build_eval_kb.py --type {t}` 查看完整报错。")
            sys.exit(r.returncode)
        check_one(t)


if __name__ == "__main__":
    main()
