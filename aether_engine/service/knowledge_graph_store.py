"""
轻量知识图谱存储（per-session）。
用于把蒸馏后的 UGC 原子卡片落入图数据库（NetworkX）。
"""

import json
import logging
import os
from pathlib import Path
from typing import Dict, List, Optional

import networkx as nx

logger = logging.getLogger("aether")

IN_MODELSCOPE_SPACE = os.path.exists("/mnt/workspace")
_graphs: Dict[str, nx.DiGraph] = {}


def _graph_file(session_id: Optional[str]) -> Path:
    key = session_id or "default"
    if IN_MODELSCOPE_SPACE and session_id:
        from core.session_store import get_session_path, init_session

        init_session(session_id)
        return get_session_path(session_id, "knowledge_graph.json")
    root = Path("data")
    root.mkdir(parents=True, exist_ok=True)
    return root / f"knowledge_graph_{key}.json"


def _load_graph(session_id: Optional[str]) -> nx.DiGraph:
    key = session_id or "__default__"
    if key in _graphs:
        return _graphs[key]
    g = nx.DiGraph()
    f = _graph_file(session_id)
    if f.exists():
        try:
            data = json.loads(f.read_text(encoding="utf-8"))
            for node in data.get("nodes", []):
                nid = node.get("id")
                if nid:
                    g.add_node(nid, **{k: v for k, v in node.items() if k != "id"})
            for edge in data.get("edges", []):
                s = edge.get("source")
                t = edge.get("target")
                if s and t:
                    g.add_edge(s, t, **{k: v for k, v in edge.items() if k not in {"source", "target"}})
        except Exception as e:
            logger.warning("加载知识图谱失败: %s", e)
    _graphs[key] = g
    return g


def _save_graph(session_id: Optional[str], g: nx.DiGraph) -> None:
    f = _graph_file(session_id)
    payload = {
        "nodes": [{"id": n, **attrs} for n, attrs in g.nodes(data=True)],
        "edges": [{"source": u, "target": v, **attrs} for u, v, attrs in g.edges(data=True)],
    }
    f.parent.mkdir(parents=True, exist_ok=True)
    f.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def upsert_note_node(
    session_id: Optional[str],
    note_id: str,
    axiom: str,
    method: str,
    boundary: str,
    tags: List[str],
) -> None:
    """写入/更新 UGC 原子卡片节点，并按 tag 重叠自动建边。"""
    g = _load_graph(session_id)
    g.add_node(
        note_id,
        type="atomic_note",
        axiom=axiom,
        method=method,
        boundary=boundary,
        tags=tags or [],
        source="ugc_distill",
    )
    tag_set = set(tags or [])
    if tag_set:
        for other_id, attrs in list(g.nodes(data=True)):
            if other_id == note_id:
                continue
            other_tags = set(attrs.get("tags") or [])
            overlap = sorted(tag_set & other_tags)
            if overlap:
                g.add_edge(note_id, other_id, relation="Shares_Concept", tags=overlap[:6])
                g.add_edge(other_id, note_id, relation="Shares_Concept", tags=overlap[:6])
    _save_graph(session_id, g)


def get_graph(session_id: Optional[str]) -> nx.DiGraph:
    """返回会话图对象（只读使用方请勿就地修改）。"""
    return _load_graph(session_id)


def get_one_hop_triples(
    session_id: Optional[str],
    seed_note_ids: List[str],
    max_items: int = 12,
) -> List[dict]:
    """
    从图数据库中提取 seed notes 的 1-hop 三元组。
    返回格式：
    [{"subject","relation","object","tags","source_note_id","target_note_id"}]
    """
    g = _load_graph(session_id)
    if g.number_of_nodes() == 0 or not seed_note_ids:
        return []

    triples: List[dict] = []
    seen = set()
    for sid in seed_note_ids:
        if not g.has_node(sid):
            continue
        for tid in g.successors(sid):
            edge_data = g.get_edge_data(sid, tid) or {}
            relation = edge_data.get("relation", "related_to")
            key = (sid, relation, tid)
            if key in seen:
                continue
            seen.add(key)
            triples.append(
                {
                    "subject": sid,
                    "relation": relation,
                    "object": tid,
                    "tags": edge_data.get("tags", []),
                    "source_note_id": sid,
                    "target_note_id": tid,
                }
            )
            if len(triples) >= max_items:
                return triples
    return triples


def get_two_hop_triples(
    session_id: Optional[str],
    seed_note_ids: List[str],
    max_items: int = 8,
) -> List[dict]:
    """
    从 seed 的 1-hop 邻居再继续走一步，得到 2-hop 可达的边（用于 GraphRAG 扩展）。
    返回与 get_one_hop_triples 相同字段结构，relation 标记为便于区分的类型。
    """
    g = _load_graph(session_id)
    if g.number_of_nodes() == 0 or not seed_note_ids:
        return []

    triples: List[dict] = []
    seen = set()
    seed_set = {n for n in seed_note_ids if n}

    # 1-hop 邻居（不含 seed 自身）
    hop1: set = set()
    for sid in seed_note_ids:
        if not sid or not g.has_node(sid):
            continue
        hop1.update(g.successors(sid))
        hop1.update(g.predecessors(sid))
    hop1 -= seed_set

    # 从 1-hop 邻居再扩展
    for mid in hop1:
        if not g.has_node(mid):
            continue
        for tid in list(g.successors(mid)) + list(g.predecessors(mid)):
            if tid in seed_set or tid == mid:
                continue
            edge_data = g.get_edge_data(mid, tid) or g.get_edge_data(tid, mid) or {}
            relation = edge_data.get("relation", "related_to")
            key = (mid, relation, tid)
            if key in seen:
                continue
            seen.add(key)
            triples.append(
                {
                    "subject": mid,
                    "relation": f"2hop::{relation}",
                    "object": tid,
                    "tags": edge_data.get("tags", []),
                    "source_note_id": mid,
                    "target_note_id": tid,
                }
            )
            if len(triples) >= max_items:
                return triples
    return triples
