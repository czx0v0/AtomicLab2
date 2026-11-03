# Multi-Agent 工业级重构 · Spec v2

> 状态：待评审（用户确认后再实现）。本 spec 基于代码事实，纯设计不改代码。

## 0. 代码事实（依据）

| 现状 | 位置 |
|---|---|
| Reviewer 打分只进展示，不 feedback | `chat.py::_reviewer` → `steps`/`agent_traces` |
| Seeker 2 轮（query + 变体/图扩展） | `search.py::_search_pipeline` `rounds=min(max_rounds,len(variants))` |
| Router FC 2 轮（第 2 轮补 arXiv） | `chat.py::_route_with_tools` `for _ in range(_router_iter)` |
| prompt 散落 5 处 | `_SYNTHESIS_SYSTEM_BASE`、Router system、`_llm_expand_query`、`_reviewer_llm`、`requirements` |
| 工具 schema 硬编码 | `chat.py::_route_with_tools` 7 个 tools 内联 |
| 引用越界无 clamp | 仅 prompt 约束「角标≤总数」 |

## 1. Reviewer → 门控（gating，核心）

**职责**：判断「检索回来的证据够不够」，不够就**再检索**。

```
Router（1 次路由，仅本地 search_local）
  → Seeker（1 轮主检索）
  → Reviewer（门控，单次不循环）
      ├─ sufficient（且 score≥6.5）→ Synthesizer
      └─ insufficient → 用 suggestion 补 1 次检索（可含 arXiv）→ 必进 Synthesizer
```

### 判据（LLM + 分数兜底 + 思考建议）

Reviewer 输出 schema：

```python
class ReviewerResult(BaseModel):
    sufficient: bool          # 是否充分
    score: float = 5.0        # 0-10 兜底分
    reason: str               # 一句话理由
    suggestion: str           # 若 insufficient：建议补充检索什么（引导再检索）
```

- **判据**：`sufficient = llm 判断 and (score >= REVIEWER_GATE_SCORE=6.5)`（LLM 主判 + 分数兜底，任一不满足即 insufficient）；
- **suggestion**：LLM 给出的「缺什么/该补检索什么」，作为下一轮 Seeker 的 query（结合 LLM 思考与建议）；
- **单次门控（不循环）**：Reviewer 只评 1 次，insufficient 时最多补 1 次检索（suggestion 驱动），然后**必进 Synthesizer**，不做第二次门控；
- **兼容**：`REVIEWER_MODE=heuristic` 时用旧启发式（`score<6.5 → insufficient`，suggestion 空 → 用原始 query 再检）。

## 2. Seeker → 单轮

- `_search_pipeline` 默认 `rounds=1`（只做主检索，query + 主通道）；
- 图扩展/变体检索改由 **Reviewer 门控**触发（insufficient 时用 suggestion 再检）；
- 保留 `SEEKER_EXPAND_MODE`（regex/llm）控制单轮内的查询扩展。

## 3. Router FC → 单次（去掉 ROUTER_MAX_ITER=2）

- Router FC 只做 **1 次路由**（判意图 + 选工具）；
- **arXiv 不主动补**：Router 只路由本地 `search_local`，arXiv 补充交给 Reviewer 门控的 suggestion 触发（避免 Router+Reviewer 双重补 arXiv 的重复与噪声）；
- 例外：用户明确问「最新/arXiv 论文」时，Router 意图分类仍可直接路由 `search_arxiv`；
- 删除 `ROUTER_MAX_ITER`（职责交给 Reviewer 门控）；
- `ARXIV_ENABLED` 保留（控制 arXiv 是否允许）。

## 4. Prompt 全局集中（YAML）

- 新建 `config/prompts.yaml`（统一 config 文件夹），集中：

```yaml
synthesis_system_base: "..."
router_system: "..."
seeker_expand: "..."
reviewer_gate: "..."
requirements_detail: "..."
requirements_general: "..."
```

- 新增 `aether_engine/core/prompts.py` 加载器：`load_prompt(key)` 从 YAML 读取 + 兜底默认值；
- 各处 `prompt` 字符串改为 `load_prompt(...)`，字符串内容不变（行为零变化）；
- YAML 支持中文 + 变量占位（`{n_total}`、`{top_k}`），渲染时填充。

## 5. 引用全局规范

- **编号单一事实来源**：evidence XML 的 `[n]` 全局编号；Reviewer「Top 证据」复用同一编号（不再两套）；
- **clamp 后处理**：新增 `_clamp_citations(answer, n_total)`，`[n] > n_total` 的角标删除或标灰；
- **引用 schema**：`Citation = {index, source, doc_id, support}`（可选 Pydantic）。

## 6. Schema 提取

- **工具 schema**：抽 `TOOL_DEFS`（7 工具 name/description/parameters 常量），`_route_with_tools` 引用 + 按 `_TOOL_CATEGORIES` 裁剪；
- **sources schema**：`RetrievedSource`（doc_id/source/score/concept/summary/page/bbox，缺省默认），`_normalize_retrieved_cards` 用它校验 + 补默认；
- **Reviewer 输出 schema**：`ReviewerResult`（见 §1）。

## 7. 实施顺序（独立 commit，可回滚）

1. **P0-a 引用 clamp + 编号统一**（小、独立）；
2. **P0-b Reviewer 门控 + Seeker 单轮 + Router 单次**（核心，配 `REVIEWER_GATE_MAX`/`REVIEWER_GATE_SCORE` env）；
3. **P1 prompt YAML 集中**（纯重构，字符串不变）；
4. **P1 工具 schema 抽常量**（纯重构）；
5. **P2 Pydantic schema 校验**（边界兜底）。

## 8. 风险 + 边界

| 项 | 处理 |
|---|---|
| 门控死循环 | `REVIEWER_GATE_MAX` 上限（默认 1） |
| 延迟增加 | 默认 `REVIEWER_GATE_MAX=1`（= 现状单轮延迟） |
| 兼容旧评测 | `REVIEWER_MODE=heuristic` + `REVIEWER_GATE_MAX=1` 复现 |
| prompt 重构 | 字符串不变，纯 import 移动 |
| YAML 加载失败 | `load_prompt` 兜底内置默认值 |

## 9. 已确认（v2 修订）

1. ✅ Reviewer 判据：LLM 主判 + score≥6.5 兜底，**单次门控不循环**；
2. ✅ 无循环：Reviewer 评 1 次 → 最多补 1 次检索 → 必进 Synthesizer；
3. ✅ YAML 路径：`aether_engine/config/prompts.yaml`；
4. ✅ arXiv 由 Reviewer suggestion 决定（1 次），Router 不主动补（除明确「最新/arXiv」意图）。

## 10. 第二步：Seeker 自主决策（function-calling 选检索方案）

> 状态：设计稿，待评审。这是「Seeker 从被动执行器 → 自主检索 agent」的升级。

### 10.1 目标

Seeker 不再被动跑固定 `retrieval_mode`（config 写死），而是**用 function-calling 决策「这个题用哪几个检索通道 + 检索几轮」**，多步检索后输出最终排序融合结果。

### 10.2 架构定位（对齐用户理解）

```
Router（高层意图：写作/回答/闲聊）→ 决定要不要检索（不含检索细节）
Seeker（自主检索 agent）★ → function-calling 选检索方案 + 执行 + 融合
Reviewer（门控）→ 证据够不够
Synthesizer → 合成
```

### 10.3 Seeker 的检索工具集（5 个 function-calling 工具）

| 工具 | 作用 |
|---|---|
| `search_vector(query, top_k)` | 向量语义检索（doc_vector + note_vector） |
| `search_bm25(query, top_k)` | BM25 词法检索（doc_bm25 + note_bm25） |
| `search_graph(query, hops)` | 图谱 1/2-hop 扩展 |
| `search_ocr(query)` | 截图 OCR 文本检索 |
| `search_arxiv(query)` | 外部 arXiv 补充（按需） |

### 10.4 决策流程（多步，有界）

```
Seeker 接收 retrieval_task
  → Step 1：function-calling 决策 → 调 search_vector + search_bm25
  → 看结果 → Step 2：决策要不要 search_graph（1-hop 扩展）
  → 需要 → 调 search_graph
  → RRF 融合 → 输出最终 sources（排序后的检索结果）
```

- 步数上限 `SEEKER_MAX_STEPS=3`（默认，防死循环）；
- 每步 function-calling 基于「上一步结果」决策（检索 → 看结果 → 再检索）；
- 最终 RRF 融合（保持不变，规则排序）输出 `sources`。

### 10.5 与现状对比

| | 现状 | 第二步（Seeker 自主） |
|---|---|---|
| 通道选择 | `retrieval_mode` 写死（config） | function-calling 决策（LLM） |
| 检索策略 | 固定 2 轮 | 多步决策（检索→看结果→再检索） |
| Seeker 角色 | 被动执行器 | 自主检索 agent |

### 10.6 兼容 + 风险

| 项 | 处理 |
|---|---|
| 无 API key / LLM 决策失败 | 回退固定多路召回（现状行为） |
| 死循环 | `SEEKER_MAX_STEPS` 上限 |
| 延迟增加 | 多步 function-calling；可设 `SEEKER_MAX_STEPS=1` 复现现状 |
| 正确率影响 | **需评测验证**（LLM 决策 vs 固定召回） |
| 兼容旧评测 | `SEEKER_MODE=fixed`（默认，现状）切回；`SEEKER_MODE=auto`（function-calling） |

### 10.7 实施（独立 commit，晚于 P0/P1）

1. `TOOL_DEFS` 抽出 Seeker 的 5 个检索工具（`search_vector`/`search_bm25`/`search_graph`/`search_ocr`/`search_arxiv`）；
2. `_seeker_orchestrate(task)`：function-calling 决策循环（`SEEKER_MAX_STEPS`）+ RRF 融合；
3. `SEEKER_MODE` 开关（`auto` 自主 / `fixed` 现状）；
4. 评测 `auto` vs `fixed`，确认正确率不降后定稿。

## 11. 超长上下文升级（Map-Reduce）【规划，未实现】

> 现状是「RRF 收敛 top_k=10 + 摘要截断 1600」；Map-Reduce 是更高级的升级，用于「几十万字」极端场景。

### 11.1 取舍

| | 现状（RRF+截断） | Map-Reduce |
|---|---|---|
| 复杂度 | 低（已实现） | 高（chunk 级 Map + Reduce 汇总） |
| 适用 | 常规问答（<10 万字） | 极端超长（几十万字） |
| 防 Lost-in-Middle | ❌ | ✅（高分片段放首尾） |

### 11.2 设计（规划）

- Map 阶段：对每个 chunk 用 LLM 提取「核心观点 + 实体 + 数字」；
- Reduce 阶段：汇总各 chunk 的观点生成；
- 配合 Rerank 把 top 片段放 prompt 首尾（防 Lost in the Middle）。

## 12. 信源权重 + 冲突标注【规划，未实现】

> 现状是「并列呈现冲突（不强行择一）」，Metadata 权重/时间戳是更精细的冲突消解。

### 12.1 取舍

| | 现状 | Metadata 权重 |
|---|---|---|
| Metadata | `doc_title` + `source` | + `weight` + `timestamp` |
| 冲突处理 | 并列呈现（不择一） | 优先采信 + 显式标注 |

### 12.2 设计（规划）

- `RetrievedSource` 加 `weight`（信源权威度）+ `timestamp`（发布时间）；
- Synthesizer prompt 加约束：「若冲突，优先采信更新/权威信源，并显式标注『A 说 X，B 说 Y』」。

## 13. 状态总览（已完成 / 规划）

| 项 | 状态 |
|---|---|
| P0-a 引用 clamp | ✅ 已实现 |
| P0-b Reviewer 门控 + Seeker 单轮 + Router 单次 | ✅ 已实现（开关默认关） |
| P1 工具 schema + prompt 集中 | ✅ 已实现 |
| P2 Pydantic schema | ✅ 已实现 |
| §10 Seeker 自主（function-calling 选方案） | 📋 设计稿，待实现 |
| §11 Map-Reduce 超长上下文 | 📋 规划，未实现 |
| §12 信源权重 + 冲突标注 | 📋 规划，未实现 |

## 14. 门控评测（验证 P0-b）

```powershell
$env:REVIEWER_GATE_ENABLED="1"   # 开门控
$env:SEARCH_ROUNDS="1"           # Seeker 单轮
$env:ROUTER_MAX_ITER="1"         # Router 单次
$env:SEEKER_EXPAND_MODE="regex"
# 跑 multi_gate / comp_gate，对比 multi_heur_topk10（68.6%）
```

- **验证点**：门控 =「单轮 + 按需补检索」，正确率应 ≈ 基准（68.6%），延迟更省；
- **判定**：`multi_gate` ≈ 68.6% 且日志有 `[gate] Reviewer 判不足，已补检索` = 门控生效且等价 FC2。
