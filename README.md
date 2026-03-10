# AtomicLab

沉浸式学术阅读与写作工作站。当前版本聚焦于「可用的本地原型」：PDF 阅读标注、原子笔记、RAG 检索、多智能体聊天、ArXiv 检索与轻量知识树。

## 当前功能特性

- PDF 阅读与选区操作：高亮、翻译、批注、CRUSH IT 生成原子笔记。
- ArXiv 检索：可搜索并将论文加入文献库，点击后直接在阅读区加载。
- 笔记检索：`NoteRAG (ChromaDB)` 对 `notes.json` 建索引并语义检索。
- 文档检索：解析后的 Markdown 自动切块并写入 `DocumentRAG (ChromaDB)`。
- 多路检索：`NoteRAG + DocumentRAG` 合并排序返回。
- Agentic Chat：`Seeker -> Reviewer -> Synthesizer` 三阶段流程。
- 多源 Seeker：同时接入本地知识库、ArXiv、Semantic Scholar，并做来源标注。
- MinerU 解析：`/api/parse-document` 通过 SSE 返回流式进度和最终 Markdown。
- SSE 分段事件：返回 `chunk` 级章节文本与摘要，支持前端树状渲染。
- 写作辅助：错别字检测、病句检测、学术润色、建议续写。
- 写作任务框：错别字/病句/润色/续写以任务卡执行，含进度条、结果说明、手动应用结果。
- 续写增强：`continue` 动作会走 `NoteRAG + DocumentRAG`，并补充 ArXiv/Semantic Scholar 证据用于引用。
- 左栏新增三种显示模式：`PDF` / `Markdown` / `章节+摘要`（由 Markdown 标题构建）。
- 左栏选区工具栏升级：支持 `selectionchange + pointer` 双触发，降低 PDF 文本层下的漏触发。
- 文本解析可视化：新增解析进度条（不仅日志），支持百分比/阶段回显。

## 当前边界与限制

- 互联网通用检索 Agent：暂未实现（当前有 ArXiv 专用检索）。
- 本地 PDF 文件在浏览器刷新后无法自动恢复二进制句柄（浏览器安全限制）。
- 因持久化策略冲突，本版本改为「会话态」：刷新后前端状态清空，后端 `notes.json` 仍保留。
- 引用高亮依赖 `bbox`，若来源无 `bbox` 仅能跳页，无法精确框选。

## 快速开始

```bash
# Backend
cd Aether-Engine
pip install -r requirements.txt
python -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload

# Frontend
cd Lumina-UI
npm install
npm run dev
```

访问 `http://localhost:5173`。

## 环境变量

项目根目录 `.env`：

```env
DEEPSEEK_API_KEY=sk-xxx
DEEPSEEK_API_BASE=https://api.deepseek.com
```

说明：后端已通过 `python-dotenv` 自动加载根目录 `.env`。

## API 概览

- `GET /api/health`：健康检查
- `POST /api/parse-document`：PDF 解析（SSE）
- `GET|POST|DELETE /api/notes`：原子笔记 CRUD
- `POST /api/search`：语义检索
- `POST /api/chat`：多智能体对话
- `POST /api/translate`：翻译
- `POST /api/arxiv/search`：ArXiv 搜索
- `GET /api/arxiv/download/{id}`：ArXiv PDF 代理下载
- `GET|POST|DELETE /api/documents`：本地文献文件管理
- `POST /api/writing/assist`：写作辅助

## 与优化方案对齐情况

- 已对齐：原子笔记、Agentic 对话、ArXiv 检索、Markdown 解析通路、章节树基础视图。
- 部分对齐：GraphRAG 目前为轻量版（向量检索 + 基础结构），未接入完整图数据库。
- 未完成：统一文件资产管理、引用坐标可审计链路、互联网检索代理、ModelScope 空间化部署策略。

## 下一步（短期）

- 建立后端文献资产库（上传文件落盘、可列举、可恢复、可删除）。
- 引入解析任务 ID 与分块进度（chunk/section 级）。
- 将章节树升级为「章节 -> 摘要 -> 原子卡片」三级结构并支持点击跳转。

## ModelScope 部署模式

- `ephemeral`：默认会话态，容器重启后数据不保留。
- `persistent`：通过 Docker named volume 持久化 `/app/data`。

示例：

```bash
# 会话态
docker compose up

# 持久态
docker compose --profile persistent up aether-engine-persistent lumina-ui
```
