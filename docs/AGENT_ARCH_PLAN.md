# Agent / 状态 / 记忆 / 多轮对话 架构优化计划

> 目标：评估现有自研 multi-agent 架构（Router→Seeker→Reviewer→Synthesizer）在 **agent 编排、状态、记忆、多轮、窗口、感知、技能** 七个维度上，是否应借鉴 LangChain / LangGraph / MemGPT / Harness 等成熟框架，并给出分阶段优化方案。
>
> 配套文档：**现状**见 [`MULTIAGENT_ARCH.md`](MULTIAGENT_ARCH.md)，**概念全景**（ReAct/记忆/架构/上下文）见 [`AGENT_CONCEPTS.md`](AGENT_CONCEPTS.md)。

## 1. 现状盘点

| 维度 | 现状 | 位置 |
|---|---|---|
| **agent 编排** | 手写 function-calling：`_route_with_tools`（Router 路由 + Seeker 多通道 + Reviewer 评估 + Synthesizer 合成） | `aether_engine/api/chat.py` |
| **状态** | `session_id` + per-session 文件存储（ModelScope 用 `/mnt/workspace`，本地用 `data/`） | `core/session_store.py` |
| **记忆** | 原子笔记（`notes.json` + ChromaDB）+ 知识图谱（NetworkX，tag 重叠 `Shares_Concept` 边） | `note_rag.py` / `knowledge_graph_store.py` |
| **多轮** | `history` 列表直接拼接传入，无显式状态追踪 | `chat.py` |
| **窗口** | **无 token 预算管理**，长对话直接超限 | 缺 |
| **感知** | 被动：Router function-calling 选择工具（search_arxiv / search_local / merge） | `chat.py` |
| **技能** | 硬编码工具（写死在 Router schema 里） | `chat.py` |

## 2. 参考框架分析

### 2.1 LangGraph（图式 agent 编排）

- **节点 + 边 + 条件路由 + checkpoint**：把 agent 流程建模为有向图，中间状态可持久化/恢复/回放；
- **typed state（Pydantic）**：整个图的共享状态是强类型的，跨节点传递有 schema 约束；
- **优点**：编排清晰、可观测、可复现、天然支持「暂停-恢复-人工介入」；
- **代价**：引入重依赖（langgraph + langchain-core），且现有手写逻辑需重写成图。

### 2.2 LangChain（模块抽象）

- **Memory / Tool / Skill 抽象**：统一的记忆接口、工具接口、Runnable 链；
- **优点**：抽象规范，生态丰富；
- **代价**：抽象层厚，对「定制检索管线 + 图谱」这种强定制场景，收益有限。

### 2.3 MemGPT / Letta（分层记忆 + 主动记忆管理）

- **分层记忆**：主上下文（工作记忆）+ 外部记忆（可检索）+ 归档（冷数据）；
- **记忆管理事件**：由 LLM 主动决定「写/检索/遗忘」，而非被动拼接；
- **核心思想**：**「窗口不是越大越好，而是动态装卸记忆」**。

### 2.4 DeepSeek Harness（本平台编排）

- 多 agent 扇出、工作流、持久化 goal 等（与本项目可类比）。

## 3. 差距分析（借鉴思想 vs 引入依赖）

| 维度 | 现状问题 | 参考 | 结论 |
|---|---|---|---|
| **agent 编排** | 手写、扩展新 agent 需改代码 | LangGraph 图式 | ⚠️ **借鉴「图式 + typed state」思想，不引重依赖**（重写成图成本高，收益中等） |
| **状态** | session_store 够用，但中间状态（检索结果/中间推理）不持久 | LangGraph checkpoint | ✅ 借鉴「类型化中间状态 + 落盘」 |
| **记忆** | 有长期记忆（笔记+图谱）雏形，但缺「工作记忆 + 记忆检索/遗忘策略」 | MemGPT 分层 | ✅ **重点借鉴**：补「工作记忆 + 主动记忆装卸」 |
| **多轮** | history 盲拼接，无任务状态 | LangGraph typed state | ✅ 补「任务状态 + 中间结果」 |
| **窗口** | 无 token 预算，长对话崩 | 滑动窗口 + 摘要 + 记忆卸载 | ✅ **必做（近期）** |
| **感知** | 被动 function-calling | 感知-决策-执行循环 | ⚠️ 可选，先保持被动 |
| **技能** | 硬编码 | 技能注册表 + 描述 + 动态选择 | ✅ 建议做（中期） |

**总原则**：**借鉴「思想」，不盲引「重依赖」**。现有自研检索+图谱是核心竞争力，不应被框架抽象吃掉；框架的价值在「编排/状态/记忆」这些通用层。

## 4. 分阶段优化计划

### Phase 1（近期，低风险高收益）—— 多轮记忆 + 上下文窗口

> 详细设计见 [`MEMORY_CONTEXT_PLAN.md`](MEMORY_CONTEXT_PLAN.md)。
>
> ⚠️ **前置发现（2026-10-18）**：`ChatRequest.history` 字段**定义了但从未被读取**，当前 agent 完全无多轮记忆（无状态）。所以 Phase 1 的第一步必须是「接入 history」，否则没有「窗口预算」的对象。

1. **接入 history（短期记忆）**：在 `chat()` 读取 `body.history`，取最近 N 轮（如 8 轮）拼进 synthesis prompt（放在 question 前面）；最小改动 15~20 行；
2. **中间状态持久化**（新增 `ConversationState`）：在 `session_store` 存类型化状态 `{intent, evidence_cache, subquestions, concluded, turn}`；每轮先「追问 vs 新问题」判断，追问复用 `evidence_cache` 增量检索；
3. **token 预算管理**：给「检索证据 + 对话历史 + 系统提示」设预算，超限按优先级裁剪（系统 > 最新轮 > 检索证据 > 旧历史）；
4. **对话历史压缩 + 记忆卸载**：超窗口对旧历史 LLM 摘要（成「已确认结论」），写入原子笔记（长期记忆），从工作上下文移除。

> **落地顺序**：先「接入 history」（15~20 行，让多轮生效）→ 再 `ConversationState`（追问复用证据）→ 再窗口预算 → 最后摘要卸载。
>
> **✅ 已完成（2026-10-18）**：
> - 合成输出 `max_tokens` 1400→3000（`chat.py` 4 处）；
> - 证据摘要截断 800 字符（`_build_synthesis_prompt`）；
> - **接入 history**（短期记忆，最近 8 轮拼进 prompt，chat + chat_stream 两端点）；
> - **ConversationState 模块**（`core/conversation_state.py`，落盘/加载/会话隔离/损坏容错）；
> - **3a 最小状态追踪**（chat + chat_stream 接入 load/save，记录 turn + last_question）；
> - **3b-i 复用证据**（`_is_followup` 启发式 + 追问复用 evidence_cache 跳过检索）。
> - **旧轮摘要（简洁版）**：`_summarize_history`，历史 >8 轮时摘要成「已确认结论」，只留最近 8 轮原文（2026-10-19）。
> - **token 预算**：`_estimate_tokens` + `RAG_CONTEXT_BUDGET`（默认 6000），超限裁剪证据。
> - **5b 写回笔记**：`_finalize` 把旧轮摘要追加到 `state["concluded"]`（封顶 20 条）。
> 剩余：**3b-ii**（增量检索 + embedding 兜底，观察 3b-i 误判后）。

### Phase 2（中期）—— 记忆分层 + 技能注册表

1. **三层记忆**（借鉴 MemGPT）：
   - **工作记忆**：当前对话 + 本轮检索证据（有 token 上限）；
   - **长期记忆**：现有原子笔记 + 图谱（已具备，补「按需检索」而非全量注入）；
   - **归档记忆**：冷笔记（超阈值自动降级）。
2. **主动记忆管理**：让 Reviewer/Synthesizer 在对话中主动「写入笔记 / 检索笔记 / 遗忘过时笔记」，而非被动全量加载；
3. **技能注册表**：把硬编码工具抽成「技能描述 + schema + 调用入口」的注册表，Router 动态选择。

### Phase 3（长期）—— 图式编排 + 主动感知

1. **图式 agent 编排**：评估是否引入 LangGraph，把 Router/Seeker/Reviewer/Synthesizer 重写成图节点（含 checkpoint，支持人工介入）；
2. **主动感知**：引入「环境状态轮询 + 感知-决策-执行」循环（如定时检查新文献、任务进度）；
3. **可观测性**：全链路 trace（已有 `agent_traces`，扩展成图级 trace）。

## 5. 结论与建议

1. **不必推翻自研**：现有 Router→Seeker→Reviewer→Synthesizer + 混合检索 + 图谱是差异化能力，框架替代不了；
2. **最该补的是「窗口管理」和「记忆分层」**：这是当前多轮长对话的硬伤，且与框架无关，自研即可；
3. **框架的价值集中在「编排/状态」**：LangGraph 的「图式 + typed state + checkpoint」值得在 Phase 3 评估引入，但优先级低于窗口/记忆；
4. **「感知/技能」是锦上添花**：当前被动 function-calling 够用，技能注册表在 Phase 2 做即可。

---

## 附：与本轮评测的关系

本计划不阻塞评测收尾。评测结论（混合检索+重排的题型耦合、BM 权重调参）属于「检索层」；本计划属于「agent/记忆层」，两者可并行。建议先完成评测报告，再启动 Phase 1（窗口管理）。
