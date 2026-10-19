"""Markdown 切分单一事实来源。

parser（章节切分 + 摘要）与 doc_rag（检索切块 + 超长硬切）共用同一套
「按 # 标题分块」逻辑，避免 `#{1,6}` 标题匹配散落多处导致漂移。
"""
import re
from typing import Iterator, List, Tuple

_HEADING_RE = re.compile(r"^(#{1,6})\s+(.*)$")


def iter_markdown_blocks(md: str) -> Iterator[Tuple[str, List[str]]]:
    """按 # 标题切块，yield (title, lines)。共享 parser 与 doc_rag 的标题匹配。"""
    title = "Preamble"
    buf: List[str] = []
    for line in md.splitlines():
        m = _HEADING_RE.match(line)
        if m:
            if buf:
                yield title, buf
            title = m.group(2).strip() or "Untitled"
            buf = []
        else:
            buf.append(line)
    if buf:
        yield title, buf
