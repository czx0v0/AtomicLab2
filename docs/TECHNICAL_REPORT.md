# AtomicLab 技术说明报告（双视角）

## 1. 报告目的

本文从两个角色视角说明当前系统：

- 产品经理视角：为什么这样设计，用户价值是什么
- 大模型算法工程师视角：核心算法链路、工程实现与风险控制

---

## 2. 产品经理视角

### 2.1 产品定位

AtomicLab 是一个“阅读-整理-写作”一体化学术工作台，目标是把用户从“碎片阅读”提升到“结构化输出”。

核心价值：

1. 把 PDF 内容转为可检索、可关联、可注入的知识资产
2. 把聊天助手从“回答器”升级为“可执行写作动作的 Agent”
3. 把写作从“空白页创作”升级为“基于知识地图的连续创作”

### 2.2 关键用户旅程

#### 旅程 A：阅读吸收

- 用户上传/加载文献
- 系统解析结构并生成基础卡片与原子知识
- 用户可划词高亮、生成卡片、问 AI

#### 旅程 B：知识组织

- 用户进入 Organize 查看知识树/图谱/三元组
- 在全局视角中发现跨文献关联
- 在局部视角中聚焦单篇精读
- 在 **发现** Tab 中检索 ArXiv / 秘书收件箱；若输入为中日韩，系统会先调用翻译服务再检索，以提升英文论文库命中率

#### 旅程 C：沉浸写作

- 用户在 Write 打开资源面板（Notes/Atomic/Graph）
- 搜索并浏览知识片段，点击“+ 插入正文”
- 通过 Agent 指令直接生成或润色并写入编辑器

### 2.3 体验闭环设计

闭环 = 找得到 + 跳得准 + 写得快

- 找得到：混合检索与局部搜索（减少“找不到素材”）
- 跳得准：点击结果/引用直达页码并高亮（减少“定位成本”）
- 写得快：卡片一键注入 + 工具调用写入编辑器（减少“搬运成本”）

### 2.4 核心功能拆解（当前版）

- 检索层：向量/BM25/图谱混合召回
- 组织层：全局/局部图谱与三元组
- 写作层：写作舱三视图 + 一键注入
- 代理层：Router 决策 + Tool Calling 执行
- 反馈层：点赞/点踩 + 反馈日志
- 学术秘书与发现：ArXiv 检索 + 收件箱；CJK 查询自动英译后再请求
- 进度与任务：Mission Control 时间线可跳转到 Organize 子页、写作或助手（预填评审/返修类长提示）
- 助手呈现：Markdown + 数学公式 + 表格；引用编号可点击跳转
- **连接感与流式反馈**：非 Zen 模式下顶栏 **AgentPipelineHud** 展示连接/流式状态；对话区在合成器首包未到时显示占位文案，避免「空白气泡 + 底部加载」重复

### 2.5 当前风险与产品建议

- 风险 1：检索命中后文献跳转准确度受 `doc_id` 完整性影响  
  建议：继续补齐历史数据中的 `doc_id` 与来源字段

- 风险 2：功能密度高，新用户学习曲线偏陡  
  建议：增加“新手引导模式”和“场景化模板”

- 风险 3：长时间写作场景中包体较大影响流畅度  
  建议：分包与懒加载，优先保证写作主链路性能

---

## 3. 大模型算法工程师视角

### 3.1 系统总体架构

可抽象为 5 层：

1. **Ingestion 层**：PDF 解析、切块、结构化摘要
2. **Index 层**：Chroma 向量索引 + BM25 关键词索引 + 图谱关系
3. **Retrieval 层**：多通道召回 + 多轮扩展 + RRF 融合
4. **Agent 层**：Router 决策、Synthesizer 生成、Tool Calling 执行
5. **Interaction 层**：SSE 流式传输、前端状态机、跳转高亮与写作注入

**双库与本地状态（补充）**：向量索引（Chroma 等）专注分块与 Embedding 语义检索；结构化关联与隐私数据（如按 `doc_id` 的高亮/截图、解析大纲快照）放在浏览器 IndexedDB 与 Zustand 的 `parseCacheByDocId` 等，**不**将此类元数据混入向量集合，便于合规与排障。

### 3.2 检索算法链路（Hybrid Search）

当前检索采用“通道并行 + RRF 融合”：

- 文档向量检索（DocumentRAG）
- 文档 BM25 检索
- 笔记向量检索（NoteRAG）
- 笔记 BM25 检索
- 图谱 1-hop 扩展
- 截图 OCR 文本召回（可用时）

融合策略：

- 每通道分配权重（文档原文通道权重更高）
- 使用加权 RRF 融合不同排序列表
- 结合原始分数进行二次融合

收益：

- 兼顾语义召回与关键词精准
- 降低单通道失效导致的空检索

### 3.3 Router 与提示词策略

当前采用“意图解耦”的路由规则：

- **研究细节问题**：优先本地证据，必要时补外部检索，并给引用
- **通用概念/闲聊/写作指令**：允许常识回答或直接执行动作
- **禁止暴露底层检索细节**：防止用户感知“系统僵硬”

当本地证据不足时，采用优雅降级文本，避免硬拒答。

### 3.4 Tool Calling：写作动作空间

已定义写作工具函数：

- `update_markdown_editor(action_type, content)`
  - `action_type`: `append` | `replace` | `insert`
  - `content`: Markdown 正文

执行路径：

1. Router/Planner 识别写作意图
2. 触发 function call 生成动作参数
3. 后端通过 SSE `action` 事件下发
4. 前端消费动作并写入编辑器状态

该设计把“LLM 输出文本”升级为“LLM 执行动作”，本质是将对话转化为可控状态迁移。

### 3.5 数据模型与关键字段

检索结果建议统一字段：

- `note_id`
- `doc_id`
- `doc_title`
- `page_num`
- `bbox`
- `source`
- `score`

说明：

- `doc_id/page_num/bbox` 决定跳转与高亮的可执行性
- `source` 决定标签展示与调试可观察性
- `score` 用于前端排序与可解释反馈

### 3.6 前端状态机与交互协议

关键状态（Zustand）：

- 阅读状态：`pdfUrl`, `activeDocId`, `currentPage`, `activeReference`
- 检索状态：`searchQuery`, `searchStatus`, `searchResults`
- 写作状态：`markdownContent`, `pendingInsert`, `pendingEditorAction`
- 助手状态：`messages`, `contextAttachment`, `copilotOpen`
- 跨视图协作：`pendingOrganizeTab`（打开 Organize 后切换到指定子 Tab，如 `inbox` / `deck`）、`pendingChatQuestion`（助手输入框一次性预填，由 Mission Control 等场景写入）
- **流式与思考占位**：`isAgentThinking` 表示「等待首包/连接阶段」的轻量全局提示；`agentStreamActive` 表示 SSE 流式进行中。首条 SSE 事件到达后应置 `isAgentThinking` 为 false，避免与 SYNTHESIZER 气泡内占位重复；流结束在 `finally` 中清除 `agentStreamActive`

助手消息渲染：助手侧内容经 `renderCitedContent` 拆分 `[n]` 引用与正文段落，正文段落使用 `MarkdownRenderer`（含 KaTeX），避免块级元素（如表格）非法嵌套在段落内。

SSE 事件协议（建议持续稳定）：

- `step`：过程状态
- `delta`：流式 token
- `action`：工具动作（前端执行）
- `done`：结束与 sources

### 3.7 可观测性与评估指标

建议持续跟踪：

- 检索链路
  - 命中率（Top-K）
  - 空检索率
  - 引用可跳转率（含页码与 bbox）

- 交互链路
  - 搜索结果点击率
  - 跳转成功率
  - 一键注入使用率

- 生成链路
  - Tool Calling 触发率
  - 动作执行成功率
  - 用户反馈正负比（RLHF）

#### 3.7.1 离线 RAG 批量评测（`scripts/eval/run_evaluation.py`）

- **用途**：对本地可访问的 `POST /api/chat`（默认 `--chat-url http://localhost:8000/api/chat`）批量跑题集，用 **DeepSeek** 裁判模型对每题输出结构化分数并写入 CSV；运行结束在终端打印 **Evaluation Summary**（Markdown 表）。
- **指标（与脚本内 `JUDGE_SYSTEM_PROMPT` 一致）**
  - `context_precision`：0 或 1，仅当检索到的 `retrieved_contexts` 对回答关键事实形成直接支持时为 1
  - `faithfulness`：0–1，衡量 `answer` 是否忠于 `retrieved_contexts`（不允许凭常识补全）
- **落盘**：`--report` 指定的 CSV（默认同目录 `evaluation_report.csv`），列见脚本 `CSV_FIELDNAMES`（含 `context_precision`、`faithfulness`、`judge_reason` 等）。
- **汇总规则**：`_print_markdown_summary` 按 **`question` 去重**，同一题多行时**仅最后一行**参与统计；按 `type` 分桶输出 `n`、`context_precision_avg`、`faithfulness_avg`，并给出 **overall** 行。
- **依赖**：环境变量 `DEEPSEEK_API_KEY`（裁判）；**服务端口**需与 `--chat-url` 一致（本地 `app.py` 默认 `UVICORN_PORT=7860` 时勿误用 8000）。
- **运行说明**：[`scripts/eval/README.md`](../scripts/eval/README.md)

### 3.8 已知技术债

- 前端存在历史 TS 诊断噪声（不阻塞构建，但影响类型健康）
- 检索来源字段在历史数据中不完全一致
- 全局图谱规模扩大后仍需更细粒度采样与缓存策略

### 3.9 下一阶段技术建议

1. 反馈日志升级为 JSONL（便于增量抽样训练）
2. Router 增加轻量意图分类器与置信度阈值
3. 构建“检索-引用-跳转”端到端回归测试
4. 增加写作动作 `target` 维度（selection/cursor/end）
5. 引入分层缓存（检索结果缓存 + 图谱子图缓存）

---

## 4. 结论

当前版本已形成从“知识获取”到“结构化写作”的主链路闭环，且具备向 Agent 原生写作平台演进的基础能力。  
后续重点应放在：稳定性、可观测性、与可训练数据沉淀三条线上并行推进。
