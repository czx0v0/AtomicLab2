# Atomic Lab: A Technical Whitepaper on Agentic RAG and Atomic Knowledge Workflows

Interstellar Ofice Team Product R&D Division

October 19, 2026

## Abstract

Welcome to Atomic Lab. This document serves as both a technical whitepaper and an interactive demo file for our system. The exponential growth of scientific literature presents a dual crisis: the fragmentation of reading inspirations and the dificulty of tracing citations during writing. Atomic Lab solves this by deconstructing literature into “Atomic Knowledge” and leveraging an Agentic RAG (Retrieval-Augmented Generation) architecture. This manual outlines our core technical implementations and the empirical results from a 100- question academic QA benchmark.

## 1 Introduction to Atomic Knowledge

Traditional document-centric reading models trap knowledge within isolated PDFs. We advocate for “Knowledge Atomization.” Every core argument, experimental result, or methodology is extracted as a semantically self-consistent “Atomic Card.”

By passing extracted text through our note distiller and atomic decomposer agents, nonstructured text is automatically distilled into an axiom–method–boundary triple and tagged with AI-generated keywords.

## 2 Core Technologies

## 2.1 Multi-modal Deep Parsing

Academic literature parsing is notoriously difficult due to dual-column layouts and complex mathematical embeddings. Atomic Lab integrates the advanced MinerU parsing engine.

![](/api/parse-images/demo_paper/d3b54aacca4bf402bce257ae636265d05a1ced52dca55e4e52cafcb721f92d42.jpg)  
Figure 1: Atomic Lab

As demonstrated in Table 1, this approach guarantees the purity of the data fed into our Large Language Models (LLMs), reconstructing cross-page tables into HTML and formulas into LaTeX.

<table><tr><td>Challenge</td><td>Standard OCR</td><td>Atomic Lab (MinerU)</td></tr><tr><td>Math For-</td><td>Garbled</td><td>100% LaTeX</td></tr><tr><td>mulas</td><td>characters</td><td>recovery</td></tr><tr><td>Layouts</td><td>Reading or-</td><td>Logical block</td></tr><tr><td rowspan="2">Citations</td><td>der errors</td><td>analysis Exact coordi-</td></tr><tr><td>Ignored su-</td><td></td></tr><tr><td></td><td>perscripts</td><td>nate mapping</td></tr></table>

Table 1: Parsing capabilities comparison.

## 2.2 Hybrid Retrieval & RRF Fusion

To balance retrieval precision (finding specific terms) and breadth (understanding context), Atomic Lab utilizes a Hybrid Retrieval architecture. We combine dense semantic vectors (via the embedded ChromaDB vector store) with sparse lexical search (BM25) and a knowledge graph.

To fuse these ranking systems equitably, we apply the Reciprocal Rank Fusion (RRF) algorithm. For a document d in a set of rank lists R, the score is calculated as:

$$
R R F ( d ) = \sum _ { r \in R } { \frac { 1 } { k + r ( d ) } }\tag{1}
$$

where $k = 6 0$ acts as a smoothing constant. We use a pure RRF fusion (rank-only, no raw-score mixing), so that only knowledge atoms ranking high across multiple strategies are presented to the user.

An optional cross-encoder re-ranker further amplifies semantic relevance. Our ablation shows the re-ranking gain is conditional on the BM25 weight: on multi-hop questions a high BM25 weight (1.5) plus re-ranking yields +11.9 points, whereas on abstract comparative questions re-ranking hurts regardless of weight (see Table 2).

![](/api/parse-images/demo_paper/53931b46b5248b33f519156c4b719029619c0265a00d355f73eb2c30f63e23a1.jpg)  
Figure 2: Re-ranking gain depends on the BM25 weight (multi-hop).

## 2.3 GraphRAG & 1/2-Hop Expansion

Knowledge in Atomic Lab is not flat. Atoms are stored in a dual-track architecture. When a user queries a concept, the system retrieves direct matches and performs a 1/2-hop expansion along the knowledge graph (following shared tags or citation links) to uncover hidden academic causality.

## 3 The Agentic RAG Workflow

The chat interface of Atomic Lab is not a simple Q&A bot; it simulates a multi-agent “virtual research group” meeting of four roles:

• Router: Classifies user intent (academic retrieval / writing / paper recommendation / peer review) and dispatches to the appropriate tool via LLM function-calling.

• Seeker: Executes multi-source retrieval, pulling evidence from document vectors, BM25, note cards, the knowledge graph, and external fallback APIs (e.g., arXiv).

• Reviewer: Critically evaluates the retrieved context; if the evidence is insufficient, it flags low-confidence context and triggers re-retrieval.

• Synthesizer: Generates the final, logically coherent response, embedding precise, verifiable citations.

Ablating this orchestration (full vs. retrieval-only) on our benchmark shows the multi-agent chain adds +12.8 points on single-hop and +14.9 points on multi-hop correctness, while also reducing hallucination (single-hop 4% 0%, multi-hop 36% 20%).

![](/api/parse-images/demo_paper/2b73ba8f8057d76733ec63e8aa8141b98f637ce113cb2f8ee38b81b5137613a3.jpg)  
Figure 3: Multi-agent orchestration ablation (full vs. retrieval-only).

## 4 Evaluation Results

We evaluate on a self-built 100-question academic QA set (single-hop / multi-hop / comparative / adversarial, 25 each), judged by a fixed reasoning model with 95% confidence intervals.

Generation quality: faithfulness  93%, hallucination rate 8%. These results demonstrate that the hybrid retrieval pipeline delivers the largest gains on dificult multi-hop and comparative questions, where a single vector channel alone is insuficient.

<table><tr><td>Question type</td><td>Vector</td><td>Hybrid</td><td>Δ</td></tr><tr><td>Single-hop</td><td>86.0%</td><td>86.4%</td><td>+0.4 +12.5</td></tr><tr><td>Multi-hop Comparative</td><td>41.8% 37.8%</td><td>54.3%</td><td>+9.4</td></tr><tr><td>Adversarial</td><td>≈98%</td><td>47.2% ≈98%</td><td>~0</td></tr><tr><td></td><td></td><td></td><td></td></tr><tr><td>Overall</td><td>66.1%</td><td>71.4%</td><td>+5.3</td></tr></table>

Table 2: Correctness by question type (hybrid vs. vector-only).

![](/api/parse-images/demo_paper/7fc0eaa103a81eab01bfa1b53cbc8a6b004c324f71210ac20b0a0819ed830f82.jpg)  
Figure 4: Per-type correctness improvement (hybrid vs. vector-only).

## 5 Conclusion

By integrating deep document parsing, hybrid retrieval (ChromaDB + BM25 + GraphRAG with pure RRF fusion), and a four-role Agentic workflow, Atomic Lab provides a seamless Read–Organize–Write loop. We invite you to explore the system by highlighting texts, asking questions, and generating your own verifiable academic insights.