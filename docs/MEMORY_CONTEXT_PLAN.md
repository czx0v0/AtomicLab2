# 记忆与上下文管理 详细计划

> 目标：让 agent 从「无状态单轮」变成「有记忆多轮」，解决多轮追问丢上下文、长对话截断、重复检索三大问题。
> 原则：小增量、先文档后代码、每步可回滚。

## 1. 现状盘点

| 能力 | 现状 |
|---|---|
| 短期记忆（对话历史） | ✅ **已接入**（`history` 拼进 synthesis prompt，最近 8 轮） |
| 工作记忆（任务状态） | ❌ 缺（`ConversationState` 未实现） |
| 长期记忆（笔记+图谱） | ✅ 已有（`note_rag` + `knowledge_graph_store`） |
| token 预算 | ❌ 缺（无窗口管理） |
| 摘要卸载 | ❌ 缺 |

## 2. ConversationState 设计（工作记忆）

### 2.1 数据结构

```python
# core/session_state.py（新增）
from typing import List, Optional

class ConversationState:
    intent: str = ""                 # 当前任务意图
    evidence_cache: List[dict] = []  # 最近检索证据（doc_id + score + 摘要）
    subquestions: List[str] = []     # 未解决子问题（多跳拆解）
    concluded: List[str] = []        # 已确认结论（每轮 1-2 句）
    last_question: str = ""          # 上一轮问题（判断追问用）
    turn: int = 0                    # 轮次
```

持久化到 `session_store`（每 session 一个 `conversation_state.json`）。

### 2.2 每轮流程

```
加载 state
  ↓
判断「追问 vs 新问题」（embedding 相似度 / LLM 判断 last_question 与当前 question）
  ├─ 追问 → 复用 evidence_cache，只增量检索新增部分
  └─ 新问题 → 清空 evidence_cache，重新检索
  ↓
检索 → 更新 evidence_cache + subquestions
合成 → 更新 concluded（摘要）+ last_question
  ↓
持久化 state
```

### 2.3 关键点：判断「追问 vs 新问题」

- 简单方案：当前 question 与 `last_question` 的 embedding 余弦相似度 > 阈值（如 0.7）→ 追问；
- 更准方案：让 LLM 判断「是否指代上一轮」（如「它」「那个」「复杂度」等指代词）。

## 3. 上下文管理设计

### 3.1 token 预算（防截断）

给「系统提示 + 历史 + 检索证据 + 用户问题」设总预算（如 6000 tokens），超限按优先级裁剪：

```
系统提示 > 最新轮用户问题 > 最近证据 > 较新历史 > 旧历史
```

### 3.2 滑动窗口

对话历史只保留最近 N 轮（如 8 轮，已实现）；超过的直接丢弃最旧轮。

### 3.3 摘要卸载

- 超窗口的旧轮 → LLM 摘要成「已确认结论」（1-2 句/轮）；
- 摘要写入原子笔记（长期记忆，复用 `note_rag` 写入口）；
- 从工作上下文移除原始旧轮，只留摘要。

## 4. 分阶段实现（小增量，每步独立）

| 步骤 | 内容 | 改动量 | 状态 |
|---|---|---|---|
| 1 | 接入 history（拼进 prompt） | ~20 行 | ✅ 完成 |
| 2 | `ConversationState` 落盘 + 加载 | ~40 行 | ✅ 完成（`core/conversation_state.py`） |
| 3a | 最小状态追踪（load/save 接入 chat + chat_stream） | ~30 行 | ✅ 完成（2026-10-18） |
| 3b-i | 复用证据（追问跳过检索，用 evidence_cache） | ~30 行 | ✅ 完成（2026-10-18） |
| 3b-ii | 增量检索（追问时补检索新实体 + embedding 兜底） | ~40 行 | ⏳ 待做 |
| 4 | token 预算 + 裁剪 | ~50 行 | ✅ 完成（`_estimate_tokens` + `RAG_CONTEXT_BUDGET`） |
| 5 | 旧轮摘要（简洁版，>8 轮摘要成「已确认结论」） | ~30 行 | ✅ 完成（2026-10-19，`_summarize_history`） |
| 5b | 写回笔记（摘要持久化为「已确认结论」） | ~10 行 | ✅ 完成（`_finalize` 追加到 `state["concluded"]`，封顶 20 条） |

## 5. 与其他优化的关系

- **检索层**（评测收尾）：独立，不冲突；
- **Reviewer LLM 化**：可与步骤 3 结合（Reviewer 顺带判断「追问 vs 新问题」）；
- **技能注册表 / 图式编排**：Phase 2-3，不依赖本计划。

## 6. 验收标准

- 多轮追问「那它的复杂度呢」能正确指代上一轮、复用证据不重检索；
- 20 轮长对话不截断、不报错；
- 旧轮摘要能作为长期记忆被后续检索命中。

## 7. 步骤 3 集成详细设计（先文档后代码）

### 7.1 接入点（load/save）

**`chat()`（非流式）**：3 个 return 点前统一 `_finalize()`：

```python
def chat(body, x_session_id):
    session_id = x_session_id if IN_MODELSCOPE_SPACE else None
    state = load_state(session_id)          # ① 入口加载

    def _finalize():
        state["last_question"] = body.question
        state["turn"] = state.get("turn", 0) + 1
        save_state(session_id, state)       # ② 出口保存（3 处）

    # editor_action return → _finalize()
    # no_sources return      → _finalize()
    # with_sources return    → _finalize()
```

**`_chat_stream_generator()`（流式）**：入口 load，最终 `return` 前 save（生成器结束前持久化）。

### 7.2 分两步（降低风险）

**3a（最小，先做）**：只做 load/save，记录 `turn` + `last_question` + `concluded`（合成后追加 1 句摘要）。**不复用证据**——零行为改变，纯「状态追踪」，风险最低。

**3b（再做）**：追问判断 + 复用证据（真正的行为改变）。

### 7.3 追问判断（3b）

```python
_FOLLOWUP_RE = re.compile(r"它|这个|那个|这些|那些|上面|上述|刚才|之前|那")

def _is_followup(new_q: str, last_q: str) -> bool:
    if not last_q:
        return False
    # 启发式：含指代词 + 短问题（<20 字）
    return bool(_FOLLOWUP_RE.search(new_q)) and len(new_q.strip()) < 20
```

> 更准可加 embedding 相似度（`cosine(emb(new_q), emb(last_q)) > 0.7`），但需多一次嵌入调用，3b 先用启发式。

### 7.4 复用证据（3b）

```python
# 在 _route_with_tools 之前
if _is_followup(body.question, state["last_question"]) and state.get("evidence_cache"):
    sources = state["evidence_cache"]          # 复用，跳过检索
    tool_logs = ["[reuse] 追问：复用上一轮检索证据（%d 条）" % len(sources)]
else:
    sources, tool_logs, local_context = _route_with_tools(...)  # 正常检索
    state["evidence_cache"] = sources          # 更新缓存
```

### 7.4.1 边界情况（防误判）

| 边界 | 处理 |
|---|---|
| `last_question` 为空（首轮） | `_is_followup` 返回 False，绝不复用 |
| 追问但 `evidence_cache` 为空 | 走正常检索（不能复用空证据） |
| 长追问（>20 字，含指代词但其实是新题） | 长度阈值挡住，走正常检索 |
| 连续追问 3 轮（复用 3 次） | 缓存可能过时 → 第 2 次追问后强制增量检索（`force_refresh` 计数） |
| 追问换了话题（如「那 ViT 呢」） | 启发式误判 → 用 embedding 相似度兜底（`cos > 0.7` 才复用） |
| 证据缓存超阈值（>32 条） | 截断到最近 16 条，防上下文膨胀 |

### 7.4.2 建议 3b 分两步

- **3b-i**：仅「复用证据」——追问时跳过检索直接用缓存（简单，风险集中在「误判」）；
- **3b-ii**：加「增量检索」——追问时在缓存基础上补充检索新增实体（如「ViT」），更准但更复杂。

> 建议先做 3b-i（复用），观察误判率，再决定是否上 3b-ii。

### 7.4.3 3b-ii 详细设计（增量检索 + embedding 兜底）

**目标**：追问时既能复用旧证据，又能检索「新实体」；并用 embedding 降低误判。

**① 增量检索**（追问含新实体时补检索）：
```python
if _is_followup(q, last_q) and evidence_cache:
    # 提取新实体：追问里出现、但上一问没有的「专有名词」（大写/术语）
    new_entities = _extract_new_entities(q, last_q)   # 如「ViT」「Graphormer」
    if new_entities:
        extra = _route_with_tools(" ".join(new_entities), ...)  # 增量检索
        sources = evidence_cache + extra              # 合并
    else:
        sources = evidence_cache                      # 纯复用
```

**② embedding 兜底**（降低 regex 误判）：
```python
def _is_followup(q, last_q):
    if not last_q:
        return False
    if _FOLLOWUP_RE.search(q) and len(q.strip()) < 20:  # 启发式快判
        return True
    # 兜底：embedding 余弦 > 0.7 也判追问（覆盖「那 XX 呢」之外的指代）
    return _cosine_sim(embed(q), embed(last_q)) > 0.7
```

**③ 风险**：增量检索引入「新实体」的噪声；embedding 调用增加延迟。建议 3b-ii 先只做 embedding 兜底（不加增量检索），观察误判率后再上增量检索。

### 7.5 风险点与回滚

| 风险 | 缓解 |
|---|---|
| 多 return 点漏 save | 统一 `_finalize()`，或改写成单一出口 |
| 复用证据导致「追问变新题」漏检索 | 启发式判断 + `last_question` 为空时绝不复用 |
| 持久化并发写 | `conversation_state.py` 已加 `RLock` |
| 持久化失败 | `save_state` 静默失败，不影响主流程 |
| 回滚 | 改动前 git 干净，单文件 `chat.py` 可整文件回滚 |

### 7.6 与「接入 history」的关系

- 已接的 `history`（最近 8 轮）是**短期记忆**（拼 prompt）；
- `ConversationState` 是**工作记忆**（跨轮持久化状态）；
- 两者互补：history 给 LLM 上下文，state 给「追问复用」的判断依据。
