"""清理本地文献库的历史重复文档。

按 PDF 文件内容 SHA256 去重（保留最早一条，删除重复条目 + 对应 PDF 文件）。
先 --dry-run 预览，确认无误后再实际删除。

用法：
    python scripts/cleanup_duplicate_docs.py --dry-run          # 只报告不删除
    python scripts/cleanup_duplicate_docs.py                    # 实际删除（自动备份）
    python scripts/cleanup_duplicate_docs.py --data-root data   # 指定数据根
"""
import argparse
import hashlib
import json
import shutil
from pathlib import Path


def _hash_file(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


def _find_pdf(doc_root: Path, item: dict) -> Path | None:
    """定位文档 PDF（新命名 {ts}_{id}.pdf 或 legacy {id}.pdf）。"""
    for name in (item.get("stored_filename", ""), f"{item.get('id', '')}.pdf"):
        if name:
            p = doc_root / name
            if p.exists():
                return p
    return None


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data-root", default="data")
    ap.add_argument("--dry-run", action="store_true", help="只报告不删除")
    args = ap.parse_args()

    doc_root = Path(args.data_root) / "documents"
    meta_file = doc_root / "documents.json"
    if not meta_file.exists():
        print(f"无 {meta_file}，跳过")
        return

    items = json.loads(meta_file.read_text(encoding="utf-8"))
    print(f"共 {len(items)} 条文献记录")

    seen_id: set[str] = set()
    seen_hash: dict[str, dict] = {}
    duplicates: list[dict] = []
    skipped: list[dict] = []

    for item in items:
        doc_id = item.get("id", "")
        # ① id 重复（元数据重复）
        if doc_id in seen_id:
            duplicates.append(item)
            continue
        seen_id.add(doc_id)

        # ② 内容哈希去重
        h = item.get("content_hash") or ""
        if not h:
            pdf = _find_pdf(doc_root, item)
            if pdf:
                h = _hash_file(pdf)
            else:
                skipped.append(item)
                continue
        if h in seen_hash:
            duplicates.append(item)
        else:
            seen_hash[h] = item

    print(f"发现 {len(duplicates)} 条重复" + (f"（另有 {len(skipped)} 条找不到 PDF，跳过）" if skipped else ""))

    if args.dry_run:
        for d in duplicates:
            print(f"  [dry-run] 将删除 id={d.get('id')} name={d.get('name')}")
        return

    if not duplicates:
        print("无重复，无需清理")
        return

    # 备份 documents.json
    backup = meta_file.with_suffix(".json.bak")
    shutil.copy(meta_file, backup)
    print(f"已备份 {backup}")

    # 删除重复条目 + PDF
    dup_ids = {d.get("id") for d in duplicates}
    keep = [x for x in items if x.get("id") not in dup_ids]
    for d in duplicates:
        pdf = _find_pdf(doc_root, d)
        if pdf:
            pdf.unlink()
            print(f"  删除 PDF {pdf.name}")

    meta_file.write_text(json.dumps(keep, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"清理完成：{len(items)} → {len(keep)} 条")


if __name__ == "__main__":
    main()
