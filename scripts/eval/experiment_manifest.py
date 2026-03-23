from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any, Dict, List


def load_manifest(path: Path) -> List[Dict[str, Any]]:
    items: List[Dict[str, Any]] = []
    if not path.exists():
        return items
    with path.open("r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            items.append(json.loads(line))
    return items


def main() -> None:
    parser = argparse.ArgumentParser(description="查看评测实验 manifest")
    parser.add_argument("--manifest", required=True, help="manifest jsonl 路径")
    parser.add_argument("--run-name", default="", help="按 run_name 过滤")
    parser.add_argument("--run-id", default="", help="按 run_id 过滤")
    parser.add_argument("--latest", action="store_true", help="仅输出匹配条件下最后一次记录")
    args = parser.parse_args()

    manifest_path = Path(args.manifest).resolve()
    rows = load_manifest(manifest_path)
    if args.run_name:
        rows = [r for r in rows if str(r.get("run_name", "")).strip() == args.run_name]
    if args.run_id:
        rows = [r for r in rows if str(r.get("run_id", "")).strip() == args.run_id]
    if args.latest and rows:
        rows = [rows[-1]]

    print(json.dumps(rows, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()

