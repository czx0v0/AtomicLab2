# Atomic Lab: A Technical Whitepaper on Agentic RAG and Atomic Knowledge Workflows

Interstellar Office Team Product R&D Division

March 14, 2026

# Abstract

Welcome to Atomic Lab. This document serves as both a technical whitepaper and an interactive demo file for our system. The exponential growth of scientific literature presents a dual crisis: the fragmentation of reading inspirations and the difficulty of tracing citations during writing. Atomic Lab solves this by deconstructing literature into ”Atomic Knowledge” and leveraging an Agentic RAG (RetrievalAugmented Generation) architecture. This manual outlines our core technical implementations.

# 1 Introduction to Atomic Knowledge

Traditional document-centric reading models trap knowledge within isolated PDFs. We advocate for ”Knowledge Atomization.” Every core argument, experimental result, or methodology is extracted as a semantically self-consistent ”Atomic Card.”

By passing extracted text through our Crusher Agent, non-structured text is automatically categorized into seven domains (Method, Formula, Image, Definition, Viewpoint, Data, Other) and tagged with AIgenerated keywords.

![](/api/parse-images/demo_paper/175151b2f90a1d739328b05280436f6d2d7579a38c3cfa9bea15465376fd0f8d.jpg)  
Figure 1: Atomic Lab

As demonstrated in Table 1, this approach guarantees the purity of the data fed into our Large Language Models (LLMs), reconstructing cross-page tables into HTML and formulas into LaTeX.

![](/api/parse-images/demo_paper/078540fdf9c751a233b4503e79779917f7c52666e221cdf446b79d263b733bfd.jpg)
Table 1: Parsing capabilities comparison.

# 2 Core Technologies

# 2.1 Multi-modal Deep Parsing

Academic literature parsing is notoriously difficult due to dual-column layouts and complex mathematical embeddings. Atomic Lab integrates the advanced MinerU parsing engine.

# 2.2 Hybrid Retrieval & RRF Fusion

To balance retrieval precision (finding specific terms) and breadth (understanding context), Atomic Lab utilizes a Hybrid Retrieval architecture. We combine dense semantic vectors (FAISS HNSW) with sparse lexical search (BM25).

To fuse these ranking systems equitably, we apply the Reciprocal Rank Fusion (RRF) algorithm. For a document d in a set of rank lists R, the score is calculated as:

where k = 60 acts as a smoothing constant. This ensures that only knowledge atoms ranking high across multiple strategies are presented to the user.

# 2.3 GraphRAG & 1-Hop Expansion

Knowledge in Atomic Lab is not flat. Atoms are stored in a dual-track architecture. When a user queries a concept, the system retrieves direct matches and performs a ”1-hop expansion” along the knowledge graph (e.g., following shared tags or citation links) to uncover hidden academic causality.

# 3 The Agentic RAG Workflow

The chat interface of Atomic Lab is not a simple Q&A bot; it simulates a multi-agent ”virtual research group” meeting:

Seeker: Executes multi-source retrieval, pulling evidence from document vectors, note cards, and external fallback APIs (e.g., arXiv).   
Reviewer: Critically evaluates the retrieved context. If the evidence is insufficient, it rewrites the query and triggers a secondary search.   
Synthesizer: Generates the final, logically coherent response, embedding precise, verifiable citations.

# 4 Conclusion

By integrating deep document parsing, GraphRAG, and Agentic workflows, Atomic Lab provides a seamless Read-Organize- Write loop. We invite you to explore the system by highlighting texts, asking questions, and generating your own verifiable academic insights.