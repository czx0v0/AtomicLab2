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
### 前端静态资源与 index.html

- 源码中的 `frontend/index.html` 是 Vite 入口模板，**应纳入版本控制**。
- 部署到 ModelScope 时无需单独「复制 index」：在项目根目录或 CI 中执行 `cd frontend && npm run build`，生成的 `frontend/dist/`（内含 `index.html` 与哈希化资源）由 Dockerfile 多阶段构建复制到后端 `static/`（见仓库根目录 `Dockerfile`），由 FastAPI 挂载对外提供。

### 文档与离线评测

- **文档索引**（阅读顺序、双视角报告）：[`docs/README.md`](docs/README.md)
- **阶段变更记录**：[`docs/CHANGELOG.md`](docs/CHANGELOG.md)
- **离线 RAG 批量评测**：[`scripts/eval/run_evaluation.py`](scripts/eval/run_evaluation.py)，运行说明见 [`scripts/eval/README.md`](scripts/eval/README.md)；指标 `context_precision` / `faithfulness` 的定义与终端汇总规则见 [`docs/TECHNICAL_REPORT.md`](docs/TECHNICAL_REPORT.md) §3.7.1
- **项目深读一页纸**（目录、环境、数据流索引）：[`docs/PROJECT_DEEP_DIVE.md`](docs/PROJECT_DEEP_DIVE.md)

---

### 若提示「本空间未能成功发布，错误原因：代码运行失败」

- 你看到的日志里若已有 `GET / [200]`、`GET /api/health [200]` 等，说明**运行时已正常**。平台有时把「首次健康检查超时」或「构建阶段偶发错误」统一报成「代码运行失败」。
- 建议：在创空间页面查看 **构建日志 / 运行日志** 全文，确认是否有 Python 报错或 `npm run build` 失败；若只有 200 响应，可尝试 **再次点击发布** 或 **重启实例**。
- PDF 解析依赖 MinerU 云 API：在创空间 **设置 → 环境变量** 中配置 `MINERU_API_TOKEN` 后，无需本地安装 mineru。

### 外部仓库的更新如何同步到本创空间

可以，有两种常用方式：

1. **推送代码到创空间仓库**：在本地 `modelspace-deploy` 目录（或从主项目复制最新文件到该目录后）执行 `git add . && git commit -m "同步外部更新" && git push origin master`。创空间若已关联本仓库，会按平台策略自动或手动重新构建/发布。
2. **在创空间网页端**：进入该创空间 → **设置 / 版本管理** → 使用「从 Git 拉取」或「重新部署」拉取最新 commit。

### GitHub 镜像（第二远程，可选）

- **主远程**：`origin` 指向魔搭创空间仓库（日常以此为准）。
- **添加 GitHub**：在 `modelspace-deploy` 根目录执行  
  `git remote add github https://github.com/<你的组织或用户名>/<仓库名>.git`  
  （若已存在名为 `github` 的 remote，用 `git remote set-url github <url>` 更新。）
- **同一提交推两处**（分支名按你本地为准，示例为 `master`）：  
  `git push origin master`  
  `git push github master`  
  新建空 GitHub 仓库时首次推送可用  
  `git push -u github master`。
- **安全**：请勿把带个人访问令牌或 OAuth 的 URL 写进仓库内文档；远程地址建议用无凭据 HTTPS，由 Git 凭据管理器或 `gh auth` 保存登录。

---

#### Clone with HTTP

```bash
 git clone https://www.modelscope.cn/studios/czx0v0/AtomicLab2.git
```

---

## 本地

### 方式 A：Docker 一次运行（推荐，最接近创空间）

在 `modelspace-deploy` 根目录执行：

```bash
docker build -t atomiclab .
docker run --rm -p 7860:7860 --env-file .env atomiclab
```

访问：`http://localhost:7860`

### 方式 B：本地开发（前后端分开跑）

后端：

```bash
cd modelspace-deploy
pip install -r aether_engine/requirements.txt
python app.py
```

前端（新开终端）：

```bash
cd modelspace-deploy/frontend
npm install
npm run dev
```

访问：`http://localhost:5173`（已通过 Vite 代理到后端 7860）

### 投稿与进度（Mission Control）

- 右下角 **🚩** 打开「任务控制中心」：可编辑**课题标题**、**目标**（默认「毕业论文」，可改为期刊/会议名）、**截止日期**（自动保存到本机）；6 阶段时间线与 Markdown 快捷入口。
- **点击时间线阶段**可一键跳转：**选题**→ Organize 卡片、**阅读**→ Organize **发现**、**撰稿**→ 写作、**审稿中**→ 打开助手并预填「模拟同行评审」、**已投稿**→ 卡片、**返修**→ 写作 + 助手预填返修提示。
- 截止 **不足 7 天** 时浮层顶部 **Urgent** 提示；展开 **原子助手** 时会在聊天最前插入催更（每标签页一次）。
- 详细说明见 [`docs/mission-control.md`](docs/mission-control.md)。

### Organize · 发现（ArXiv）

- 若关键词或研究目标含 **中日韩**，会在请求前自动**译为英文**再查 arXiv，便于命中英文论文库；依赖后端 `POST /api/translate`（与创空间环境变量中的模型/密钥一致，**无需改** Dockerfile 或部署入口）。

### 助手消息

- 助手回复支持 **Markdown、GFM 表格、KaTeX 公式**；文中 **`[1]`** 等引用可点击跳转对应知识来源。

### 双库架构：向量检索 vs 本地元数据（工业级 RAG 约定）

AtomicLab 将 **语义检索** 与 **结构化/隐私敏感元数据** 分开存放，避免「什么都塞进向量库」导致难维护、难审计、难合规。

| 职责 | 典型存储 | 放什么 | 不放什么 |
|------|----------|--------|----------|
| **向量与语义** | 后端 Chroma 等 | 文本分块、Embedding、检索用的文档/笔记向量通道 | 原始文件名层级树、高亮截图 Base64、按篇切换的 UI 快照 |
| **元数据与隐私态** | 浏览器 **IndexedDB**（如 localforage）、Zustand 内存字典 | 高亮/截图与 `doc_id` 的映射、Local-First 笔记；**`parseCacheByDocId`**（按 `doc_id` 缓存 `parsedSections` + `parsedMarkdown` + `parsedDocName`，切文献秒开） | 大块正文重复入向量库（正文以解析管道与缓存为准） |

- **后端**：仍以 Chroma + BM25 + 图谱等完成 RAG；若后续引入 **SQLite**，宜用于会话级/可审计的结构化表（与现有服务分层一致），与向量索引解耦。
- **前端**：切换文献时优先读 **`parseCacheByDocId`**；「重新开始」会 **清空** 该字典，避免会话间串台。详见 [`docs/CHANGELOG.md`](docs/CHANGELOG.md)。

### MinerU 云解析

- 配置 `MINERU_API_TOKEN`（或 `MINERU_API_KEY`）后，解析走云 API。
- 未配置时会回退本地 CLI（`mineru.exe` / `magic-pdf`）。
