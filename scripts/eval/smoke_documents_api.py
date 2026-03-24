"""
文献列表烟测：
1) GET /api/documents 可访问
2) 返回 total 与 documents 数组长度一致
3) （可选）本地磁盘 documents.json 条目数与 API 条目数一致
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import requests


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--api-base", default="http://localhost:7860/api")
    parser.add_argument("--session-id", default="")
    parser.add_argument("--documents-json", default="data/documents/documents.json")
    parser.add_argument("--skip-disk-check", action="store_true")
    args = parser.parse_args()

    headers = {}
    if args.session_id:
        headers["X-Session-ID"] = args.session_id

    resp = requests.get(f"{args.api_base.rstrip('/')}/documents", headers=headers, timeout=20)
    resp.raise_for_status()
    data = resp.json()
    docs = data.get("documents") if isinstance(data.get("documents"), list) else []
    total = int(data.get("total") or 0)
    if total != len(docs):
        raise SystemExit(f"[FAIL] API total={total} but len(documents)={len(docs)}")

    if not args.skip_disk_check:
        p = Path(args.documents_json)
        if not p.exists():
            raise SystemExit(f"[FAIL] documents.json not found: {p}")
        disk = json.loads(p.read_text(encoding="utf-8"))
        if not isinstance(disk, list):
            raise SystemExit("[FAIL] documents.json is not a list")
        if len(disk) != len(docs):
            raise SystemExit(
                f"[FAIL] disk_count={len(disk)} != api_count={len(docs)} (path={p})"
            )

    print(f"[OK] documents api smoke passed: count={len(docs)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
