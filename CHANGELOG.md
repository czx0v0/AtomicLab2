# Changelog

## [0.3.2] - 2026-03-10

### Added

- 新增 `DocumentRAG`：解析后的 Markdown 自动切块入向量库。
- 新增 `POST /api/search/index-document`：前端上传解析结果后可直接入库。
- `/api/search` 升级为多路检索：`NoteRAG + DocumentRAG` 合并排序。
- MinerU SSE 新增 `chunk` 事件：分段输出章节文本与自动摘要。
- 新增 `summary` SSE 事件：章节摘要可由 LLM 流式增强。
- 新增文献文件管理 API：`/api/documents`（上传/列表/读取/删除）。
- 新增写作辅助 API：`/api/writing/assist`（错别字/病句/润色/续写）。
- Chat Seeker 新增多源检索：ArXiv + Semantic Scholar 来源融合。
- 检索 API 升级为三通道融合：关键词检索 + NoteRAG + DocumentRAG（RRF 融合）。
- 写作续写接入 RAG 上下文检索，并补充学术 API 证据来源标记。

### Changed

- 左栏 `章节+摘要` 由流式 section 数据驱动，支持更真实树状渲染。
- 上传新文献后，Markdown/章节视图与当前文献绑定，避免旧数据串文档。
- Zen 模式左侧新增原 PDF 参考面板，并保留卡片跳转工作流。
- 章节树节点支持点击跳页，并展示原子卡片数量与引用数量。
- 高亮坐标统一为归一化 bbox，减少缩放导致的偏移。
- 写作工具栏新增 H1/H2/H3 和 AI 写作增强按钮。
- 写作辅助从“直接替换”改为“任务卡模式”：进度条、完成说明、手动应用结果。
- 左栏解析状态新增进度条，可视化显示解析阶段。

### Fixed

- 选区工具栏在 Markdown/章节模式下可正常触发（不再仅限 PDF 模式）。
- 修复 PDF 文本层场景下选区工具栏偶发不弹出（改为 selectionchange + pointer 双触发路径）。

## [0.3.1] - 2026-03-10

### Fixed

- 修复 `.env` 未生效问题：`Aether-Engine/config/settings.py` 增加 `python-dotenv` 加载。
- 修复后端依赖缺失：补充 `chromadb`、`openai`、`httpx`，并在 `requirements.txt` 增加 `python-dotenv`。
- 修复聊天无限增长：前端消息数组限制为最近 80 条，新增手动清空按钮。
- 修复聊天引用不可交互：相关笔记 chip 现在可点击触发跳页/高亮。
- 修复 ArXiv 加库流程：点击论文后自动加入文献库并直接加载到阅读区。

### Changed

- 前端状态策略从「部分持久化」调整为「会话态」以避免 PDF 与其他状态不一致。
- 左栏新增内容视图切换：`PDF` / `Markdown` / `章节+摘要`。
- 上传 PDF 后自动触发 MinerU 解析，显示解析日志与 Markdown 结果。

### Notes

- 由于浏览器安全限制，本地上传的 PDF 刷新后无法恢复文件句柄；ArXiv URL 文献可重新加载。
- 完整文件资产管理（后端持久化文件仓库）计划在下一版本实现。

## [0.3.0] - 2026-03-10

### Added

- **中间栏全面重构 (MiddleColumn)**

  - 新增「原子卡片」与「知识图谱」双视图切换
  - ForceGraph2D 可视化，按笔记类型分组，关键词相连，点击节点跳转原文
  - 语义搜索进度可视化（分词 → 向量检索 → RRF 融合 → 完成）
  - 新增 ARXIV 模式：实时检索 ArXiv 论文，一键下载 PDF
- **富文本编辑器修复 (RightColumn)**

  - 修复选中文字后工具栏操作导致文字内容被替换的 Bug
  - 恢复 `wrapSelection`/`insertAtCursor` 正确处理选区
  - 新增 Zen Mode 全屏专注模式，内嵌 Pomodoro 番茄计时器（SVG 环形进度条）
  - 新增拖拽添加笔记引用的 BrainstormDrawer 侧边栏
  - 新增 Markdown 预览模式，页面链接点击跳转 PDF 对应页
  - 快捷键：Ctrl+B（加粗）、Ctrl+I（斜体）、Tab（缩进）、Esc（退出 Zen）
  - 新增导出 `.md` 文件，状态栏显示字数/字符数
- **本地存储 (Zustand Persist)**

  - 使用 `zustand/middleware` persist 持久化：笔记、Markdown 内容、高亮、视图模式、Pomodoro 计时
  - localStorage key: `atomiclab-storage`，聊天记录保留最近 50 条
- **后端引擎修复 (Aether-Engine)**

  - 修复运行后无任何输出的问题：新增 `LOGGING_CONFIG` + stdout StreamHandler
  - 新增 CORS 中间件，允许开发环境跨域调用
  - 启动时打印 Banner 提示访问地址
- **新增后端 API**

  - `GET/POST/DELETE /api/notes` — 原子笔记 CRUD（JSON 文件持久化）
  - `POST /api/search` — GraphRAG 语义检索（ChromaDB 向量 + 降级本地过滤）
  - `POST /api/translate` — DeepSeek 文本翻译（含 API Key 缺失降级处理）
  - `POST /api/arxiv/search` — ArXiv 论文检索
  - `GET /api/arxiv/download/{id}` — ArXiv PDF 代理下载
- **前端基础设施**

  - 新增 `src/api/client.js` 统一 API 层，封装所有 HTTP 调用
  - Vite 开发服务器新增 `/api` 反向代理到 `localhost:8000`
  - App 顶部新增后端连接状态指示（绿色/红色点，每 15 秒健康检查）
  - App 图标改为 base64 像素风 icon，导航栏新增 ARXIV 入口
  - ARXIV 视图模式下面板自动调整布局（左栏收起，中栏放大）

### Fixed

- 修复 ArXiv Panel 和 Chat Panel 在 MiddleColumn 中根据 `viewMode` 正确渲染
- 修复 `app.jsx` 中 Zen Mode 时隐藏 Header 的逻辑
- 修复 `e.message` 在 `catch (e)` 中 TypeScript `unknown` 类型错误

---

## [0.2.0] - 2026-03-10

- **Core**: 实现了 DDD 领域模型 (`AtomicNote`, `Section`, `Document`, `Annotation`)，定义严谨的 Pydantic Schema。
- **Service**: 实现了 `CrusherAgent`，利用 LLM 进行结构化信息抽取与原子笔记生成，集成 Tenacity 重试机制。
- **RAG Engine**: 构建了 `AtomicRAG` 混合检索服务：
  - 基于 ChromaDB 的向量摘要存储。
  - 基于 NetworkX 的内存图谱构建（Concept + Citation 边）。
  - 实现 `query_with_citations`，支持 1-hop 图谱扩展与原文坐标感知。

## [0.1.0] - 2026-03-09

- 项目骨架：Lumina-UI (React+Vite+TailwindCSS) + Aether-Engine (FastAPI DDD 分层)
- PDF 解析接口：`POST /api/parse-document`，集成 MinerU
- 健康检查 + 优雅停机
- Docker 多阶段构建 + docker-compose 开发联调
