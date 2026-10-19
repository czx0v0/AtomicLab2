# Agent 概念全景（感知-决策-执行 / ReAct / 记忆 / 架构 / 上下文）

> 本文梳理 LLM agent 的核心概念、常见问题与成熟方案，并标注本项目（Router→Seeker→Reviewer→Synthesizer）的定位与差距。

## 1. 感知-决策-执行 vs ReAct vs Agent Loop

三者是「上位概念 → 具体范式 → 代码实现」的关系：

| 概念 | 层次 | 定义 |
|---|---|---|
| **感知-决策-执行**（Sense-Decide-Act） | 通用范式（机器人学/控制论） | 观察环境 → 决策 → 执行 → 再观察，闭环 |
| **ReAct**（Reason + Act, Yao 2022） | LLM agent 具体范式 | Thought（推理）→ Action（工具）→ Observation（观察）交替 |
| **Agent Loop** | 代码层实现 | `while not done: 生成 → 执行工具 → 结果拼回 → 下一轮` |

- ReAct = 感知-决策-执行在 LLM 上的实例化（Observation=感知、Thought=决策、Action=执行）；
- Agent Loop = 两种范式在代码里的循环实现。

> 本项目 Router→Seeker→Reviewer→Synthesizer 本质是「感知-决策-执行」的变体，但**不是标准 ReAct**（Reviewer 是启发式，缺 Thought→Action→Observation 的多轮反思）。

## 2. Agent 常见问题

| 问题 | 表现 | 本项目是否踩到 |
|---|---|---|
| 幻觉 | 编造工具结果/事实 | ⚠️ 有 |
| 上下文超限 | 长对话截断 | ⚠️ 有（无 token 预算） |
| 工具格式错误 | JSON schema 不匹配 | 可能 |
| 死循环 | 反复调同一工具 | 潜在（`max_rounds=2` 兜底） |
| 规划失败 | 复杂任务拆解错 | ⚠️ comp 题正是 |
| 状态丢失 | 中间状态不持久 | ⚠️ 有 |
| 工具选错 | Router 选错 | 可能 |
| 回答漂移 | 多轮结论不一致 | 潜在 |

## 3. 常见记忆方案

| 方案 | 内容 | 本项目对应 |
|---|---|---|
| 短期记忆 | 对话历史 | `history` |
| 工作记忆 | 当前任务状态 + 本轮证据 | ❌ 缺（待补 `ConversationState`） |
| 长期记忆 | 外部存储 + 检索 | ✅ 原子笔记 + 图谱 |
| 分层记忆（MemGPT） | 主上下文 + 外部记忆 + 归档 | ⚠️ 有雏形，缺分层 |
| 反思记忆（Reflexion） | 从失败总结经验 | ❌ 缺 |

## 4. 常见架构方案

| 架构 | 特点 | 适用 |
|---|---|---|
| ReAct | 单 agent 推理+行动交替 | 补多轮反思 |
| Reflexion | 自我反思从失败学 | 中期 |
| **Plan-and-Execute** | 先规划再执行 | **最适合 comp 题**（拆「对比 A/B」→ 分别检索） |
| Multi-agent 协作 | 角色分工 | ✅ 本项目已是 |
| Tree of Thoughts | 树状搜索多路径 | 复杂推理题 |

## 5. 上下文管理方案

| 方案 | 做法 | 优先级 |
|---|---|---|
| 滑动窗口 | 只留最近 N 轮 | 必做 |
| 摘要压缩 | 旧轮 → LLM 摘要 | 必做 |
| 记忆检索 | 按需检索长期记忆（RAG） | 已有 |
| 分层卸载（MemGPT） | 主动写/读/遗忘 | 重点 |
| token 预算 | 按优先级裁剪 | 必做 |

## 6. Agent 结构演进（从简单到复杂）

```
① 单 agent + 工具（ReAct）
     LLM ←→ 工具循环

② 单 agent + 反思（Reflexion）
     LLM → 行动 → 结果 → 反思 → 再行动

③ 规划器-执行器（Plan-and-Execute）
     规划器（拆任务）→ 执行器（逐步做）→ 汇总

④ 多 agent 协作（本项目）
     Router → Seeker → Reviewer → Synthesizer

⑤ 图式状态机（LangGraph）
     节点/边/条件路由 + checkpoint
```

## 7. 本项目定位与差距

当前在 **④（多 agent 协作）**，缺三样通往成熟 agent 的能力：

1. **ReAct 式多轮反思**：Reviewer 从「启发式」升级成「LLM 反思 + 行动」（对应优化点 1）；
2. **Plan-and-Execute 拆解**：comp 题先拆子问题再检索（对应优化点 3）；
3. **分层记忆 + 工作记忆**：`ConversationState` + 笔记分层（对应 Phase 1）。
