# AtomicLab：面向学术写作的多智能体混合检索 RAG 系统

**技术白皮书（Technical Whitepaper）**

> 版本：v1.0 · 整理日期：2026-10-27
> 本文为系统级技术说明，所有架构描述、公式与实验数据均源自仓库内真实代码与评测产物，文末附参考文献与出处。
> 配套数据口径见 [EVAL_FACTS.md](EVAL_FACTS.md)。

---

## 摘要

AtomicLab 是一个面向科研人员的「阅读—整理—写作」一体化学术工作台，针对科研场景中**信息过载、看完即忘、学术写作困难**三大痛点，将文献解析、知识组织与学术写作集成于统一系统。技术上，系统采用「多路召回 + RRF 融合 + 图谱扩展」的混合检索架构与「Router → Seeker → Reviewer → Synthesizer」的四阶段多智能体工作流，实现意图识别、证据检索、证据评估与答案合成的职责分离，以抑制学术问答中的幻觉并确保回答可溯源。

在自建的 100 条学术 QA 评测集（single-hop / multi-hop / comparative / adversarial 各 25 条）上，实验表明：混合检索较纯向量检索在 100 题平均正确率上由 66.1% 提升至 71.4%，其中多跳问答提升 12.5 个百分点、对比类提升 9.4 个百分点；多智能体链路较纯检索+合成在单跳与多跳上分别提升 12.8 与 14.9 个百分点。本文给出系统架构、核心算法原理、评测方法，并诚实说明样本量与覆盖范围的局限。

---

## 1. 引言

### 1.1 问题背景

学术文献问答与写作面临两类核心挑战：

1. **证据分散**：答案往往跨篇、跨章节，单一向量检索对多跳与对比类问题召回不足；
2. **可信引用**：纯生成模型易编造事实，需避免幻觉并给出可回溯的引用。

### 1.2 系统目标与贡献

系统围绕三个目标设计：

1. 将 PDF 文献转化为**可检索、可关联、可注入**的知识资产；
2. 将聊天助手从「回答器」升级为**可执行写作动作的 Agent**；
3. 将写作从「空白页创作」升级为**基于知识图谱的连续创作**。

核心贡献：① 混合检索（向量 + BM25 + 图谱）与纯 RRF 融合；② 四阶段多智能体编排；③ 多维自动评测流水线与消融结论。

---

## 2. 系统总体架构

### 2.1 五层架构

系统可抽象为五层（源自 [TECHNICAL_REPORT.md](TECHNICAL_REPORT.md)）：

| 层 | 职责 | 核心组件 |
|---|---|---|
| Ingestion（摄取） | PDF 解析、分块、结构化摘要 | `service/parser.py`（MinerU）、`service/doc_rag.py`（分块） |
| Index（索引） | 向量索引 + 词法索引 + 图谱 | ChromaDB（HNSW）、`bm25_engine.py`、`knowledge_graph_store.py` |
| Retrieval（检索） | 多通道召回 + 查询扩展 + RRF 融合 | `api/search.py::_search_pipeline` |
| Agent（编排） | 路由、检索、评估、合成 | `api/chat.py` |
| Interaction（交互） | SSE 流式、引用跳转、写作注入 | `core/llm.py`、前端 Zustand |

### 2.2 技术栈

| 组件 | 选型 | 说明 |
|---|---|---|
| 后端框架 | FastAPI + Uvicorn | `app.py` / `aether_engine/main.py` |
| 向量数据库 | ChromaDB | HNSW 索引，cosine 度量（`doc_rag.py` `metadata={"hnsw:space":"cosine"}`） |
| Embedding | paraphrase-multilingual-MiniLM-L12-v2 | SentenceTransformer，CPU 推理，batch=32 |
| 词法检索 | rank-bm25 + jieba | 中文分词 BM25 |
| 知识图谱 | NetworkX（DiGraph） | tag 重叠构建 `Shares_Concept` 边 |
| PDF 解析 | MinerU | 原生支持 LaTeX 公式、双栏、表格 |
| 合成模型 | qwen3.8-flash（部署） | 考生/合成 |
| 裁判模型 | deepseek-reasoner（R1） | 评测裁判 |

---

## 3. 知识库构建管线（Ingestion）

### 3.1 文档解析（MinerU）

PDF 经 `parse_pdf_with_mineru`（`service/parser.py`）解析为 Markdown，支持 API 与本地 CLI 两种模式。选择 MinerU 而非 pypdf 的原因：pypdf 存在公式乱码、双栏混排、表格丢失等缺陷，MinerU 原生支持 LaTeX 公式与版面还原。

### 3.2 分块策略

`_split_markdown`（`service/doc_rag.py`）按标题/段落切块，默认 **800 字符**，无重叠；单段超长时按 800 字符硬切（step = chunk_size − overlap）。分块参数可由 `RAG_CHUNK_SIZE` / `RAG_CHUNK_OVERLAP` 覆盖。消融实验（§7.5）证明 800 字为最优：400 字切太碎丢失上下文（46.4%），1200 字引入噪声（73.2%）。

### 3.3 向量化与索引

分块文本经 MiniLM-L12-v2 编码（batch=32 分批，避免内存峰值），写入 ChromaDB `doc_chunks` collection，索引为 **HNSW + cosine 距离**。写入前按 `doc_id` 删除旧索引，保证文档更新后可见。

### 3.4 词法索引（BM25）

`bm25_engine.py` 基于 rank-bm25 + jieba 分词构建文档 BM25 索引（`build_doc_index_from_chromadb` 从 Chroma 复用分块，避免重复解析），首次构建后缓存为 `.pkl`，重启免重新分词。

### 3.5 笔记蒸馏与原子卡片

`note_distiller.py::distill_note_text` 将用户口语化笔记（UGC）经 LLM 蒸馏为结构化**原子卡片**：

```json
{ "axiom": "一句话核心结论", "method": "一句话方法路径", "boundary": "一句话适用边界", "tags": ["关键词"] }
```

无 API key 时回退确定性兜底（`_fallback_distill`），保证接口可用。

### 3.6 知识图谱构建

`knowledge_graph_store.py::upsert_note_node` 将原子卡片写入 NetworkX 图节点，并按 **tag 重叠**自动建双向边 `Shares_Concept`（重叠 tag 取前 6 个）。图谱为检索阶段的跨篇证据扩展提供拓扑支撑。

---

## 4. 混合检索（Retrieval）

### 4.1 多路召回

`_search_pipeline`（`api/search.py`）并行执行多通道召回，各通道带权重：

| 通道 | 内容 | 权重 |
|---|---|---|
| doc_vector | 文档分块稠密向量 | 1.8（最高） |
| doc_bm25 | 文档分块 BM25 | 可调（默认 1.0，`RAG_BM25_WEIGHT`） |
| note_vector | 原子笔记向量 | 0.9 |
| note_bm25 | 原子笔记 BM25 | 0.7 |
| graph_1hop / 2hop | 图谱 1/2 跳扩展 | — |
| graph_dochop | 文档↔笔记跨类型扩展 | — |
| screenshot_ocr | 截图 OCR 文本 | 0.5 |

查询扩展（`_llm_expand_query`）将问题改写为 2–3 个不同角度的检索查询进行多轮召回，增强覆盖。

### 4.2 RRF 融合（核心原理）

多通道结果经**纯 RRF（Reciprocal Rank Fusion）**融合（`_rrf_fuse`，`api/search.py:289`）：

\[
\text{score}(d) = \sum_{c \in C} \frac{w_c}{k + \text{rank}_c(d) + 1}, \quad k = 60
\]

其中 \(w_c\) 为通道权重，\(\text{rank}_c(d)\) 为文档 \(d\) 在通道 \(c\) 中的排名（从 0 起）。**纯 RRF 只比排名、不混原始分**——因为 BM25 归一化到 1.0 与向量余弦 0.3~0.9 量纲不可比，混入原始分会导致 BM25 不公平地挤占向量结果（此为项目记录在案的关键修复）。

### 4.3 重排序（可选）

RRF 融合后可叠加重排：cross_encoder（`BAAI/bge-reranker-base`）或 LLM listwise。开启重排时先融合出 **3×top_k** 候选池再精排回 top_k。消融（§7.5）表明 cross-encoder 对多跳/对比类为**负结果**（根因「语义相似度 ≠ 答案相关度」），最优策略是按题型路由。

### 4.4 图谱扩展

以向量召回结果为 seed，沿图谱 1/2-hop 补全跨篇证据（`get_one_hop_triples` / 2-hop），解决「答案跨篇」问题。评测库因不含笔记/图谱，此通道在生产已实现、评测未覆盖（诚实声明）。

---

## 5. 多智能体工作流（Multi-Agent）

### 5.1 设计动机

将一次问答拆为四个职责分离的环节（源自 [MULTIAGENT_ARCH.md](MULTIAGENT_ARCH.md)），收益有三：**关注点分离**（路由≠检索≠评估≠合成）、**可观测/可复现**（`_build_agent_traces` 记录每步）、**可消融**（`agent_mode` 量化各环节贡献）。

单次请求流程：

```
HTTP POST /api/chat
  → load_state（工作记忆）
  → _is_followup（追问判断 → 复用 evidence_cache）
  → Router（意图识别 + 工具路由 + 历史感知改写）
  → Seeker（查询扩展 + 多通道检索 + RRF 融合 + 重排）
  → Reviewer（证据评估/门控）
  → Synthesizer（分区 XML + 角标引用合成）
  → _finalize（更新 ConversationState）
  → 返回 JSON / SSE 流
```

### 5.2 Router —— 意图识别与工具路由

Router 是「大脑」，采用**两级路由**：

1. **正则启发式**（免费、确定性）：`_classify_tool_category` 分类工具组；`_is_research_detail_question` / `_is_factual_question` / `_is_editor_action_intent` 判定「必须走本地 RAG」与「写作意图」。
2. **LLM function-calling**（语义、动态）：在组内用 7 个工具 schema 选工具（`search_local_knowledge` / `search_arxiv` / `search_my_zotero` / `fetch_arxiv_recommendations` / `export_latex` / `debug_latex_error` / `update_markdown_editor`）。

关键约束：事实型/文献细节型问题，即使 Router 未选工具，也会被 `_should_force_local_when_router_skips_tools` 强制走本地检索，防止漏检索。Router 还做**历史感知查询改写**（`_rewrite_query_with_history`），将含指代/省略的短问题消解为自包含查询。

### 5.3 Seeker —— 检索执行

执行 §4 的多通道检索 + RRF 融合 + 可选重排，输出 top_k=10 候选证据。

### 5.4 Reviewer —— 证据评估与门控

默认 `_reviewer_llm`：LLM 判断检索证据是否足以支撑回答，输出结构化 JSON `{status: success|warning|insufficient, score: 0-10, detail}`。无 API key 时回退启发式（`grade=avg*10`，≥6.5 通过）。

门控策略为**单次、有界**：Reviewer 评 1 次，最多触发 1 次补充检索（query 来自 Reviewer 的 suggestion），然后**强制进 Synthesizer**——非 while 循环，从结构上杜绝死循环。

### 5.5 Synthesizer —— 答案合成

`_build_synthesis_prompt` 将证据按**分区 XML** 组织（`<document_chunks> / <atomic_notes> / <graph_relations>`），每条带全局编号 `[n]`；LLM 依据分区证据合成回答并**强制角标引用**。无证据时走 `_general_fallback_answer` 诚实降级（说明「本地库暂无该细节」）。

### 5.6 工作记忆与多轮对话

四个 Agent 中**只有 Synthesizer 背完整历史**（`_MAX_HISTORY_TURNS` + `_summarize_history` 渐进压缩）；Router 用轻量历史（近 4 条）；Seeker/Reviewer 完全无状态。中间态（sources/agent_traces）全程结构化 JSON，只有最终 prompt 拼成文本，避免 agent 间「传话污染」。

跨轮工作记忆由 `ConversationState`（intent / evidence_cache / subquestions / concluded / last_question / turn）持久化 JSON 承担，追问复用 evidence_cache 避免重复检索。

---

## 6. 幻觉防御机制

系统采用**多层防御**（源自 [INTERVIEW_QA.md](INTERVIEW_QA.md) §2）：

| 层 | 机制 |
|---|---|
| 检索层 | 纯 RRF + note_id 去重 + top_k 收敛 |
| 证据层 | summary 截断，防长 chunk 撑爆丢细节 |
| 提示词层 | 角标≤总数 + 严禁编造 + 缺细节说「文献未提及」 |
| 门控层 | Reviewer 门控：证据不足 → 补检索/降级 |
| 降级层 | 无证据 → `_general_fallback_answer` 诚实说明局限 |
| 评测层 | 裁判上下文与合成 Agent 证据对齐，避免误判 |

---

## 7. 评测体系与实验结果

### 7.1 数据集

`scripts/eval/dataset.json`，共 100 条学术 QA，字段 `{question, ground_truth, type}`，四类题型各 25 条，覆盖 3 篇经典论文并按题型隔离建库：

| 题型 | 题数 | 覆盖文献 | 设计意图 |
|---|---:|---|---|
| single-hop | 25 | Attention Is All You Need（Transformer，Vaswani 2017）单篇 | 单篇事实抽取 |
| multi-hop | 25 | Transformer + Graphormer（Ying 2021）+ ViT（Dosovitskiy 2021） | 跨篇证据链 |
| comparative | 25 | 同上 3 篇 | 跨论文抽象对比 |
| adversarial | 25 | 同上 3 篇 | 抗幻觉陷阱（诚实拒答） |

**ground_truth 标注方式**：事实题给出精确答案（含数值与 LaTeX 公式，如 \( d_k = 64 \)、\( \epsilon_{ls}=0.1 \)、warmup_steps=4000），平均长度 117.1 字符（最短 4、最长 322）；adversarial 题 ground_truth 统一为「文献未提及」（25/25 题均为否定表述）。

**adversarial 题设计**：故意构造论文中**不存在的概念**（如「自适应注意力跨度」「谱注意力机制」「模型剪枝」「可微分图池化」），考查模型诚实拒答而非编造，直接度量抗幻觉能力。

**主题覆盖（single-hop 节选）**：缩放点积注意力、多头注意力、位置编码、FFN、Adam/学习率调度、标签平滑、束搜索、计算复杂度表、LayerNorm、残差连接、掩码、dropout、BLEU；题目以 LaTeX 公式嵌入题面，考查论文精确细节的检索与复现。

### 7.2 评测指标

RAGAS 风格多维指标（`compute_metrics.py`），主指标为 **correctness** 与 **hit@k**：

| 指标 | 度量对象 |
|---|---|
| correctness | answer vs ground_truth（答案正确性） |
| hit@k | 检索上下文 vs ground_truth（Top-K 命中率） |
| context_precision / recall | 检索证据 vs answer / ground_truth |
| faithfulness | answer vs retrieved_contexts（忠实度） |
| hallucination | answer vs (contexts ∪ ground_truth)（幻觉率） |
| citation_accuracy | 角标 [n] vs 证据 |

### 7.3 评测流程

`run_evaluation.py` 支持 direct（进程内直连检索+合成，用于消融）与 http（打后端完整链路）两种模式；裁判固定 deepseek-reasoner，`response_format=json_object`；bootstrap 95% CI 由 `compare_experiments.py` 计算。

### 7.4 主要结果

**混合检索 vs 纯向量（部署口径 qwen3.8-flash + MinerU + 纯 RRF）：**

| 题型 | 纯向量 | 混合检索 | Δ |
|---|---:|---:|---:|
| single-hop | 86.0 | 86.4 | +0.4 |
| multi-hop | 41.8 | 54.28 | **+12.5** |
| comparative | 37.8 | 47.2 | **+9.4** |
| adversarial | 98.8 | 97.6 | −1.2 |
| 100 题平均 | 66.1 | 71.4 | **+5.3** |

**多智能体消融（full vs retrieval_only）：**

| 题型 | retrieval_only | full | Δ |
|---|---:|---:|---:|
| single-hop | 80.8 | 93.6 | **+12.8** |
| multi-hop | 36.4 | 51.28 | **+14.9** |

### 7.5 消融分析

- **分块长度**：400=46.4% / **800=82.0%** / 1200=73.2%（800 为甜点）。
- **重排序**：cross-encoder 对多跳 −6.2、对比 −11.2（负结果）；最优按题型路由（multi 用 BM25 1.5 + rerank，comp 用 BM25 0.5 无重排）。
- **Seeker 查询扩展**：single 用 LLM（97.0% vs 92.8%），multi/comp 用 regex（68.6% vs 52.6%；49.6% vs 47.0%）——题型相关。

完整数据见 [EVAL_FACTS.md](EVAL_FACTS.md)。

---

## 8. 结论与局限

**结论**：混合检索 + 图谱扩展显著提升多跳/对比类问答（+9.4~+12.5pt）；多智能体链路显著提升整体正确率（+12.8~+14.9pt）；800 字符分块为甜点；cross-encoder 重排不适用于本任务。

**局限（诚实声明）**：

1. n=25/题型，95% CI ≈ ±9pt，提升为**方向性/边际显著**，扩题 n≥50 或多 seed 方可坐实；
2. 评测库仅含文档分块（无笔记/图谱），「full 收益」实为 BM25 词法召回贡献，非图谱扩展贡献；
3. Reviewer 门控在 spec 规划、未完全落地代码；Human-in-the-loop 未实现；
4. 幻觉率非 <5%（single 4% / multi 20% / comp 12% / adv 0%，regex 口径）。

---

## 参考文献

- 项目文档：[MULTIAGENT_ARCH.md](MULTIAGENT_ARCH.md)、[AGENT_CONCEPTS.md](AGENT_CONCEPTS.md)、[TECHNICAL_REPORT.md](TECHNICAL_REPORT.md)、[INTERVIEW_QA.md](INTERVIEW_QA.md)、[DEPLOYMENT.md](DEPLOYMENT.md)、[EVAL_FACTS.md](EVAL_FACTS.md)
- 评测报告：[two_group_report.md](../reports/two_group_report.md)、[ACADEMIC_REPORT.md](../scripts/eval/ACADEMIC_REPORT.md)、[MULTIAGENT_EVAL_ABLATION.md](MULTIAGENT_EVAL_ABLATION.md)
- 核心代码：`aether_engine/api/chat.py`、`aether_engine/api/search.py`、`aether_engine/service/doc_rag.py`、`aether_engine/service/bm25_engine.py`、`aether_engine/service/knowledge_graph_store.py`、`aether_engine/service/parser.py`、`aether_engine/service/note_distiller.py`、`aether_engine/service/embedding.py`、`scripts/eval/compute_metrics.py`

> 外部方法引用：RAGAS 评测指标（correctness / faithfulness / context precision / context recall）；RRF 融合（Cormack et al., 2009）。
