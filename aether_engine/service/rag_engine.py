import json
import logging
from typing import List, Dict, Set, Any
from collections import defaultdict

import chromadb
from chromadb.config import Settings
import networkx as nx

from core.models import Document, Section, AtomicNote

logger = logging.getLogger(__name__)


class AtomicRAG:
    def __init__(self, persist_directory: str = "data/rag_store"):
        # Initialize ChromaDB
        self.chroma_client = chromadb.Client(
            Settings(persist_directory=persist_directory, is_persistent=True)
        )

        # Use get_or_create_collection to avoid errors on restart
        self.collection = self.chroma_client.get_or_create_collection(
            name="atomic_notes"
        )

        # Initialize NetworkX Graph (In-memory for now)
        # Nodes: AtomicNote IDs, Document IDs
        # Edges: ("Cites", "Shares_Concept", "Part_Of", "Contains")
        self.graph = nx.DiGraph()

        # In-memory storage for full objects (since Chroma/Graph store limited data)
        self.note_store: Dict[str, AtomicNote] = {}
        self.doc_store: Dict[str, Document] = {}

        # Keyword index for fast "Shares_Concept" edge creation
        self.keyword_index = defaultdict(list)  # keyword -> list of note_ids

    def ingest_document(self, document: Document):
        """
        Ingests a document into the RAG system:
        1. Stores document and notes in memory.
        2. Adds notes to ChromaDB.
        3. Builds Knowledge Graph edges.
        """
        # Store document
        self.doc_store[document.doc_id] = document
        self.graph.add_node(document.doc_id, type="document", title=document.title)

        # Add edges for document references
        # Ensure referenced documents exist as nodes (even if placeholders)
        for ref_id in document.references:
            if not self.graph.has_node(ref_id):
                self.graph.add_node(ref_id, type="document", title="Unknown/External")
            self.graph.add_edge(document.doc_id, ref_id, relation="Cites")

        # Process sections and notes
        for section in document.sections:
            for note in section.atomic_notes:
                self._process_atomic_note(note, document)

        logger.info(
            f"Ingested document: {document.doc_id} with {len(document.sections)} sections."
        )

    def _process_atomic_note(self, note: AtomicNote, document: Document):
        """
        Helper to process a single atomic note.
        """
        if note.id in self.note_store:
            return

        self.note_store[note.id] = note

        # Add to ChromaDB
        # Flatten bbox and other metadata
        bbox_str = json.dumps(note.annotations[0].bbox) if note.annotations else "[]"
        page_num = note.annotations[0].page_num if note.annotations else 0

        self.collection.add(
            documents=[note.summary],
            metadatas=[
                {
                    "doc_id": document.doc_id,
                    "page_num": int(page_num),
                    "bbox": bbox_str,
                    "citation": document.bibtex_citation,
                    "type": "atomic_note",
                }
            ],
            ids=[note.id],
        )

        # Add node to Graph
        self.graph.add_node(note.id, type="atomic_note", concept=note.concept_title)

        # Edge 1: Part_Of / Contains (Note <-> Document)
        self.graph.add_edge(note.id, document.doc_id, relation="Part_Of")
        self.graph.add_edge(document.doc_id, note.id, relation="Contains")

        # Edge 2: Shares_Concept (Note <-> Note)
        for keyword in note.keywords:
            if not keyword:
                continue
            for other_note_id in self.keyword_index[keyword]:
                if other_note_id != note.id:
                    # Check edge existence strictly or rely on multi-graph/update
                    if not self.graph.has_edge(note.id, other_note_id):
                        self.graph.add_edge(
                            note.id,
                            other_note_id,
                            relation="Shares_Concept",
                            keyword=keyword,
                        )
                        self.graph.add_edge(
                            other_note_id,
                            note.id,
                            relation="Shares_Concept",
                            keyword=keyword,
                        )
            self.keyword_index[keyword].append(note.id)

        # Edge 3: Citation Edge (Note -> Referenced Document)
        # Allows 1-hop traversal from Note to the Document it cites
        for ref_doc_id in document.references:
            # We add an edge from Note to the Referenced Document
            # This enables "Expand 1 hop" to reach the cited document
            self.graph.add_edge(note.id, ref_doc_id, relation="Cites")

    def query_with_citations(self, query: str, top_k: int = 5) -> List[Dict[str, Any]]:
        """
        Retrieves atomic notes based on vector similarity + 1-hop graph expansion.
        Returns a list of dicts with note content and citation info.
        """
        # 1. Vector Search
        results = self.collection.query(query_texts=[query], n_results=top_k)

        if not results["ids"] or not results["ids"][0]:
            return []

        retrieved_ids = results["ids"][0]
        expanded_notes = []
        visited_ids = set()

        # Helper method for formatting result
        def format_note(nid):
            if nid not in self.note_store:
                return None
            note = self.note_store[nid]

            # Find parent doc using graph
            doc_id = None
            try:
                for succ in self.graph.successors(nid):
                    if self.graph.edges[nid, succ].get("relation") == "Part_Of":
                        doc_id = succ
                        break
            except:
                pass

            if not doc_id or doc_id not in self.doc_store:
                return None

            doc = self.doc_store[doc_id]
            ant = note.annotations[0] if note.annotations else None
            return {
                "note_id": note.id,
                "summary": note.summary,
                "concept": note.concept_title,
                "keywords": note.keywords,
                "doc_title": doc.title,
                "bibtex_citation": doc.bibtex_citation,
                "page_num": ant.page_num if ant else 0,
                "bbox": ant.bbox if ant else [],
            }

        # 2. Graph Expansion (1-hop)
        # We start with retrieved notes
        for nid in retrieved_ids:
            if nid in visited_ids:
                continue
            visited_ids.add(nid)

            # Add the seed note itself
            fmt = format_note(nid)
            if fmt:
                expanded_notes.append(fmt)

            if not self.graph.has_node(nid):
                continue

            # Expand neighbors
            for neighbor in self.graph.neighbors(nid):
                if neighbor in visited_ids:
                    continue

                edge_data = self.graph.get_edge_data(nid, neighbor)
                relation = edge_data.get("relation")
                neighbor_node = self.graph.nodes[neighbor]
                neighbor_type = neighbor_node.get("type")

                # Case A: neighbor is a Note (Shares_Concept)
                if neighbor_type == "atomic_note":
                    fmt_n = format_note(neighbor)
                    if fmt_n:
                        expanded_notes.append(fmt_n)
                        visited_ids.add(neighbor)

                # Case B: neighbor is a Document (referenced via Cites)
                elif relation == "Cites" and neighbor_type == "document":
                    # Fetch notes contained in this cited doc to fulfill "merged note list"
                    if self.graph.has_node(neighbor):
                        # Get notes contained in this cited doc
                        for sub_neighbor in self.graph.successors(neighbor):
                            # Check for Contains edge
                            sub_edge = self.graph.get_edge_data(neighbor, sub_neighbor)
                            if sub_edge and sub_edge.get("relation") == "Contains":
                                if sub_neighbor not in visited_ids:
                                    fmt_n = format_note(sub_neighbor)
                                    if fmt_n:
                                        expanded_notes.append(fmt_n)
                                        visited_ids.add(sub_neighbor)

        return expanded_notes
