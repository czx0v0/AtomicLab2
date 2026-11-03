# 面试答辩文档 · Multi-Agent RAG 系统

> 全部基于 `AtomicLab` 项目真实代码事实（chat.py / search.py / conversation_state.py / run_evaluation.py）。答法 = 代码事实 + 答辩口径 + 诚实边界。

## 0. 一页速览：4 个 Agent 各自看到什么

| Agent | 上下文（看到什么） | 记忆（背不背历史） | 输入形态 |
|---|---|---|---|
| **Router** | 原始问题 + 轻量历史（近 4 条 `history_txt`）+ 工具 schema | ✅ 轻历史（近 4 条，判意图够用） | 文本 |
| **Seeker** | `keywords`（Router FC 提取的查询）→ regex/LLM 扩展 → 检索 | ❌ 无状态 | 文本 query |
| **Reviewer** | 问题 + 证据（`sources[:8]`，每条 summary `[:200]`） | ❌ 无状态 | 结构化 JSON（输出） |
| **Synthesizer** | 证据分区 XML（`sources[:10]`，每条 `[:1600]`）+ 问题 + 历史 + 课题上下文 | ✅ 完整历史（`_MAX_HISTORY_TURNS`+`_summarize_history` 压缩） | 文本（XML 分区） |

**关键**：只有 **Synthesizer 背完整历史**，Router 背轻历史，Seeker/Reviewer 完全无状态。中间态（sources/agent_traces）全程**结构化 JSON**，只有「最终给 LLM 的 prompt」才拼成文本。

---

## 1. 状态管理 vs 上下文管理（Harness 层 vs Agent 层）

| 层 | 是什么 | 存哪 | 生命周期 |
|---|---|---|---|
| **Harness 状态**（工作记忆） | `ConversationState`：`intent`/`evidence_cache`/`subquestions`/`concluded`/`last_question`/`turn` | `data/conversation_state_{sid}.json`（Pydantic） | 跨轮持久化 |
| **Agent 上下文** | 各 agent 的 prompt + 输入（问题/证据/工具） | 不落盘 | 每轮临时 |

**区别一句话**：
- **Harness 状态** = 「跨轮记忆」，负责多轮对话的连续性（追问复用 evidence_cache、避免重复检索）；
- **Agent 上下文** = 「单轮输入」，负责本轮 4 步流水线的信息传递（结构化 JSON，不共享完整历史）。

---

## 2. 如何防止幻觉（多层防御，按代码事实）

| 层 | 机制 | 代码 |
|---|---|---|
| **检索层** | 纯 RRF + `note_id` 去重 + top_k=10 收敛 | `_search_pipeline` |
| **证据层** | summary 截断 `[:1600]`（防长 chunk 撑爆丢细节） | `_build_synthesis_prompt` |
| **提示词层** | 「角标≤总数 + 严禁编造 + 缺细节说『文献未提及』」 | `requirements` |
| **门控层** | Reviewer 门控（spec 规划）：证据不足 → 再检索/降级 | `AGENT_REFACTOR_SPEC.md` |
| **降级层** | 无证据 → `_general_fallback_answer` 诚实说明局限 | `chat.py` |
| **评测层** | 裁判上下文对齐（8→10 条），避免「裁判视野窄」误判 | `run_evaluation.py` |

**诚实边界**：幻觉率当前 multi 20% / comp 12% / adv 0% / single 8%——不是「<5%」，别虚报。幻觉根因是「该答没答（文献未提及）」+「跨论文对比错」，不是「编造」。

---

## 3. 十组面试追问 · 答辩口径

### 3.1 State 断点续传
- **轮级 checkpoint**：每轮结束 `_finalize` 落盘 `ConversationState` JSON，重启 `load_state` 恢复；追问复用 `evidence_cache` 不重复检索。
- **诚实**：无 agent 级断点（pipeline 同步，崩溃重跑这一轮）。

### 3.2 多路召回去重/冲突
- `note_id` 去重 + **纯 RRF 排名融合**（不混原始分，避免 BM25 归一化值不公平挤掉向量）。冲突不靠「覆盖」，靠「多通道一致排名靠前」。

### 3.3 状态传递 JSON vs 文本
- 中间态**结构化 JSON**（sources/agent_traces/retrieved_cards），只有最终 prompt 拼文本（evidence XML）。避免「agent 传话污染」。

### 3.4 裁判校准 + 降级
- 无显式 Calibration，但做**上下文覆盖率校准**：裁判视野 8→10 条后幻觉 64%→8%（这是比调温度更本质的校准）。
- 连续失败 → 走降级（诚实回复「本地文献库暂无该细节」），不报错。

### 3.5 Harness 防坑（Human-in-the-loop）
- 死循环→迭代上限；上下文污染→结构化 JSON + 历史只在 Synthesizer；检索覆盖→两级路由 + agent_mode 消融。
- **诚实**：Human-in-the-loop 目前**弱**（写作工具路由隔离 + spec 规划 Reviewer 门控确认），未实现前端弹窗。

### 3.6 为什么不用 LangChain/LangGraph/Dify
- 定制「纯 RRF + BM25 权重 + 多路召回」需代码级控制，黑盒 ReAct 插不进；LangGraph 的「条件边」正好匹配**未来 Reviewer 门控**，是承认的演进方向。

### 3.7 超长上下文
- RRF 收敛 top_k=10 → 分区 XML → `_summarize_history` 渐进压缩老轮。

### 3.8 PDF/LaTeX/双栏
- **MinerU**（非 pypdf）原生支持 LaTeX 公式 + 双栏识别；pypdf 直接转的坑 = 公式乱码/双栏混排/表格丢失。

### 3.9 架构追问（状态传递 + 重试 + 死循环）
- 见 §1 + §2；重试由 Reviewer 门控（spec），死循环由迭代上限防。

### 3.10 评测追问（幻觉率 + GT）
- GT 人写（`dataset.json`）；幻觉率 = 有幻觉的**题数**/25（不是句数）；「更详尽」被 `faithfulness` 压分（不凭常识补全）。

---

## 4. Deep-dive 1：Reviewer 门控死循环

### 问题
Reviewer 判定「证据不足」→ 触发再检索 → 再评 → 可能循环。

### 解法（已写进 `AGENT_REFACTOR_SPEC.md`）
```
单次门控（不循环）：
Seeker(1轮) → Reviewer(评1次)
  ├─ sufficient + score≥6.5 → Synthesizer
  └─ insufficient → 用 suggestion 补 1 次检索 → 必进 Synthesizer（不再评第二次）
```

- **硬上限**：Reviewer 只评 1 次，最多补 1 次检索（`suggestion` 驱动），然后**强制进 Synthesizer**；
- **判据**：`llm 判断 and score≥6.5`（LLM 主判 + 分数兜底）；
- **suggestion**：LLM 给「缺什么/补检索什么」，作为下一轮 query（结合 LLM 思考）；
- **兜底**：即使 suggestion 为空，也用原始 query 再检一次，然后必进合成（不会卡住）。

### 面试讲法
> 「我的门控是**单次、有界**的——Reviewer 评一次，最多触发一次补充检索，然后强制进合成。不是 while 循环，所以不可能死循环。补充检索的 query 来自 Reviewer 的 suggestion（LLM 说缺什么就补什么），而不是盲目重试。」

---

## 5. Deep-dive 2：裁判校准（Judge Calibration）

### 问题
裁判（deepseek-reasoner）可能误判（把正确答案判成幻觉）。

### 你的真实案例（亮点）
裁判只看 `sources[:8]` 时，comparative 幻觉 64%；把裁判上下文对齐到 10 条后，幻觉掉到 8%——**这不是幻觉变少了，是裁判「视野变宽」不再误判**。

### 解法（三层）
1. **上下文覆盖率校准**：裁判的 `retrieved_contexts` 与 Synthesizer 的 evidence 对齐（同一 `sources` 全集），避免裁判「证据不全就判编造」；
2. **判据结构化**：`hallucinated` 判据 =「answer 出现**既不在 retrieved_contexts 又不在 ground_truth** 的具体断言」，双锚点（上下文+GT）降低误判；
3. **降级兜底**：`--chat-retries 3` + 失败走诚实降级，不硬报错。

### 面试讲法
> 「我没做『调温度』式的表面校准，做的是**上下文覆盖率校准**——先发现幻觉 64% 是裁判只看到 8 条证据导致的误判，把裁判视野对齐到和合成 agent 同一批证据后，幻觉率掉到 8%。这比调温度更本质：**让裁判看到和合成 agent 一样多的证据，才谈得上公平打分**。」

---

## 6. 记忆系统 + 框架：要不要简洁优化（我的建议）

### 当前状态（已经较简洁）
- 记忆只有一层 `ConversationState`（6 个字段）+ Synthesizer 的历史压缩；
- 没有堆「短期/工作/长期」三层记忆（不像 LangChain 全家桶）。

### 建议保持简洁，别加三层记忆
| 组件 | 建议 |
|---|---|
| ConversationState | ✅ 保留（6 字段够用，别加实体画像/向量记忆） |
| 历史压缩 `_summarize_history` | ✅ 保留（渐进压缩，够用） |
| 向量长期记忆 | ❌ 别加（RAG 本身就是向量库，再加一层记忆库是重复） |
| Reviewer 门控 | ✅ 加（这是「控制」不是「记忆」，值得做） |

### 框架简化建议
- **别上 LangGraph**（当前线性 4 步手写够用）；Reviewer 门控是「条件边」，但**一个 `if/else` 就够**，不值得为它引入图框架；
- **prompt YAML 集中**（spec 已规划）是唯一该做的「框架整洁化」；
- 其余保持现状（简洁 > 抽象）。

---

## 7. 诚实边界清单（面试别踩雷）

1. 幻觉率 **不是 <5%**（当前 multi 20% / comp 12%），别虚报；
2. Human-in-the-loop **未实现**（只有路由隔离 + spec 规划）；
3. 断点续传是**轮级**，非 agent 级；
4. Reviewer 门控**在 spec 里、未落地代码**；
5. 裁判校准是**上下文覆盖率校准**，不是统计校准（ICC/Cohen's κ 没做）。

## 8. 高频连环追问（补充）

### 8.1 最终评测结果（align10，regex vs llm）

| 题型 | regex | llm | 最优 | 幻觉(regex/llm) |
|---|---|---|---|---|
| single-hop | 92.8% | **97.0%** | LLM | 8%/4% |
| multi-hop | **68.6%** | 52.6% | regex | 20%/8% |
| comparative | **49.6%** | 47.0% | regex | 12%/16% |
| adversarial | 99.2% | **100.0%** | 持平 | 0%/0% |

**题型相关结论**：single→LLM（语义改写）；multi/comp→regex（关键词覆盖）；adv 持平。multi 上 regex 正确率高但幻觉高（trade-off）。

### 8.2 ConversationState 能防遗忘吗？

- 防「跨轮工作记忆」遗忘：JSON 落盘 `last_question/evidence_cache/concluded`；
- 防「单轮长上下文」遗忘：`_summarize_history` 渐进压缩 + `_MAX_HISTORY_TURNS`；
- **跨轮靠文件、轮内靠压缩**，两层配合。

### 8.3 检索/rerank/合成 各多少条

| 层 | 条数（top_k=10） |
|---|---|
| 检索 fetch_k | 20 / 10（两轮） |
| RRF 池 | 30（有 rerank）/ 10（无） |
| rerank 后 | 10 |
| Synthesizer | 10 条（summary[:1600]） |
| Reviewer | 8 条（summary[:200]） |

### 8.4 检索关键词是 query 还是改写 query

**是 `keywords`（Router FC 提取的关键词）**，不是原始 question。原始 question 只给 Router 判意图 + Synthesizer 生成；Seeker 检索用 FC 提取的 keywords（兜底 `search_query`）。

### 8.5 结构化 JSON + evidence XML 具体是什么

- **JSON**：`sources`（doc_id/source/score/concept/summary/page/bbox）+ `agent_traces`（step/status/detail/score）——agent 间结构化中间态；
- **XML**：给 Synthesizer 的证据分区（`<document_chunks>/<atomic_notes>/<graph_relations>`），每条带全局编号 `[n]`；
- 对比框架黑盒「subgraph state」，JSON/XML 是显式 schema：可校验、可断点、可注入硬逻辑。

### 8.6 鉴权安全

- LLM API key（`.env`）；会话隔离（`sanitize_session_id`）；文档访问控制（`session_doc_unlinked` + `_valid_session_doc_ids`）。

## 9. 高压场景追问链（医疗领域三痛点）

### 追问 1：补充检索后证据仍冲突，门控怎么收敛？

- 门控**单次有界**（非 while 循环）：Reviewer 评 1 次 → insufficient 补 1 次检索 → **强制进 Synthesizer**；
- 冲突不交给门控「再打回」，交给 Synthesizer **并列呈现**（「A 报告 10%，B 报告 5%」），不强行择一。

### 追问 2：门控是 LLM 还是规则？LLM 会不会自己幻觉？

- **LLM 主判 + 分数兜底**（`sufficient = llm and score≥6.5`）；
- 防 LLM 门控幻觉：分数兜底（LLM 说充分但 score<6.5 仍 insufficient）+ 结构化 JSON + 温度 0。

### 追问 3：收敛后答案还错怎么兜底？

- 三层：① 证据不足 → `_general_fallback_answer` 诚实降级（「本地文献库暂无该细节」）；② 引用越界 clamp（`[n]`>总数标灰/删除）；③ 无 API key → 检索摘要直出。

### 追问 4：冲突并列呈现怎么不误导用户？

- 保留来源（`doc_title` + 角标 `[n]`），用户可追溯自行判断；Synthesizer 约束「无证据处说明」，不编造「哪个对」——如实暴露冲突而非替用户拍板。
