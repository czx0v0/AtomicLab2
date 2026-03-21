---
# 详细文档见https://modelscope.cn/docs/%E5%88%9B%E7%A9%BA%E9%97%B4%E5%8D%A1%E7%89%87

domain: #领域：cv/nlp/audio/multi-modal/AutoML
# - cv
tags: #自定义标签
-
datasets: #关联数据集
  evaluation:
  #- iic/ICDAR13_HCTR_Dataset
  test:
  #- iic/MTWI
  train:
  #- iic/SIBR
models: #关联模型
#- iic/ofa_ocr-recognition_general_base_zh
fullWidth: true
header: mini
## 启动文件(若SDK为Gradio/Streamlit，默认为app.py, 若为Static HTML, 默认为index.html)
# deployspec:
#   entry_file: app.py
license: Apache License 2.0
# fullWidth: true
# header: mini
---

# AtomicLab（modelspace-deploy）

> **Read · Organize · Write** — 面向论文阅读、知识整理与写作的沉浸式工作台；本目录为 **ModelScope 创空间 / Docker** 一体部署形态（单端口 FastAPI + 前端静态资源）。

---

## 部署（ModelScope Studio）

创空间卡片与 YAML 说明见 [魔搭创空间文档](https://modelscope.cn/docs/%E5%88%9B%E7%A9%BA%E9%97%B4%E5%8D%A1%E7%89%87)；**上方 front matter** 由平台读取，请勿随意删除。

| 主题 | 说明 |
|------|------|
| 静态资源 | `frontend/index.html` 为 Vite 入口，须纳入版本控制。部署时执行 `cd frontend && npm run build`，`frontend/dist/` 由 `Dockerfile` 多阶段构建拷入后端 `static/`，由 FastAPI 挂载；**无需**手工复制单文件 `index`。 |
| 环境变量 | 在创空间 **设置 → 环境变量** 配置 `DEEPSEEK_API_KEY`、`DEEPSEEK_API_BASE`；PDF 云解析需 **`MINERU_API_TOKEN`**（或 `MINERU_API_KEY`），无需在镜像内安装 MinerU CLI。 |
| 发布报错 | 若日志已出现 `GET / [200]`、`GET /api/health [200]`，多为健康检查超时或构建偶发，**运行时往往正常**；请查看完整**构建 / 运行**日志是否有 Python 或 `npm run build` 错误，可重试发布或重启实例。 |
| 代码更新 | 本地在本仓库提交后 `git push origin <branch>`；或在创空间 **设置 / 版本管理** 拉取 / 重新部署。 |

**Clone（HTTP）**

```bash
git clone https://www.modelscope.cn/studios/czx0v0/AtomicLab2.git
```

**可选：GitHub 镜像** — `origin` 以魔搭为准。添加第二远程：`git remote add github https://github.com/<org>/<repo>.git`，同一提交执行 `git push origin …` 与 `git push github …`（示例分支名 `master` / `main` 自行对齐）。远程 URL **不要**写入令牌；用 HTTPS + 凭据管理器或 `gh auth`。

---

## 仓库结构

| 路径 | 职责 |
|------|------|
| `app.py` | 入口；默认 `UVICORN_PORT=7860` |
| `aether_engine/` | FastAPI、RAG、服务层 |
| `frontend/` | Vite + React，构建产物进 `static/` |
| `docs/` | 产品/技术报告、变更记录、对内对外短报告 |
| `scripts/eval/` | 离线批量评测（`context_precision`、`faithfulness` 等） |

---

## 本地运行

**方式 A — Docker（推荐，最接近创空间）**

```bash
docker build -t atomiclab .
docker run --rm -p 7860:7860 --env-file .env atomiclab
```

浏览器访问 `http://localhost:7860`。

**方式 B — 前后端分进程**

```bash
pip install -r aether_engine/requirements.txt
python app.py
```

```bash
cd frontend && npm install && npm run dev
```

前端开发服务器默认 `http://localhost:5173`（代理至后端端口，与 `app.py` 监听一致即可）。

---

## 文档与评测

| 内容 | 链接 |
|------|------|
| 文档导航与阅读顺序 | [`docs/README.md`](docs/README.md) |
| 阶段变更 | [`docs/CHANGELOG.md`](docs/CHANGELOG.md) |
| 技术长文（含 §3.7.1 离线评测指标） | [`docs/TECHNICAL_REPORT.md`](docs/TECHNICAL_REPORT.md) |
| 一页式深读索引 | [`docs/PROJECT_DEEP_DIVE.md`](docs/PROJECT_DEEP_DIVE.md) |
| 评测脚本 | [`scripts/eval/run_evaluation.py`](scripts/eval/run_evaluation.py) · [`scripts/eval/README.md`](scripts/eval/README.md) |

---

## 能力摘要（与主仓库对齐，精简）

- **阅读**：PDF 高亮与批注、多视图（PDF / Markdown / 章节）、MinerU 云端解析、会话内 DocumentRAG + BM25 自动索引。  
- **整理**：原子笔记（Axiom / Method / Boundary）、图谱与 GraphRAG、笔记手动连边、ArXiv 发现（CJK 关键词英译后检索）。  
- **写作**：行内指令与写作辅助、引用解析（Crossref / Semantic Scholar）、全局 Copilot 与工具调用。  
- **会话**：`X-Session-ID` 隔离；`POST /api/demo/load` 注入 Demo。边界与 API 清单见 [`docs/REPORT_INTERNAL.md`](docs/REPORT_INTERNAL.md)。

---

## 实现注记

- **Mission Control**：截稿时间线、跳转 Organize / 写作 / 助手预填 — [`docs/mission-control.md`](docs/mission-control.md)。  
- **助手**：Markdown、GFM 表格、KaTeX；可点击文献引用 `[n]`。  
- **双库分工**：服务端 Chroma + BM25 + 图谱承担语义检索；浏览器 IndexedDB / `parseCacheByDocId` 存高亮、解析缓存等本地元数据（详见 [`docs/CHANGELOG.md`](docs/CHANGELOG.md)）。  
- **MinerU**：已配置 `MINERU_API_TOKEN` / `MINERU_API_KEY` 时走云 API；未配置时可回退本地 CLI（若已安装）。
