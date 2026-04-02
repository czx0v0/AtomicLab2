# Changelog (Docs Scope)

本文件聚焦 `modelspace-deploy` 的阶段性能力演进，采用“主题+影响面”记录方式。

## 2026-03（当前阶段）

### Added

- **解析大纲按文献缓存（冲刺二）**
  - Zustand：`parseCacheByDocId` 按 `doc_id` 存储 `parsedSections` + `parsedMarkdown` + `parsedDocName`；`setPdfUrl` / `setPdfFile` 切换前写入上一篇快照，切换后从缓存恢复，大纲与 Markdown 正文一致「秒开」
  - `resetParseUiState`：仅重置解析 Loading/日志；`startOver` 时 **`parseCacheByDocId` 整表清空**，避免会话间串台
  - 本地上传：`uploadDocument` 完成后再 `setPdfUrl` 并开始 `parsePDF`，保证流式解析阶段 `activeDocId` 有效、缓存写入正确
  - ArXiv 打开：`activeDocId` 使用 `arxiv_${id}`，与文献库切换一致

- **Organize · 发现（ArXiv 学术秘书）体验**
  - 中日韩关键词/研究目标在检索前经 `POST /api/translate` 自动译为英文，提高 arXiv API 命中率；界面可提示「已转为英文检索词」
  - 与收件箱、关键词记忆（`last_keyword` / `last_research_goal`）联动不变

- **任务控制中心（Mission Control）与主界面联动**
  - 时间线阶段可点击：**Plan** → Organize「卡片」、**Reading** → Organize「发现」、**Drafting** → 写作视图、**Reviewing** → 打开助手并预填「模拟同行评审」提示、**Submitted** → 卡片、**Rebuttal** → 写作 + 助手预填返修提示
  - Zustand：`pendingOrganizeTab`（切换 Organize 子 Tab）、`pendingChatQuestion`（助手输入框预填），由 `MissionControlFab` 写入，`MiddleColumn` / `CopilotSidebar` 消费

- **助手消息渲染**
  - 助手回复统一走 `MarkdownRenderer` + KaTeX（表格 GFM、公式等）；`[1]` 类引用可点击跳转知识来源；块级容器避免表格被错误包在 `<p>` 内

- **环境与路径治理**
  - 新增统一路径模块，支持本地与创空间环境自适应
  - 替换关键硬编码路径，降低部署漂移风险

- **全局 Demo 单例加载**
  - `demo` 文档改为全局唯一 `doc_id` 管理
  - 首次解析后缓存复用，后续会话按需挂载，避免重复解析

- **Organize 全局视角**
  - 支持全局/当前文献双视角切换
  - 三元组增加来源文献信息，支持回跳
  - 全局图谱 Top-N 截断，降低前端 OOM 风险

- **写作舱能力升级**
  - Write 侧边栏重构为 `Notes / Atomic / Graph` 三 Tab
  - Sticky 搜索栏支持当前 Tab 局部过滤
  - 卡片/原子知识/知识树节点支持一键注入正文

- **Agent Action Space**
  - 新增 `update_markdown_editor` 工具调用协议
  - SSE 新增 `action` 事件，实现“聊天 -> 编辑器”直接写入

- **搜索闭环交互**
  - 全局搜索结果下拉面板
  - 点击结果可自动跳转阅读视图、翻页并高亮
  - 聊天引用 `[1]` 与来源卡片复用同一跳转逻辑

- **RLHF 数据回流**
  - 聊天气泡新增点赞/点踩
  - 新增反馈 API 与本地异步日志记录

- **ArXiv 学术追踪秘书**
  - 后端：`arxiv_secretary` 服务（最新提交检索 + DeepSeek 摘要过滤 + 收件箱 JSON）
  - Agent 工具：`fetch_arxiv_recommendations`
  - 前端：Organize **📥 发现** Tab，关键词/课题配置，推荐卡片与「纳入我的知识库」

- **LaTeX 导出闭环**
  - `service/latex_exporter.py`：Markdown → IEEEtran（DeepSeek）、卡片 ID → Crossref → `references.bib`
  - `POST /api/export/latex_zip` 下载 ZIP；`POST /api/export/debug_latex` 报错分析
  - Agent 工具：`export_latex`、`debug_latex_error`；Write 工具栏 **📥 导出为 LaTeX 项目**

### Changed

- 聊天区样式：`index.css` 等补充「聊天内表格/公式」可读性（`.chat-synth-md`、`.cited-md-part` 等）

- Chat Router 从“强制检索优先”改为“意图解耦”
  - 文献细节问题：优先本地证据并引用
  - 通用概念/写作指令：允许常识回答或直接执行动作

- Markdown 渲染统一
  - 表格（GFM）与 Base64 图片显示策略集中管理

### Fixed

- 修复 Demo 重复解析与加载超时链路问题
- 修复 `DocumentRAG.reset` 缺失导致的重置告警
- 修复写作/阅读跨视图 PDF 页码状态不一致导致的体验抖动

### Added（2026-03 末 · 助手连接感与流式体验）

- **顶栏 Agent 轻量 HUD**（`App.jsx` → `AgentPipelineHud`）：非 Zen 模式下展示连接/流式状态，与对话区解耦，避免「只有转圈、不知道在做什么」
- **Zustand**：`agentStreamActive` / `setAgentStreamActive`，与 `isAgentThinking` 分工——流式首包到达即结束「全局思考」占位，流式生命周期由 `agentStreamActive` 跟踪；`startOver` 时一并重置
- **MiddleColumn / CopilotSidebar**：发送时置 `agentStreamActive`；首个 SSE 事件即 `setAgentThinking(false)`；`finally` 结束流式标记；`ChatMessage` 在 SYNTHESIZER 正文仍为空时显示「正在生成回答…」占位（避免空气泡）
- **`/help`**：固定文案补充「顶栏 Agent」说明（`frontend/src/lib/assistantHelp.js`）

### Fixed（2026-03 末）

- 修复流式开始时 **SYNTHESIZER_BOT** 气泡空白、同时底部仍显示「思考/加载」的重复体验

## 2026-04（文献切换与图谱一致性）

### Added

- **文献库「重解析」入口**
  - 本地文献新增手动重解析按钮：清理该文献本地解析缓存后重新触发解析，便于修复异常状态
- **Notes 幂等写入 API**
  - 新增 `PUT /api/notes/upsert`，按 `client_id + doc_id + source` 幂等更新/创建，避免 Demo 种子与重复交互造成笔记膨胀

### Changed

- **本地缓存范围扩展**
  - IndexedDB `localDocumentStore` 从仅缓存 `highlights/notes` 扩展为同时缓存 `markdown/sections/docName`
  - 文献切换时优先恢复本地解析结果，减少重复请求 MinerU
- **文档索引 doc_id 对齐**
  - 上传文献后 `indexDocument` 使用真实 `doc.id`，修复 Organize 图谱中 section/note 缺失

### Fixed

- 修复切换文献后可能重复触发 MinerU 解析的问题
- 修复新上传文献在 Organize 图谱缺少 section 节点的问题
- 修复 Demo 种子笔记与图谱不同步的问题（支持后端 upsert 同步）
- 修复 `index-document` 与 `notes` 并发场景下的部分竞态风险（加入进程内锁）

## 后续计划（建议）

- 反馈日志改为 JSONL 逐行追加，便于离线训练样本抽取
- 为写作工具调用增加 `target` 粒度（selection/cursor/document_end）
- 继续压缩前端主包体积，优化移动端首屏加载
