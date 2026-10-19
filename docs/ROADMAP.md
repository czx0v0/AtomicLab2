# 项目执行总规划（Roadmap）

> 原则：**先文档后代码、小增量修改、谨慎防 bug**。分四条线并行推进。
> 更新时间：2026-10-18（qwen3.8-flash + MinerU + 纯 RRF 口径）。

## 线 1：评测收尾（✅ 全部完成）

| 任务 | 状态 |
|---|---|
| comp 隔离测试（no-rerank / LLM / cross_encoder / vector 重测） | ✅ 完成 |
| 两组报告生成器（`make_two_group_report.py`） | ✅ 就绪（10 图 + 多维指标 + 显著性 + confounds） |
| 简历数字定稿 | ✅ 定稿（含 multi-agent +12.8/+14.9） |

**最终结论口径（qwen3.8 全数据定稿）**：
- 混合检索（BM25+向量）对多跳（+12.5）和对比（+9.4）都有效；
- **重排效果依赖 BM25 权重（核心）**：multi @1.5 重排大帮 +11.88、@0.5 微害 −1.4；comp 任何权重都害 −11~−14；
- 最优策略 = **按题型路由**：multi 用 BM25 1.5 + rerank，comp 用 BM25 0.5 + 无重排；
- **多智能体链路**：single +12.8、multi +14.9，且显著降幻觉（single 4%→0%、multi 36%→20%）；
- 系统整体升级：vector 55.5%→66.1%（+10.6）、hybrid 62.0%→71.4%（+9.4）。

## 部署优化建议

| 方案 | 配置 | 说明 |
|---|---|---|
| **短期（不改码）** | BM25 1.0 + auto-rerank | 简单，但 comp 受害（−11） |
| **中期（按题型路由）** | multi→1.5+rerank，comp→0.5+no-rerank | 需加「题型分类」步骤（LLM 判 single/multi/comp/adv） |
| **建议** | 先短期，再上「题型分类」 | 题型分类可并入 Phase 2 的「查询分解」 |

> 关键：BM25 默认权重**保持 1.0 不改**（权重是题型耦合的，全局改无意义）；重排开关 + 权重都应由「题型路由」决定。

## 线 2：可选补充（未跑）

| 任务 | 说明 |
|---|---|
| multi-agent 消融（qwen3.8 + MinerU，4 组 http） | ✅ 已完成（single +12.8、multi +14.9） |
| no-rerank 消融（multi/single/adv 3 组） | ⏳ 待跑：拆解 multi +12.5 的 BM25/rerank 贡献 |
| 裁判校准（30 题人工标注 κ） | 可选，提升评测可信度 |

## 线 3：架构优化（见 AGENT_ARCH_PLAN.md + MEMORY_CONTEXT_PLAN.md）

**Phase 1（多轮记忆 + 上下文）**：
- ✅ 接入 history（短期记忆，最近 8 轮拼 prompt）；
- ✅ ConversationState 模块（`core/conversation_state.py`，落盘/加载）；
- ✅ 3a 最小状态追踪（chat + chat_stream 接入 load/save）；
- ✅ 3b-i 复用证据（追问跳过检索）；
- 📝 3b-ii 设计完成（增量检索 + embedding 兜底），代码待 3b-i 验证；
- ⏳ 窗口 token 预算 + 旧轮摘要卸载。

**Phase 2（中期）**：三层记忆 + 技能注册表。
**Phase 3（长期）**：图式编排（LangGraph）+ 主动感知 + trace。

## 线 4：待诊断（不改代码，先定位）

| 问题 | 状态 |
|---|---|
| demo「原文」跳转 404 | ⏳ 疑似 doc_id `global_demo_official` 未映射到 `/api/demo/pdf`（前端路由） |
| 云端 demo_paper.pdf 部署确认 | ⏳ 看云端日志「Demo 预热跳过：未找到」 |

## 代码修改纪律

1. 每次只改一处，改完自测（`test_api.py` + 单条评测）；
2. 先文档后代码；
3. 保留回滚点（git 干净）；
4. 评测数据不污染（用新 run-name）；
5. **不改 BM25 默认权重（保持 1.0）**——权重是题型耦合的，按题型路由才是正解。

## 文档索引

| 文档 | 内容 |
|---|---|
| `MULTIAGENT_ARCH.md` | 现状架构（Router/Seeker/Reviewer/Synthesizer 怎么做） |
| `AGENT_CONCEPTS.md` | 概念全景（ReAct/记忆/架构/上下文 + 系统定位） |
| `AGENT_ARCH_PLAN.md` | 架构优化计划（Phase 1-3 + 修复记录） |
| `MEMORY_CONTEXT_PLAN.md` | 记忆+上下文详细计划（ConversationState/3a/3b 设计） |
| `EVAL_PLAN.md` / `OPTIMIZATION_PLAN.md` | 评测计划 / 检索优化计划 |
| `RESUME.md`（scripts/eval/） | 简历数字 |
