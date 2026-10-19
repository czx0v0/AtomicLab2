# Atomic Lab: A Technical Whitepaper on Agentic RAG and Atomic Knowledge Workflows

Interstellar Office Team Product R&D Division

# Abstract

Welcome to Atomic Lab. This document serves as both a technical whitepaper and an interactive demo file for our system. The exponential growth of scientific literature presents a dual crisis: the fragmentation of reading inspirations and the difficulty of tracing citations during writing. Atomic Lab solves this by deconstructing literature into "Atomic Knowledge" and leveraging an Agentic RAG (Retrieval-Augmented Generation) architecture. This manual outlines our core technical implementations and the empirical results from a 100-question academic QA benchmark.

# 1 Introduction to Atomic Knowledge

Traditional document-centric reading models trap knowledge within isolated PDFs. We advocate for "Knowledge Atomization." Every core argument, experimental result, or methodology is extracted as a semantically self-consistent "Atomic Card."

By passing extracted text through our note distiller and atomic decomposer agents, non-structured text is automatically distilled into an axiom-method-boundary triple and tagged with AI-generated keywords.

# 2 Core Technologies

# 2.1 Multi-modal Deep Parsing

Academic literature parsing is notoriously difficult due to dual-column layouts and complex mathematical embeddings. Atomic Lab integrates the advanced MinerU parsing engine, reconstructing cross-page tables into HTML and formulas into LaTeX.

# 2.2 Hybrid Retrieval & RRF Fusion

To balance retrieval precision (finding specific terms) and breadth (understanding context), Atomic Lab utilizes a Hybrid Retrieval architecture. We combine dense semantic vectors (via the embedded ChromaDB vector store) with sparse lexical search (BM25) and a knowledge graph.

To fuse these ranking systems equitably, we apply the Reciprocal Rank Fusion (RRF) algorithm: RRF(d) = sum over rank lists of 1/(k + r(d)), with k=60 as a smoothing constant. We use a pure RRF fusion (rank-only, no raw-score mixing), so that only knowledge atoms ranking high across multiple strategies are presented to the user.

An optional cross-encoder re-ranker further amplifies semantic relevance. Our ablation shows the re-ranking gain is conditional on the BM25 weight: on multi-hop questions a high BM25 weight (1.5) plus re-ranking yields +11.9 points, whereas on abstract comparative questions re-ranking hurts regardless of weight.

# 2.3 GraphRAG & 1/2-Hop Expansion

Knowledge in Atomic Lab is not flat. Atoms are stored in a dual-track architecture. When a user queries a concept, the system retrieves direct matches and performs a 1/2-hop expansion along the knowledge graph (following shared tags or citation links) to uncover hidden academic causality.

# 3 The Agentic RAG Workflow

The chat interface of Atomic Lab is not a simple Q&A bot; it simulates a multi-agent "virtual research group" meeting of four roles: Router classifies user intent and dispatches tools; Seeker executes multi-source retrieval; Reviewer critically evaluates the retrieved context; and Synthesizer generates the final, logically coherent response with precise citations.

Ablating this orchestration (full vs. retrieval-only) on our benchmark shows the multi-agent chain adds +12.8 points on single-hop and +14.9 points on multi-hop correctness, while also reducing hallucination (single-hop 4% to 0%, multi-hop 36% to 20%).

# 4 Evaluation Results

We evaluate on a self-built 100-question academic QA set (single-hop / multi-hop / comparative / adversarial, 25 each), judged by a fixed reasoning model with 95% confidence intervals. Correctness by question type: single-hop 86.0% to 86.4% (+0.4), multi-hop 41.8% to 54.3% (+12.5), comparative 37.8% to 47.2% (+9.4), adversarial around 98%, overall 66.1% to 71.4% (+5.3). Generation quality: faithfulness around 93%, hallucination rate at most 8%.

# 5 Conclusion

By integrating deep document parsing, hybrid retrieval (ChromaDB + BM25 + GraphRAG with pure RRF fusion), and a four-role Agentic workflow, Atomic Lab provides a seamless Read-Organize-Write loop. We invite you to explore the system by highlighting texts, asking questions, and generating your own verifiable academic insights.
