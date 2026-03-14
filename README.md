---
# 详细文档见https://modelscope.cn/docs/%E5%88%9B%E7%A9%BA%E9%97%B4%E5%8D%A1%E7%89%87
headerMini: true
fullWidth: true
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

## 启动文件(若SDK为Gradio/Streamlit，默认为app.py, 若为Static HTML, 默认为index.html)
# deployspec:
#   entry_file: app.py
license: Apache License 2.0
---

### 前端静态资源与 index.html
- 源码中的 `Lumina-UI/index.html` 是 Vite 入口模板，**应纳入版本控制**。
- 部署到 ModelScope 时无需单独“复制 index”：在项目根目录或 CI 中执行 `cd Lumina-UI && npm run build`，生成的 `Lumina-UI/dist/`（内含 `index.html` 与哈希化资源）由 Dockerfile 或部署脚本复制到后端 `static/` 目录，由 FastAPI 挂载对外提供。单镜像构建时通常已在 Dockerfile 中完成上述复制。
---
#### Clone with HTTP
```bash
 git clone https://www.modelscope.cn/studios/czx0v0/AtomicLab2.git
```