# AtomicLab（modelspace-deploy）项目深读索引

本文档为「一页式」入口：帮助快速定位目录、环境、数据流、评测与正式文档，**不重复**长文（请以 `TECHNICAL_REPORT.md` 等为准）。

## 1. 仓库与目录（高层）

| 路径 | 职责 |
|------|------|
| `app.py` | ModelScope 创空间 / 本地 Uvicorn 入口；`UVICORN_PORT` 默认 `7860` |
| `aether_engine/` | FastAPI 应用、API、RAG、服务层 |
| `frontend/` | Vite + React；`npm run dev` 开发，`npm run build` 产出 `dist/`（Docker 复制到 `static/`） |
| `scripts/eval/` | 离线 RAG 批量评测 `run_evaluation.py`、题集 `dataset.json`、报告 CSV |
| `docs/` | 产品/技术双视角报告、CHANGELOG、本索引 |
| `Dockerfile` | 前端构建 + 后端镜像，静态资源挂载路径见文件内注释 |

## 2. 核心数据流（极简）

1. **入库**：PDF/Markdown → 解析 → 切块 → Chroma + BM25 + 图谱边；会话级状态见后端 `session_store` 等。
2. **检索**：多通道并行 → RRF/加权融合 → 统一结果字段（`doc_id` / `page_num` / `bbox`）供跳转。
3. **对话**：Router 意图解耦 → 检索或直答 → Synthesizer 流式 SSE（`step` / `delta` / `action` / `done`）。
4. **前端 Local-First**：高亮、解析快照等优先 **IndexedDB + Zustand `parseCacheByDocId`**，与向量库分工（见根 `README.md` 双库表）。

## 3. 关键环境变量（常见）

- **大模型 / API**：`DEEPSEEK_API_KEY`（对话、部分工具、**评测裁判**）；其他密钥以 `.env` 与创空间控制台为准。
- **PDF 云解析**：`MINERU_API_TOKEN` 或 `MINERU_API_KEY`（见根 `README.md`）。
- **服务端口**：本地 `app.py` 使用 `UVICORN_PORT`（默认 `7860`）。运行 `run_evaluation.py` 时 `--chat-url` 必须与之一致（脚本默认 `8000` 时需改端口或传参）。

## 4. 文档地图（读什么）

| 需求 | 文档 |
|------|------|
| 产品价值 + Demo 话术 | [`REPORT_EXTERNAL.md`](REPORT_EXTERNAL.md) |
| 架构、接口、排障 | [`REPORT_INTERNAL.md`](REPORT_INTERNAL.md) |
| 双视角长文 + **§3.7.1 离线评测指标** | [`TECHNICAL_REPORT.md`](TECHNICAL_REPORT.md) |
| 按阶段事实锚 | [`CHANGELOG.md`](CHANGELOG.md) |
| 导航与评测索引表 | [`README.md`](README.md)（`docs/` 下） |
| 任务控制中心 | [`mission-control.md`](mission-control.md) |

## 5. 离线评测（量化指标落点）

- **脚本**：[`../scripts/eval/run_evaluation.py`](../scripts/eval/run_evaluation.py)
- **指标**：`context_precision`（0/1）、`faithfulness`（0–1）；定义以脚本内 `JUDGE_SYSTEM_PROMPT` 为准。
- **逐题输出**：`--report` 指向的 CSV（默认 `evaluation_report.csv`）。
- **终端汇总**：脚本末尾 `Evaluation Summary`；按 `question` 去重，每题仅 **最后一行** 参与均值；按 `type` 分桶 + **overall**。
- **操作说明**：[`../scripts/eval/README.md`](../scripts/eval/README.md)

## 6. 部署与创空间

- 根目录 [`README.md`](../README.md)：Docker 本地跑、创空间发布 troubleshooting、Git 同步说明。
- 魔搭创空间卡片与 `ms_deploy` 等以平台文档及项目内既有部署说明为准（若单独维护 skill，勿与此处冲突）。

## 7. 近期迭代主题（便于对齐 commit / 会话）

以下为主题性归纳，**具体以 `git log` 与 `CHANGELOG.md` 为准**：

- Chat / RAG / 原子知识等后端修复与路由行为调优
- 文档与 Mission Control 相关同步（CHANGELOG、子模块）
- 前端：**Mission Control** 与 Organize/写作/助手联动；**顶栏 Agent HUD**、**流式占位**（`isAgentThinking` / `agentStreamActive`）、`/help` 文案

---

若发现本文与代码不一致，以仓库实现与 `CHANGELOG.md` 为优先，并回改本索引。
