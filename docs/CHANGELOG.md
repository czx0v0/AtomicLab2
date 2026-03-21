# Changelog (Docs Scope)

本文件聚焦 `modelspace-deploy` 的阶段性能力演进，采用“主题+影响面”记录方式。

## 2026-03（当前阶段）

### Added

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

## 后续计划（建议）

- 反馈日志改为 JSONL 逐行追加，便于离线训练样本抽取
- 为写作工具调用增加 `target` 粒度（selection/cursor/document_end）
- 继续压缩前端主包体积，优化移动端首屏加载
