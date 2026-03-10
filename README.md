# AtomicLab

**沉浸式学术文献解析与写作工作站 (GraphRAG-Powered)**

基于「(Atomic Knowledge)」理念，利用大模型将 PDF 自动解构为单一概念卡片，构建可解释的知识图谱，并提供带有精准坐标引用的沉浸式写作体验。

## 核心特性

| 模块                          | 说明                                                                   |
| ----------------------------- | ---------------------------------------------------------------------- |
| **原子解析**            | 上传 PDF → SSE 流式解析 → AtomicNote 卡片，含 `bbox`/`page` 坐标 |
| **混合检索 (GraphRAG)** | ChromaDB 向量语义 + NetworkX 图谱关联双引擎，语义搜索 Enter 触发       |
| **知识图谱**            | ForceGraph2D 可视化，按类型分组，点击节点跳原文                        |
| **富文本写作**          | Zen Mode 全屏专注 + Pomodoro 计时器，Ctrl+B/I 快捷键，本地存储         |
| **RPG 多智能体**        | Seeker / Reviewer / Synthesizer 三体协作，自动检索知识库               |
| **ArXiv 检索**          | 实时搜索 ArXiv 论文，一键下载 PDF                                      |
| **翻译**                | 选中 PDF 文字 → 点击「翻译」→ DeepSeek 中文翻译                      |
| **批注 & 高亮**         | 选中文字 → CRUSH IT → 自动截图 + 归档为原子卡片                      |

## 快速开始

```bash
# 1. 后端 Aether-Engine
cd Aether-Engine
conda activate py-agent
pip install -r requirements.txt
python -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload

# 2. 前端 Lumina-UI
cd Lumina-UI
npm install
npm run dev
# 访问 http://localhost:5173

# 3. Docker 一键联调（可选）
docker compose up
```

## 环境变量

在 `.env` 中配置（参见 `.env.example`）：

```env
DEEPSEEK_API_KEY=sk-xxx     # DeepSeek 翻译与合成
MINERU_API_KEY=xxx          # MinerU PDF 解析（可选）
```

## API 接口

| 方法   | 路径                         | 说明                            |
| ------ | ---------------------------- | ------------------------------- |
| GET    | `/api/health`              | 后端健康检查                    |
| POST   | `/api/parse-document`      | 上传 PDF，SSE 流式返回 Markdown |
| GET    | `/api/notes`               | 获取所有原子笔记                |
| POST   | `/api/notes`               | 创建原子笔记                    |
| DELETE | `/api/notes/{id}`          | 删除笔记                        |
| POST   | `/api/search`              | 语义检索知识库（GraphRAG）      |
| POST   | `/api/translate`           | DeepSeek 文本翻译               |
| POST   | `/api/arxiv/search`        | ArXiv 论文检索                  |
| GET    | `/api/arxiv/download/{id}` | 代理下载 ArXiv PDF              |

## 技术栈

- **前端**: React 18 · Vite 5 · TailwindCSS 3 · Zustand 5 (persist) · Framer Motion · react-pdf · react-force-graph-2d
- **后端**: FastAPI · ChromaDB · NetworkX · DeepSeek API · MinerU
- **部署**: Docker multi-stage · Nginx · docker-compose
