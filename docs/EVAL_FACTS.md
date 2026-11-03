# 评测数据事实卡（统一口径 · 基于真实评测结果）

> 整理日期：2026-10-27
> 本文件所有数字均来自仓库内真实评测产物（metrics.json / 报告 markdown / 脚本），无任何编造。每个表格标注来源文件。
> 用途：面试答辩、简历改写、对外口径统一。**改简历前先读 §0。**

---

## 0. 阅读须知（最重要，先看这里）

### 0.1 你简历里两个数字的真实含义（口径陷阱）

你当前简历写「单步问答准确率 72%、忠实度 90.6%」，这两个数字来自早期产物 [metrics.json](scripts/eval/metrics.json)（源 `evaluation_report.csv`），但**口径有问题**：

| 简历说法 | 实际文件值 | 真实含义 | 结论 |
|---|---|---|---|
| 单步准确率 72% | `single-hop.accuracy_cp_pct = 72.0` | **上下文精度（context precision，检索证据支撑度）**，不是答案正确率 | ❌ 误当成"准确率" |
| 忠实度 90.6% | `overall.faithfulness_avg_pct = 90.6` | 生成忠实度（faithfulness） | ⚠️ 是旧 pypdf 污染库口径 |

> 出处：[EVAL_GUIDE.md](scripts/eval/EVAL_GUIDE.md#L23) 明确写「旧版 `accuracy_cp_pct`（曾对外称"准确率 72%"）实为『上下文精度』，不是答案正确性；`faithfulness 90.6%` 才是真实忠实度」；[RESULTS_REPORT.md](scripts/eval/RESULTS_REPORT.md#L72) 亦写「`单跳准确率 72%` 实为旧版『上下文精度』口径（非答案正确率）；`忠实度 90.6%` 是旧污染库口径」。

**→ 正确做法**：对外统一用下面的新口径（qwen3.8-flash + MinerU + 纯 RRF），"准确率"一律指 `correctness`（答案正确性）。

### 0.2 权威口径声明（最终版本）

| 项 | 值 |
|---|---|
| 考生模型 | qwen3.8-flash（aliyun DashScope，= 部署模型） |
| 裁判模型 | deepseek-reasoner（R1，`response_format=json_object`） |
| 知识库解析 | MinerU（已替代 pypdf） |
| 融合算法 | 纯 RRF（已修复 original_score 混分问题） |
| 数据集 | 100 条学术 QA，4 类各 25 |

---

## 1. 评测体系设计

### 1.1 数据集

[dataset.json](scripts/eval/dataset.json)，100 条学术 QA，四类各 25：

| 题型 | 隔离库 | 说明 |
|---|---|---|
| single-hop（单跳） | single（1 篇：Attention Is All You Need） | 单篇事实问答 |
| multi-hop（多跳） | multi（3 篇：Transformer + Ying Graph-Transformer + ViT） | 跨篇证据链 |
| comparative（对比） | multi（同上） | 跨论文抽象对比 |
| adversarial（对抗） | multi（同上） | 「文献未提及」抗幻觉陷阱题 |

**ground_truth 标注**：事实题给精确答案（含数值/公式，平均 117 字符，最短 4、最长 322）；adversarial 题 25/25 的 ground_truth 均为「文献未提及」。

**adversarial 设计意图**：故意问论文**不存在的概念**（自适应注意力跨度 / 谱注意力机制 / 模型剪枝 / 可微分图池化），测试模型诚实拒答而非编造（抗幻觉）。

> 出处：[EVAL_GUIDE.md](scripts/eval/EVAL_GUIDE.md#L111)、[ACADEMIC_REPORT.md](scripts/eval/ACADEMIC_REPORT.md#L63)。

### 1.2 指标定义（RAGAS 风格四层拆解）

主指标是 **correctness** 与 **hit@k**。出处：[EVAL_GUIDE.md](scripts/eval/EVAL_GUIDE.md#L9)、[compute_metrics.py](scripts/eval/compute_metrics.py#L136)。

| 指标 | 度量对象 | 回答的问题 |
|---|---|---|
| **correctness**（主） | answer vs ground_truth | 答对了吗 |
| hit@k（retrieval_hit） | retrieved_contexts vs ground_truth | 检索命中核心事实吗 |
| context_precision | retrieved_contexts vs answer | 检索证据有用吗 |
| context_recall | retrieved_contexts vs ground_truth | 关键事实召回了吗 |
| faithfulness | answer vs retrieved_contexts | 答案忠于证据吗 |
| hallucination | answer vs (contexts ∪ ground_truth) | 编造断言了吗 |
| citation_accuracy | answer 角标 [n] vs 证据 | 引用真实支撑吗 |
| em / token_f1 / rouge_l | 字面匹配 | 字符级重合 |

> 幻觉率口径：**有幻觉的题数 / 总题数**（不是句数）；faithfulness 是逐题 0~1 平均。出处：[INTERVIEW_QA.md](docs/INTERVIEW_QA.md#L78)。

### 1.3 评测模式（direct vs http）

| mode | 是否起后端 | 测什么 |
|---|---|---|
| direct | 否（进程内直连 `_search_pipeline` + 合成） | 干净检索管线（选型/消融/hit@k，**推荐**） |
| http | 是（打 /api/chat） | 完整生产链路（Router FC + 多 agent + arXiv + merge） |

> 出处：[EVAL_GUIDE.md](scripts/eval/EVAL_GUIDE.md#L174)。

---

## 2. 最终结果（权威口径：qwen3.8-flash + MinerU + 纯 RRF）

### 2.1 分题型正确率（按题型最优 Seeker 配置，align10）

| 题型 | 最优 Seeker | FC 迭代 | correctness | 幻觉率 |
|---|---:|---:|---:|---:|
| single-hop | LLM（语义改写） | 1 | **97.0%** | 4% |
| multi-hop | regex（关键词覆盖） | 2 | **68.6%** | 20% |
| comparative | regex | 2 | **49.6%** | 12% |
| adversarial | LLM | 1 | **100.0%** | 0% |

> 出处：[MULTIAGENT_EVAL_ABLATION.md](docs/MULTIAGENT_EVAL_ABLATION.md#L26) §2 与 §5。题型相关结论：single 用 LLM（+4.2 vs regex）；multi/comp 用 regex（+16 / +2.6）；adv 持平。

### 2.2 混合检索 vs 纯向量检索（核心卖点）

| 题型 | 纯向量 | 混合检索（按题型最优） | Δ |
|---|---:|---:|---:|
| single-hop | 86.0 | 86.4 | +0.4 |
| multi-hop | 41.8 | **54.28** | **+12.5** |
| comparative | 37.8 | **47.2** | **+9.4** |
| adversarial | 98.8 | 97.6 | −1.2 |
| **100 题平均** | 66.1 | **71.4** | **+5.3** |

> 出处：[two_group_report.md](reports/two_group_report.md#L25)、[RESUME.md](scripts/eval/RESUME.md#L19)。结论：混合检索收益集中在**多跳 / 对比**两类难题；单跳本就简单，基本持平。

### 2.3 Multi-Agent 链路消融（full vs retrieval_only）

| 题型 | retrieval_only（纯检索+合成） | full（Router→Seeker→Reviewer→Synthesizer） | Δ | 幻觉率变化 |
|---|---:|---:|---:|---|
| single-hop | 80.8% | **93.6%** | **+12.8** | 4% → 0% |
| multi-hop | 36.4% | **51.28%** | **+14.9** | 36% → 20% |

> 出处：[RESUME.md](scripts/eval/RESUME.md#L15)、[regex_vs_llm.md](scripts/eval/regex_vs_llm.md#L92)。对应 run：`single_agent_full_qwen38`=93.60 / `single_agent_retrieval_only_qwen38`=80.80；`multi_agent_full_qwen38`=51.28 / `multi_agent_retrieval_only_qwen38`=36.40。

### 2.4 分块长度消融（single-hop）

| chunk | correctness |
|---:|---:|
| 400 | 46.4% |
| **800** | **82.0%** |
| 1200 | 73.2% |

> 出处：[RESULTS_REPORT.md](scripts/eval/RESULTS_REPORT.md#L68)、[regex_vs_llm.md](scripts/eval/regex_vs_llm.md#L27)。结论：800 字为甜点；400 切太碎丢上下文，1200 引入噪声。

### 2.5 重排序消融（**负结果**）

| 对比 | correctness 变化 | 结论 |
|---|---|---|
| multi：full 36.8 → +cross_encoder 30.6 | **−6.2** | ❌ 变差 |
| comparative：full 35.6 → +cross_encoder 24.4 | **−11.2** | ❌ 明显变差 |
| comparative（新版）：full 47.2 → cross_encoder 36.0 | **−11.2** | ❌ 任何权重都害 |
| multi（新版）：BM25 1.5 + rerank | **+11.88** | ✅ 仅此组合帮 |

> 出处：[RESULTS_REPORT.md](scripts/eval/RESULTS_REPORT.md#L36)、[two_group_report.md](reports/two_group_report.md#L51)。根因「语义相似度 ≠ 答案相关度」；cross-encoder 擅长单段相关性，理解不了跨篇证据链。**最优策略是按题型路由**（multi 用 BM25 1.5 + rerank，comp 用 BM25 0.5 且无重排）。

---

## 3. 多维质量指标（最新，按题型最优配置）

| 题型 | correctness | hit@k | faithfulness | 幻觉率 | 引用准确率 | ctx_prec | ctx_recall |
|---|---:|---:|---:|---:|---:|---:|---:|
| single-hop | 97.0 | 96.0 | 98.4 | 4.0 | 100 | 100 | 96.6 |
| multi-hop | 52.6 | 52.0 | 84.0 | 8.0 | 96.9 | 68.0 | 51.8 |
| comparative | 47.0 | 32.0 | 88.6 | 16.0 | 100 | 72.0 | 41.4 |
| adversarial | 100.0 | 56.0 | 86.2 | 0.0 | 98.8 | 60.0 | 56.0 |

> 出处：四个 `eval_*_llm_topk10_qwen38.metrics.json`（[single](scripts/eval/eval_single_llm_topk10_qwen38.metrics.json) / [multi](scripts/eval/eval_multi_llm_topk10_qwen38.metrics.json) / [comp](scripts/eval/eval_comp_llm_topk10_qwen38.metrics.json) / [adv](scripts/eval/eval_adv_llm_topk10_qwen38.metrics.json)）。
> ⚠️ 上表是「LLM 关键词扩展」口径；multi/comp 的**最优**正确率（regex 口径）见 §2.1（68.6% / 49.6%），此处仅为多维指标完整性列示。

---

## 4. 诚实边界（面试/对外别踩雷）

1. **样本量小**：n=25/题型，95% CI ≈ **±9pt**（连续分布 std/√n，非二项 ±19pt）。多跳 +12.5、对比 +9.4 是**方向性/边际显著**，未达严格统计显著（扩题 n≥50 或多 seed 才坐实）。
2. **幻觉率不是 <5%**：regex 最优口径 single 4% / multi 20% / comp 12% / adv 0%。
3. **评测库只有文档分块**（chroma + BM25），无笔记/图谱 → `full` 的收益 = **BM25 词法召回**的贡献，不是图谱扩展的贡献（图谱生产已实现、评测未覆盖）。
4. **Reviewer 门控在 spec 里规划、未落地代码**；Human-in-the-loop 未实现。
5. **「旧版 +16.6pt 是假象」**：deepseek-chat 背过论文凭记忆作答 + pypdf 库残缺，检索没召回也能答对；新版 MinerU + qwen3.8 + 纯 RRF 修复后才是真实值。

> 出处：[INTERVIEW_QA.md](docs/INTERVIEW_QA.md#L145) §7、[two_group_report.md](reports/two_group_report.md#L46)、[ACADEMIC_REPORT.md](scripts/eval/ACADEMIC_REPORT.md#L74)。

---

## 5. 简历建议表述（替换旧句）

> 旧句：单步问答准确率 72%、忠实度 90.6%。

建议改为：

> 自建 100 条学术 QA 评测集（single/multi/comparative/adversarial 各 25）与 RAGAS 风格多维自动评测流水线（correctness / hit@k / faithfulness / hallucination / citation accuracy，95% CI）。混合检索（向量 + BM25 多路召回 → RRF 融合）较纯向量检索在 100 题上正确率 66.1%→71.4%，其中多跳问答提升 12.5pt、对比类提升 9.4pt；Multi-Agent 链路（Router→Seeker→Reviewer→Synthesizer）较纯检索+合成在单跳提升 12.8pt（80.8%→93.6%）、多跳提升 14.9pt，单跳正确率 97.0%、幻觉率 4%。

若需更保守（规避 CI 重叠），把「提升 X 个百分点」改为「在评测集上观察到 X 个百分点的方向性提升（n=25）」。

---

## 6. 数据来源清单

| 事实 | 来源文件 |
|---|---|
| 指标定义 / 口径陷阱（72% 真相） | [EVAL_GUIDE.md](scripts/eval/EVAL_GUIDE.md)、[compute_metrics.py](scripts/eval/compute_metrics.py) |
| 分题型最优（regex vs llm） | [MULTIAGENT_EVAL_ABLATION.md](docs/MULTIAGENT_EVAL_ABLATION.md) |
| 混合 vs 向量对比（新版） | [two_group_report.md](reports/two_group_report.md)、[RESUME.md](scripts/eval/RESUME.md) |
| Multi-Agent 消融 | [RESUME.md](scripts/eval/RESUME.md)、[regex_vs_llm.md](scripts/eval/regex_vs_llm.md) |
| 分块 / 重排消融 | [RESULTS_REPORT.md](scripts/eval/RESULTS_REPORT.md)、[two_group_report.md](reports/two_group_report.md) |
| 多维指标 | `eval_*_llm_topk10_qwen38.metrics.json` |
| 诚实边界 / 幻觉率 | [INTERVIEW_QA.md](docs/INTERVIEW_QA.md) |
| 系统架构 / 检索管线 | [ACADEMIC_REPORT.md](scripts/eval/ACADEMIC_REPORT.md)、[DEPLOYMENT.md](docs/DEPLOYMENT.md) |
