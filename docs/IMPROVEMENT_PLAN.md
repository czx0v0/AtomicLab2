# 下一步：收尾与改进计划（基于 CODE_REVIEW.md）

> 审查报告：`docs/CODE_REVIEW.md`（27 项，5 专题，P0-P3）。
> 本文把审查结论转成**可执行、小增量、按依赖排序**的改进计划。
> 原则：**先修真实 bug（P0），再收敛单一事实来源（P1），最后整洁度（P2/P3）**。

## 1. 审查结论摘要

- 项目功能闭环完整（解析→检索→多智能体→写作/图谱/Zotero/LaTeX）；
- 但「**单一事实来源**」系统性失守：同一常量/逻辑复制 3~12 处；
- 由此引入**真实正确性缺陷**：本地重置失效（#3）、ALIYUN 路由失效（#6）。

## 2. 与近期工作的关系（已完成 vs 待办）

| 审查项 | 近期是否已处理 | 剩余 |
|---|---|---|
| #12 双 data 目录 + parse_images | ⚠️ 部分（DATA_DIR 修复了 API/service 层） | `parser.py#L43` 仍硬编码 `aether_engine/data/parse_images` |
| #1 IN_MODELSCOPE_SPACE 12 处 | ❌ 未处理 | 需单点化到 `config/settings.py` |
| #2 会话 ID 三套 | ❌ 未处理 | 需统一 Depends |
| #16 conversation_state 死字段 | ⚠️ 部分（我们写了 concluded，但只写不读） | 要么消费 `concluded`，要么删死字段 |

**结论**：近期工作「方向对但覆盖不全」，审查暴露的 P0 项需要单独一轮修复。

## 3. 分阶段执行计划

### P0（真实 bug，先修）

| # | 问题 | 修复 | 影响 |
|---|---|---|---|
| #3 | 笔记路径三套，本地重置失效 | 抽 `core/notes_file(session_id)` 单一函数，notes/reset/demo/note_rag/bm25 全走它 | 数据正确性 |
| #6 | LLM 客户端不统一，ALIYUN 下 Router 失效 | 抽 `core/llm.py::get_llm_client/call_llm/stream_llm`，所有模块复用 | 核心链路 |

**执行顺序**：#3 先（独立、低风险、修复真实 bug）→ #6（涉及面广，需仔细回归）。

### P1（单一事实来源 + 正确性）

| # | 问题 | 修复 |
|---|---|---|
| #12 | parse_images 硬编码 | `data_path("parse_images")` |
| #13 | bm25 invalidate 语义失效 | `invalidate()` 删 pickle 文件 |
| #1 | IN_MODELSCOPE_SPACE 12 处 | 单点 `is_modelscope_space()` |
| #2 | 会话 ID 三套 | 统一 FastAPI Depends（读头→净化→本地 None） |
| #4 | demo doc_id 5+ 处 | 后端唯一常量 |
| #17 | chat 两套编排重复 | 合并 `_run_chat()` 返回事件流 |
| #11 | 写后同步 7+ 处 | 抽 `service/sync.py` |
| #5/#20 | 死代码（rag_engine/extractor/core.models/冗余常量） | 删除或标注废弃 |

### P2（一致性 + 可复现）

| # | 问题 | 修复 |
|---|---|---|
| #7 | arXiv 三处重复 | 保留 `api/arxiv.py` 唯一客户端 |
| #8 | Markdown 分段三份 | 收敛到 `service/markdown.py` |
| #23 | search.py docstring 权重不符 | 单点 `CHANNEL_WEIGHTS` 字典 |
| #10/#25 | 依赖清单三份互斥 | `requirements.txt` 为唯一真相 |

### P3（整洁度，可缓）

| # | 问题 |
|---|---|
| #15 | parser 硬编码本机路径 |
| #21 | HTTP 风格不统一 |
| #22 | translate 无 Key 返回 mock |

## 4. 算法/学术视角的 3 点（建议纳入评测报告口径）

1. **加权 RRF 权重随轮次变化**（首轮 1.8/次轮 1.2）：消融复现依赖「首/次轮」隐性状态 → 权重表应外置单点配置并纳入实验清单；
2. **`_reviewer_heuristic` 的 `avg*10` 是伪指标** → 报告/前端应标注「启发式相关度估计」，别包装成客观评分；
3. **`score = max(0, 1-dist)` 隐含 cosine** → 死代码 rag_engine 若复活会量纲错误，再次印证应删除。

## 5. 收尾建议

1. **先提交当前已完成的干净改动**（记忆层 Phase 1 + DATA_DIR 修复 + 报告生成器 + 文档），让 git 有一个稳定基线；
2. **再开一个分支**做 P0 修复（#3/#6），修完回归测试（test_api.py + 单条评测）再 merge；
3. P1 的「单一事实来源」收敛是**大重构**，建议逐项小增量推进，每项独立 commit；
4. 学术视角的 3 点先更新进评测报告（`make_two_group_report.py` 的 MD 局限/方法节），再动代码。

## 6. 优先级总表

| 优先级 | 数量 | 主题 | 是否阻塞 |
|---|---|---|---|
| P0 | 2 | 笔记路径、LLM 客户端（真实 bug） | 阻塞（数据正确性 + 核心链路） |
| P1 | 9 | 单一事实来源、双 data、死代码 | 半阻塞（可维护性） |
| P2 | 5 | arXiv/分段/权重文档/依赖 | 不阻塞 |
| P3 | 3 | 硬编码路径、HTTP 风格、mock 翻译 | 不阻塞 |
