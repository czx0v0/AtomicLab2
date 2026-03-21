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

- 源码中的 `Lumina-UI/index.html` 是 Vite 入口模板，**应纳入版本控制**。
- 部署到 ModelScope 时无需单独“复制 index”：在项目根目录或 CI 中执行 `cd Lumina-UI && npm run build`，生成的 `Lumina-UI/dist/`（内含 `index.html` 与哈希化资源）由 Dockerfile 或部署脚本复制到后端 `static/` 目录，由 FastAPI 挂载对外提供。单镜像构建时通常已在 Dockerfile 中完成上述复制。

---

### 若提示「本空间未能成功发布，错误原因：代码运行失败」

- 你看到的日志里若已有 `GET / [200]`、`GET /api/health [200]` 等，说明**运行时已正常**。平台有时把「首次健康检查超时」或「构建阶段偶发错误」统一报成「代码运行失败」。
- 建议：在创空间页面查看 **构建日志 / 运行日志** 全文，确认是否有 Python 报错或 `npm run build` 失败；若只有 200 响应，可尝试 **再次点击发布** 或 **重启实例**。
- PDF 解析依赖 MinerU 云 API：在创空间 **设置 → 环境变量** 中配置 `MINERU_API_TOKEN` 后，无需本地安装 mineru。

### 外部仓库的更新如何同步到本创空间

可以，有两种常用方式：

1. **推送代码到创空间仓库**：在本地 `modelspace-deploy` 目录（或从主项目复制最新文件到该目录后）执行 `git add . && git commit -m "同步外部更新" && git push origin master`创空间若已关联本仓库，会按平台策略自动或手动重新构建/发布。
2. **在创空间网页端**：进入该创空间 → **设置 / 版本管理** → 使用「从 Git 拉取」或「重新部署」拉取最新 commit。

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

- 右下角 **🚩** 打开「任务控制中心」：当前课题标题/目标会议、6 阶段像素时间线、草稿 Markdown 快捷入口。
- 截稿 **不足 7 天** 时浮层顶部 **Urgent** 提示；展开 **原子助手** 时会在聊天最前插入一条截稿催更（每标签页一次）。
- 详细说明见 [`docs/mission-control.md`](docs/mission-control.md)。

### MinerU 云解析

- 配置 `MINERU_API_TOKEN`（或 `MINERU_API_KEY`）后，解析走云 API。
- 未配置时会回退本地 CLI（`mineru.exe` / `magic-pdf`）。
