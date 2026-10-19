"""生成数据存储 + 检索流程架构图 PNG（英文标注防字体问题）。

用法：
    python scripts/make_architecture_diagram.py [--out reports/architecture.png]
"""
import argparse
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import FancyBboxPatch, FancyArrowPatch


def _box(ax, x, y, w, h, text, fc, ec="black", fs=8.5, weight="normal"):
    ax.add_patch(FancyBboxPatch((x, y), w, h, boxstyle="round,pad=0.02", fc=fc, ec=ec, lw=1.0))
    ax.text(x + w / 2, y + h / 2, text, ha="center", va="center", fontsize=fs, weight=weight, wrap=True)


def main(out: Path) -> None:
    fig, ax = plt.subplots(figsize=(13, 9.5))
    ax.set_xlim(0, 13)
    ax.set_ylim(0, 9.5)
    ax.axis("off")

    # ── 检索流程（上半）──
    ax.text(6.5, 9.15, "Retrieval Pipeline (single request)", ha="center", fontsize=13, weight="bold")
    steps = [
        (0.3, 7.95, "HTTP\nPOST /api/chat"),
        (2.0, 7.95, "load_state\nConversationState"),
        (3.7, 7.95, "_is_followup\n(question)"),
        (5.4, 7.95, "Router\n_route_with_tools"),
        (7.4, 7.95, "Seeker\nmulti-channel"),
        (9.4, 7.95, "RRF fuse\n1/(60+rank)"),
        (11.2, 7.95, "Rerank\ncross_enc/llm"),
        (12.4, 7.95, "Synthesizer\nLLM answer"),
    ]
    for x, y, t in steps:
        _box(ax, x, y, 1.5, 0.85, t, "#eaf2f8")
    for i in range(len(steps) - 1):
        ax.add_patch(FancyArrowPatch((steps[i][0] + 1.5, steps[i][1] + 0.42), (steps[i + 1][0], steps[i + 1][1] + 0.42), arrowstyle="->", mutation_scale=12, color="gray"))

    # Seeker 通道（中）
    ax.text(6.5, 7.15, "Seeker channels (RRF weights)", ha="center", fontsize=10, weight="bold", color="#7b7b7b")
    channels = [
        (5.0, 6.25, "doc vector\n1.8"),
        (6.45, 6.25, "doc BM25\n1.0"),
        (7.9, 6.25, "note vector\n0.9"),
        (9.35, 6.25, "note BM25\n0.7"),
        (10.8, 6.25, "graph\n1/2-hop"),
    ]
    for x, y, t in channels:
        _box(ax, x, y, 1.35, 0.7, t, "#fef9e7", fs=7.5)
    ax.add_patch(FancyArrowPatch((6.15, 7.95), (5.7, 6.95), arrowstyle="->", mutation_scale=10, color="gray"))

    # ── 数据存储（下半）──
    ax.text(6.5, 5.55, "Data Storage Layers", ha="center", fontsize=13, weight="bold")

    # 磁盘（左）
    _box(ax, 0.4, 0.3, 5.8, 4.9, "", "#fdedec")
    ax.text(3.3, 4.95, "Disk (persistent)", ha="center", fontsize=11, weight="bold")
    disk_items = [
        "conversation_state_{sid}.json  (working memory)",
        "notes.json  (atomic notes)",
        "documents/documents.json + domains.json",
        "chroma_store/  (vector DB, sqlite)",
        "bm25_cache_{key}.pkl  (tokenized corpus)",
        "knowledge_graph_{key}.json  (networkx)",
        "parse_images/  (PDF images)",
        "arxiv_inbox.json + feedback_log.json",
    ]
    for i, t in enumerate(disk_items):
        ax.text(0.7, 4.65 - i * 0.55, "• " + t, fontsize=8.2, va="center")

    # 内存（右）
    _box(ax, 6.6, 0.3, 6.0, 4.9, "", "#eafaf1")
    ax.text(9.6, 4.95, "Memory (process cache)", ha="center", fontsize=11, weight="bold")
    mem_items = [
        "NoteRAG / DocumentRAG\n(ChromaDB client, per-session singleton)",
        "BM25Engine\n(jieba corpus + BM25Okapi)",
        "knowledge_graph_store\n(networkx graph)",
        "SessionDataStore\n(cloud multi-user, /tmp)",
    ]
    for i, t in enumerate(mem_items):
        ax.text(6.9, 4.35 - i * 1.1, t, fontsize=8.2, va="center")

    fig.tight_layout()
    out.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(out, dpi=150, bbox_inches="tight")
    plt.close(fig)
    print(f"[png] {out}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="reports/architecture.png")
    args = ap.parse_args()
    main(Path(args.out))
