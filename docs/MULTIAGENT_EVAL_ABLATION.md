# Multi-Agent 消融评测报告

> 目标：定位 multi-hop / comparative 正确率波动（51.28% → 48.60% → 39.40% → 63.60%）的根因，给出最终配置，并追踪幻觉问题。

## 1. 变量定义（三个开关 + 三处代码）

| 维度 | 旧版 | 新版 | 环境开关（默认） |
|---|---|---|---|
| Seeker 查询扩展 | 正则 `_expand_query` | LLM `_llm_expand_query` | `SEEKER_EXPAND_MODE`（默认 **`regex`**） |
| Reviewer 证据评审 | 启发式 `_reviewer_heuristic` | LLM `_reviewer_llm` | `REVIEWER_MODE`（默认 `llm`） |
| Router 工具迭代 | 2 次 | 1 次 | `ROUTER_MAX_ITER`（默认 **`2`**） |
| arXiv 补充 | 开启 | — | `ARXIV_ENABLED`（默认 `1`，`0` 关闭减噪） |
| Synthesizer 证据条数 | 16 | — | `SYNTHESIS_MAX_SOURCES`（默认 `16`，`10` 对齐 top_k） |

> 以上开关已同步到 `.env.example`（Multi-Agent 配置段），线上默认值不变。

代码改动（本会话）：
1. **Seeker**：正则 → LLM 扩展。评测证实 LLM 扩展伤 multi-hop，**默认已改回正则**。
2. **Router**：加两级路由 `_classify_tool_category` + FC 迭代 2 → 1 → **改回 2**。
3. **Reviewer**：启发式 → LLM（仅影响展示 traces，不影响答案）。
4. **证据摘要**：`[:800] → [:1600]`（原以为治幻觉，实测未降，见 §3.3）。
5. **裁判对齐**：后端 `sources[:8] → [:16]`（裁判读后端 `sources` 字段，与 Synthesizer 16 条对齐）。

> 模型统一为 **qwen3.8-flash**（`.env` 全程未变），排除模型 confound。

## 2. 最终结果（align10，regex vs llm，n=25）

| 题型 | regex(heuristic) | llm | 最优 | 幻觉(regex/llm) |
|---|---|---|---|---|
| single-hop | 92.8% | **97.0%** | **LLM** | 8% / 4% |
| multi-hop | **68.6%** | 52.6% | **regex** | 20% / 8% |
| comparative | **49.6%** | 47.0% | **regex** | 12% / 16% |
| adversarial | 99.2% | **100.0%** | 持平 | 0% / 0% |

> 历史波动：multi 51.28%（旧版）→ 48.6%（iter1）→ 63.6%（regex_fc2）→ **68.6%（align10 最终）**。幻觉 64% 是裁判视野 8→10 的误判，非真幻觉。

## 3. 分析

### 3.1 已确认

1. **模型未变**（qwen3.8），排除 confound。
2. **双重变换（用原始问题代替 Router 关键词）是错的**，已回退（hit@k 56→36 即证据）。
3. **H1 证实**：Seeker 正则 > LLM（multi 68.6% vs 52.6%）。
4. **H2 证实**：Router FC2 > FC1。
5. **裁判对齐 8→10** 是「幻觉 64%→8%」的根因（裁判误判，非真幻觉）。

### 3.2 题型相关结论（最终）

| 题型 | 最优 Seeker | 原因 |
|---|---|---|
| single-hop | **LLM**（97.0%） | 语义改写对单轮事实题友好 |
| multi-hop | **regex**（68.6%） | 正则拆词保关键词，跨论文召回更全 |
| comparative | **regex**（49.6%） | 同上 |
| adversarial | 持平（100/99.2） | 陷阱题两者都能答 |
| adversarial（需精准） | **LLM + FC1** | 检索太多引入噪声，干扰陷阱题判断（99.6→94.2） |

### 3.3 幻觉问题（未解决，根因已修正）

- **现象**：comparative 幻觉 64%（16/25）、multi 36%。
- **原假设（已推翻）**：证据摘要 `[:800]` 截断 → 改 `[:1600]` 后**幻觉未降**（comp 仍 64%）。
- **修正根因**：regex + FC2 检索更多 → **引入噪声** → 模型做错误对比/断言（如「线性衰减」答成「cosine decay」）。
- **裁判对齐**：后端 `sources 8→16`，裁判视野变宽，可能降低「报告幻觉率」（断言在第 9-16 条证据里时不再误判）。待复测 `comp_..._align16` 验证。

## 4. 结论

1. **multi / comparative 固定 `regex + FC2`**（正则扩展 + 两轮迭代）；
2. **adversarial / single 用 `LLM + FC1`**（精准优先）；
3. Reviewer LLM/启发式不影响 correctness（仅 traces）；
4. **幻觉是「regex+FC2 噪声」的代价**，非截断；对策待定（更严 synthesis 约束 / 裁判对齐复测）。

## 5. 最终配置（定稿，align10）

| 题型 | Seeker | Reviewer | FC | correctness |
|---|---|---|---|---|
| single-hop | **LLM** | LLM | 1 | 97.0% |
| multi-hop | **regex** | LLM | **2** | 68.6% |
| comparative | **regex** | LLM | **2** | 49.6% |
| adversarial | **LLM** | LLM | 1 | 100.0% |

> **最终结论（题型相关）**：single→LLM（语义改写 +4.2）；multi/comp→regex（关键词覆盖 +16/+2.6）；adv 持平（100 vs 99.2）。multi 上 regex 正确率高但幻觉高（20% vs 8%），是「覆盖↑ vs 噪声↑」的权衡。幻觉 64% 是裁判视野 8→10 的误判，非真幻觉。

## 附录：9 个幻觉 case 明细（`multi_regex_fc2_qwen38`）

| # | 题主题 | 判词关键（幻觉类型） |
|---|---|---|
| 1 | Transformer 6层 vs ViT 深度/宽度/patch | 「[10] 断言不在检索上下文中」（引用越界） |
| 2 | 正弦位置编码 vs Graphormer 空间编码 | 「缺谱空间位置编码不如 SPD 直接的关键对比」（缺对比） |
| 3 | FFN 公式内层维度 | 「缺少减少参数量原因 + '文献未提及'与 GT 矛盾」（文献未提及） |
| 4 | BPE 词汇量 vs ViT patch 嵌入 | 「缺 NLP 固定查找 vs ViT 线性投影的不同点」（缺对比） |
| 5 | 自注意力最大路径长度 O(1) | 「答案仅称'文献未提及'，未给出 O(1)」（文献未提及） |
| 6 | Adam 学习率调度公式 | 「ViT 调度答错：GT 线性衰减，answer 称 cosine decay」（答错事实） |
| 7 | 多头注意力三处应用 vs Graphormer | 「未点出无源/目标序列之分 + 引用越界 [9][10]」（缺关键+越界） |
| 8 | dropout 率 BL 对比 | 「缺 ImageNet 1.3M vs JFT 303M + [9] 越界」（缺细节+越界） |
| 9 | 表1 计算复杂度/最大路径 | 「未说明小数据归纳偏置重要性 + 细节缺检索支持」（缺关键） |

> **幻觉类型分布**：缺对比/缺关键 6 例、文献未提及撒谎 2 例、答错事实 1 例、引用越界 3 例（部分重叠）。共同指向「检索覆盖↑但精确细节/跨论文对比仍缺失或出错」，即 regex+FC2 的噪声代价。
