"""
知识库（KB）快照：导出 / 导入 data/ 目录，避免换机器 / 重新 clone 后重复上传建库。

data/ 里已持久化的内容：
  data/documents/          文献元数据 documents.json + PDF 原文
  data/notes*.json         笔记卡片
  data/knowledge_graph*.json  知识图谱
  data/chroma_store/       向量库（doc_chunks + notes 两个 collection）
  data/arxiv_inbox.json    收件箱
  data/bm25_cache_*.pkl    BM25 分词缓存（可选，缺失会自动重建）

用法：
  # 导出（打包成 zip）
  python scripts/snapshot_kb.py export --out kb_snapshot.zip

  # 导入（解压回 data/）
  python scripts/snapshot_kb.py import --src kb_snapshot.zip

说明：导入前会备份现有 data/ 下同名文件到 data/.bak_<timestamp>/（仅备份被覆盖的文件）。
"""

from __future__ import annotations

import argparse
import shutil
import sys
import zipfile
from datetime import datetime
from pathlib import Path

# 默认打包的子目录/文件（跳过瞬时/大体积非 KB 内容）
INCLUDE_PATTERNS = [
    "data/documents",
    "data/chroma_store",
    "data/notes.json",
    "data/notes_*.json",
    "data/knowledge_graph*.json",
    "data/arxiv_inbox.json",
    "data/bm25_cache_*.pkl",
]


def _repo_root() -> Path:
    return Path(__file__).resolve().parent.parent


def _iter_include_paths() -> list:
    root = _repo_root()
    out = []
    for pat in INCLUDE_PATTERNS:
        # 支持通配符
        if "*" in pat:
            out.extend(sorted(root.glob(pat)))
        else:
            p = root / pat
            if p.exists():
                out.append(p)
    return out


def do_export(out: Path) -> None:
    root = _repo_root()
    paths = _iter_include_paths()
    if not paths:
        print("[warn] 未找到可导出的 data/ 内容（知识库为空？）")
    out = out.resolve()
    out.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as zf:
        for p in paths:
            rel = p.relative_to(root)
            if p.is_dir():
                for f in sorted(p.rglob("*")):
                    if f.is_file():
                        zf.write(f, f.relative_to(root).as_posix())
            else:
                zf.write(p, rel.as_posix())
    size_mb = out.stat().st_size / 1024 / 1024
    print(f"[export] 已打包 {len(paths)} 项 → {out} ({size_mb:.1f} MB)")


def do_import(src: Path) -> None:
    root = _repo_root()
    src = src.resolve()
    if not src.exists():
        raise FileNotFoundError(f"快照不存在: {src}")

    ts = datetime.now().strftime("%Y%m%d%H%M%S")
    bak_dir = root / "data" / f".bak_{ts}"

    with zipfile.ZipFile(src, "r") as zf:
        names = zf.namelist()
        # 仅允许 data/ 前缀，防止 zip-slip
        for n in names:
            if not n.startswith("data/") or ".." in n:
                raise ValueError(f"快照含非法路径: {n}")
        for n in names:
            target = root / n
            if n.endswith("/"):
                continue
            if target.exists():
                # 备份被覆盖的文件
                rel = target.relative_to(root / "data")
                bak = bak_dir / rel
                bak.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(target, bak)
            target.parent.mkdir(parents=True, exist_ok=True)
            with zf.open(n) as zsrc, open(target, "wb") as dst:
                shutil.copyfileobj(zsrc, dst)
    if bak_dir.exists():
        print(f"[import] 已备份被覆盖文件到: {bak_dir}")
    print(f"[import] 已从 {src} 恢复知识库到 data/")


def main() -> None:
    parser = argparse.ArgumentParser(description="知识库快照导出/导入")
    sub = parser.add_subparsers(dest="cmd", required=True)
    e = sub.add_parser("export", help="导出 data/ 到 zip")
    e.add_argument("--out", default="kb_snapshot.zip", help="输出 zip 路径")
    i = sub.add_parser("import", help="从 zip 恢复 data/")
    i.add_argument("--src", required=True, help="输入 zip 路径")
    args = parser.parse_args()

    if args.cmd == "export":
        do_export(Path(args.out))
    elif args.cmd == "import":
        do_import(Path(args.src))
    else:
        parser.print_help()
        sys.exit(1)


if __name__ == "__main__":
    main()
