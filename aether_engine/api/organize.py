"""
Organize 图谱/三元组 API
支持全局视角(global)与单文献视角(local)切换。
"""

import logging
import json
import re
import time
from collections import defaultdict
from typing import Dict, List, Optional, Set, Tuple

import networkx as nx
from fastapi import APIRouter, Header

from api.documents import IN_MODELSCOPE_SPACE, _load_meta as _load_documents_meta
from api.notes import _load_notes

router = APIRouter(prefix="/organize", tags=["organize"])
logger = logging.getLogger("aether")

GLOBAL_SCOPE_MARKERS = {"", "global", "__global__", "all", "*"}
GLOBAL_DEMO_DOC_ID = "global_demo_official"


def _debug_log(hid: str, location: str, message: str, data: Dict) -> None:
    try:
        with open("debug-360e80.log", "a", encoding="utf-8") as f:
            f.write(
                json.dumps(
                    {
                        "sessionId": "360e80",
                        "runId": "pre-fix",
                        "hypothesisId": hid,
                        "location": location,
                        "message": message,
                        "data": data,
                        "timestamp": int(time.time() * 1000),
                    },
                    ensure_ascii=False,
                )
                + "\n"
            )
    except Exception:
        pass


def _is_global_scope(doc_id: Optional[str]) -> bool:
    return (doc_id or "").strip().lower() in GLOBAL_SCOPE_MARKERS


def _norm_entity(v: str) -> str:
    v = (v or "").strip().lower()
    v = re.sub(r"\s+", " ", v)
    v = re.sub(r"[^\w\u4e00-\u9fff ]", "", v)
    return v


def _note_label(note: dict) -> str:
    return (note.get("axiom") or note.get("content") or note.get("id") or "note")[:48]


def _extract_entities(note: dict) -> List[str]:
    tags = note.get("tags") or note.get("keywords") or []
    entities: List[str] = []
    if isinstance(tags, list):
        entities.extend([str(t).strip() for t in tags if str(t).strip()])
    # 兜底：从 axiom/content 中提取首个词组
    if not entities:
        text = (note.get("axiom") or note.get("content") or "").strip()
        cands = re.findall(r"[A-Za-z][A-Za-z0-9_\-]{2,}|[\u4e00-\u9fff]{2,8}", text)
        entities.extend(cands[:3])
    return entities[:6]


def _extract_entities_from_text(text: str, limit: int = 4) -> List[str]:
    cands = re.findall(r"[A-Za-z][A-Za-z0-9_\-]{2,}|[\u4e00-\u9fff]{2,8}", text or "")
    uniq = []
    seen = set()
    for c in cands:
        k = _norm_entity(c)
        if not k or k in seen:
            continue
        seen.add(k)
        uniq.append(c)
        if len(uniq) >= limit:
            break
    return uniq


def _load_doc_chunks(session_id: Optional[str], scope_doc_id: Optional[str]) -> List[dict]:
    try:
        from service.doc_rag import get_document_rag
    except Exception:
        return []

    raws: List[dict] = []
    rag_ids = [session_id]
    # 全局视角时合并 global demo 索引
    if scope_doc_id is None:
        rag_ids.append(None)
    for sid in rag_ids:
        try:
            rag = get_document_rag(sid)
            if rag.collection.count() == 0:
                continue
            got = rag.collection.get(include=["documents", "metadatas"])
            ids = got.get("ids") or []
            docs = got.get("documents") or []
            metas = got.get("metadatas") or []
            for i, cid in enumerate(ids):
                md = metas[i] if i < len(metas) else {}
                doc_id = (md or {}).get("doc_id") or ""
                if scope_doc_id and doc_id != scope_doc_id:
                    continue
                raws.append(
                    {
                        "chunk_id": cid,
                        "content": docs[i] if i < len(docs) else "",
                        "doc_id": doc_id,
                        "doc_title": (md or {}).get("doc_title") or doc_id,
                        "section_title": (md or {}).get("section_title") or "section",
                        "chunk_index": int((md or {}).get("chunk_index") or 0),
                    }
                )
        except Exception:
            continue
    return raws


def _build_graph(
    notes: List[dict],
    docs_map: Dict[str, str],
    scope_doc_id: Optional[str],
    doc_chunks: List[dict],
) -> Tuple[nx.Graph, Dict[str, dict], List[dict]]:
    """
    返回:
      - 图对象
      - nodes 元数据映射
      - edges 元数据列表
    """
    g = nx.Graph()
    nodes: Dict[str, dict] = {}
    edges: List[dict] = []

    def add_node(node_id: str, payload: dict):
        if node_id not in nodes:
            nodes[node_id] = payload
            g.add_node(node_id)

    def add_edge(a: str, b: str, relation: str, source_doc: str):
        if not a or not b:
            return
        g.add_edge(a, b)
        edges.append(
            {
                "source": a,
                "target": b,
                "relation": relation,
                "source_doc_id": source_doc or "",
                "source_doc_title": docs_map.get(source_doc, source_doc or "未知文献"),
            }
        )

    # 文献节点 + 章节节点 + 章节实体（来自已解析文档切块）
    section_index_by_doc: Dict[str, List[dict]] = defaultdict(list)
    for c in doc_chunks:
        doc_id = (c.get("doc_id") or "").strip() or "unscoped"
        if scope_doc_id and doc_id != scope_doc_id:
            continue
        doc_title = c.get("doc_title") or docs_map.get(doc_id, doc_id)
        doc_node_id = f"doc::{doc_id}"
        add_node(
            doc_node_id,
            {
                "id": doc_node_id,
                "label": (doc_title or doc_id)[:48],
                "type": "document",
                "doc_id": doc_id,
                "doc_title": doc_title,
                "size": 13,
                "color": "#3b82f6",
            },
        )
        sec = (c.get("section_title") or "section").strip()[:48]
        sec_key = _norm_entity(sec) or f"sec_{c.get('chunk_index', 0)}"
        sec_node_id = f"section::{doc_id}::{sec_key}"
        add_node(
            sec_node_id,
            {
                "id": sec_node_id,
                "label": sec,
                "type": "section",
                "doc_id": doc_id,
                "doc_title": doc_title,
                "size": 9,
                "color": "#10b981",
            },
        )
        add_edge(doc_node_id, sec_node_id, "Contains", doc_id)
        section_index_by_doc[doc_id].append(
            {
                "sec_node_id": sec_node_id,
                "section_title": sec,
                "page_num": int(c.get("chunk_index", 0)) // 3 + 1,
            }
        )
        for entity_name in _extract_entities_from_text(c.get("content", ""), limit=3):
            key = _norm_entity(entity_name)
            if not key:
                continue
            entity_node_id = f"entity::{key}"
            add_node(
                entity_node_id,
                {
                    "id": entity_node_id,
                    "label": entity_name[:40],
                    "type": "entity",
                    "entity_key": key,
                    "size": 5,
                    "color": "#a855f7",
                },
            )
            add_edge(sec_node_id, entity_node_id, "Mentions", doc_id)

    # 文献节点 + 笔记节点 + 原子层 + 实体节点
    for n in notes:
        note_id = n.get("id") or ""
        if not note_id:
            continue
        doc_id = (n.get("doc_id") or "").strip()
        if not doc_id:
            doc_id = "unscoped"
        if scope_doc_id and doc_id != scope_doc_id:
            continue

        doc_title = docs_map.get(doc_id, doc_id if doc_id != "unscoped" else "未归档文献")
        doc_node_id = f"doc::{doc_id}"
        add_node(
            doc_node_id,
            {
                "id": doc_node_id,
                "label": doc_title[:48],
                "type": "document",
                "doc_id": doc_id,
                "doc_title": doc_title,
                "size": 13,
                "color": "#3b82f6",
            },
        )

        note_node_id = f"note::{note_id}"
        add_node(
            note_node_id,
            {
                "id": note_node_id,
                "label": _note_label(n),
                "type": "note",
                "note_id": note_id,
                "doc_id": doc_id,
                "doc_title": doc_title,
                "page_num": int(n.get("page") or 0),
                "bbox": n.get("bbox") or [],
                "size": 7,
                "color": "#059669" if (n.get("axiom") or n.get("method") or n.get("boundary")) else "#f59e0b",
            },
        )
        # 关键层级：section -> note（若无 section，则回退到 doc -> note）
        note_page = int(n.get("page") or 0)
        parent_section_id = ""
        sections = section_index_by_doc.get(doc_id) or []
        if sections:
            if note_page > 0:
                best = min(sections, key=lambda s: abs((s.get("page_num") or 1) - note_page))
                parent_section_id = best.get("sec_node_id", "")
            else:
                parent_section_id = sections[0].get("sec_node_id", "")
        if parent_section_id:
            add_edge(parent_section_id, note_node_id, "Contains", doc_id)
        else:
            add_edge(doc_node_id, note_node_id, "Contains", doc_id)

        # 原子层：note -> axiom/method/boundary；若无解构字段则用正文摘要作为「卡片要点」节点（与标签同级挂在 note 下）
        atom_nodes: List[str] = []
        for field in ("axiom", "method", "boundary"):
            txt = (n.get(field) or "").strip()
            if not txt:
                continue
            atom_node_id = f"atom::{note_id}::{field}"
            add_node(
                atom_node_id,
                {
                    "id": atom_node_id,
                    "label": txt[:48],
                    "type": "atomic_note",
                    "field": field,
                    "note_id": note_id,
                    "doc_id": doc_id,
                    "doc_title": doc_title,
                    "size": 6,
                    "color": "#059669",
                },
            )
            add_edge(note_node_id, atom_node_id, "Contains", doc_id)
            atom_nodes.append(atom_node_id)

        if not atom_nodes:
            core = (n.get("content") or "").strip()
            if len(core) > 8:
                atom_node_id = f"atom::{note_id}::core"
                add_node(
                    atom_node_id,
                    {
                        "id": atom_node_id,
                        "label": core[:48] + ("…" if len(core) > 48 else ""),
                        "type": "atomic_note",
                        "field": "core",
                        "note_id": note_id,
                        "doc_id": doc_id,
                        "doc_title": doc_title,
                        "size": 6,
                        "color": "#34d399",
                    },
                )
                add_edge(note_node_id, atom_node_id, "Contains", doc_id)
                atom_nodes.append(atom_node_id)

        # 显式标签（用户/模型打的 tags/keywords），与原子并列：note --Tagged--> tag::<key>
        tag_keys: Set[str] = set()
        tags_raw = n.get("tags") or n.get("keywords") or []
        if isinstance(tags_raw, list):
            for raw_tag in tags_raw[:10]:
                t = str(raw_tag).strip()
                if not t:
                    continue
                tk = _norm_entity(t) or re.sub(r"\s+", "_", t[:32])
                tag_keys.add(tk)
                tag_node_id = f"tag::{tk}"
                add_node(
                    tag_node_id,
                    {
                        "id": tag_node_id,
                        "label": t[:40],
                        "type": "tag",
                        "tag_key": tk,
                        "size": 5,
                        "color": "#fb923c",
                    },
                )
                add_edge(note_node_id, tag_node_id, "Tagged", doc_id)

        # 自动抽取的概念实体（跨笔记同名合并）；已作为显式标签的不再重复连边
        entity_parent = atom_nodes[0] if atom_nodes else note_node_id
        for entity_name in _extract_entities(n):
            key = _norm_entity(entity_name)
            if not key or key in tag_keys:
                continue
            entity_node_id = f"entity::{key}"
            add_node(
                entity_node_id,
                {
                    "id": entity_node_id,
                    "label": entity_name[:40],
                    "type": "entity",
                    "entity_key": key,
                    "size": 5,
                    "color": "#a855f7",
                },
            )
            add_edge(entity_parent, entity_node_id, "Mentions", doc_id)

    # 跨文档消歧：同名实体天然合并（entity::<normalized_name>）
    rel_counter: Dict[str, int] = defaultdict(int)
    for e in edges:
        rel_counter[e.get("relation", "unknown")] += 1
    _debug_log(
        "H3",
        "organize.py:_build_graph:result",
        "graph relation distribution",
        {
            "notes": len(notes),
            "doc_chunks": len(doc_chunks),
            "nodes": len(nodes),
            "edges": len(edges),
            "contains_edges": rel_counter.get("Contains", 0),
            "mentions_edges": rel_counter.get("Mentions", 0),
        },
    )
    return g, nodes, edges


def _trim_global_graph(
    g: nx.Graph, nodes: Dict[str, dict], edges: List[dict], top_n: int
) -> Tuple[Dict[str, dict], List[dict], dict]:
    if len(nodes) <= top_n:
        return nodes, edges, {"truncated": False, "message": ""}

    centrality = nx.degree_centrality(g) if g.number_of_nodes() > 1 else {}

    def _keep_boost(nid: str) -> float:
        t = (nodes.get(nid) or {}).get("type")
        if t == "atomic_note":
            return 0.22
        if t == "note":
            return 0.18
        if t == "tag":
            return 0.12
        if t == "section":
            return 0.08
        if t == "entity":
            return 0.05
        return 0.0

    ranked = sorted(
        nodes.keys(),
        key=lambda nid: centrality.get(nid, 0.0) + _keep_boost(nid),
        reverse=True,
    )
    keep = set(ranked[:top_n])

    # 尽量保留文献节点（若未入选则替换尾部）
    doc_nodes = [nid for nid, n in nodes.items() if n.get("type") == "document"]
    for dn in doc_nodes:
        if dn in keep:
            continue
        if len(keep) < top_n:
            keep.add(dn)
        else:
            # 替换最低权重的非文献节点
            tail = next((k for k in reversed(ranked) if k in keep and nodes[k].get("type") != "document"), None)
            if tail:
                keep.remove(tail)
                keep.add(dn)

    trimmed_nodes = {nid: n for nid, n in nodes.items() if nid in keep}
    trimmed_edges = [e for e in edges if e["source"] in keep and e["target"] in keep]
    meta = {
        "truncated": True,
        "message": f"全局图谱节点过多，已为您提取展示 Top-{top_n} 核心知识网络",
    }
    return trimmed_nodes, trimmed_edges, meta


@router.get("/graph")
def get_organize_graph(
    doc_id: str = "",
    top_n: int = 200,
    x_session_id: str = Header(default=""),
):
    session_id = x_session_id if IN_MODELSCOPE_SPACE else None
    is_global = _is_global_scope(doc_id)
    scope_doc_id = None if is_global else doc_id.strip()

    notes = _load_notes(session_id)
    docs = _load_documents_meta(session_id)
    docs_map = {d.get("id", ""): d.get("name", "") for d in docs}
    docs_map[GLOBAL_DEMO_DOC_ID] = "demo_paper.pdf"
    docs_map["unscoped"] = "未归档文献"

    doc_chunks = _load_doc_chunks(session_id, scope_doc_id)
    g, nodes, edges = _build_graph(notes, docs_map, scope_doc_id, doc_chunks)

    meta = {"truncated": False, "message": ""}
    if is_global:
        nodes, edges, meta = _trim_global_graph(g, nodes, edges, max(50, min(top_n, 500)))

    return {
        "scope": "global" if is_global else "local",
        "doc_id": scope_doc_id or "",
        "nodes": list(nodes.values()),
        "edges": edges,
        "total_nodes": len(nodes),
        "total_edges": len(edges),
        **meta,
    }


@router.get("/triples")
def get_organize_triples(
    doc_id: str = "",
    top_n: int = 200,
    x_session_id: str = Header(default=""),
):
    session_id = x_session_id if IN_MODELSCOPE_SPACE else None
    is_global = _is_global_scope(doc_id)
    scope_doc_id = None if is_global else doc_id.strip()

    notes = _load_notes(session_id)
    docs = _load_documents_meta(session_id)
    docs_map = {d.get("id", ""): d.get("name", "") for d in docs}
    docs_map[GLOBAL_DEMO_DOC_ID] = "demo_paper.pdf"
    docs_map["unscoped"] = "未归档文献"

    doc_chunks = _load_doc_chunks(session_id, scope_doc_id)
    g, nodes, edges = _build_graph(notes, docs_map, scope_doc_id, doc_chunks)
    if is_global:
        nodes, edges, _ = _trim_global_graph(g, nodes, edges, max(50, min(top_n, 500)))

    triples = []
    seen: Dict[Tuple[str, str, str], set] = defaultdict(set)
    for e in edges:
        s = nodes.get(e["source"], {})
        t = nodes.get(e["target"], {})
        triple_key = (s.get("label", e["source"]), e["relation"], t.get("label", e["target"]))
        seen[triple_key].add(
            (
                e.get("source_doc_title") or "未知文献",
                e.get("source_doc_id") or "",
            )
        )

    for (subject, predicate, obj), source_items in seen.items():
        source_titles = [x[0] for x in sorted(source_items)]
        source_doc_ids = [x[1] for x in sorted(source_items)]
        triples.append(
            {
                "subject": subject,
                "predicate": predicate,
                "object": obj,
                "source_documents": sorted(source_titles),
                "source_doc_ids": source_doc_ids,
            }
        )

    return {
        "scope": "global" if is_global else "local",
        "doc_id": scope_doc_id or "",
        "triples": triples,
        "total": len(triples),
        "show_source_column": is_global,
    }

