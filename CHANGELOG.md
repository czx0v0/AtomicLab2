# Changelog

## [0.3.0] - 2026-03-11

### 新增功能

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

### 修复

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
