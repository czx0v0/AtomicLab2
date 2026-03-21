# 可选：Demo PDF 放置位置

将 `demo_paper.pdf` 放在本目录时，后端 `POST /api/demo/load` 会优先在以下路径中解析（与 `aether_engine/demo_data/demo_paper.pdf` 二选一即可）：

- `public/demo_paper.pdf`（本目录）
- `aether_engine/demo_data/demo_paper.pdf`

创空间部署时请将白皮书纳入构建上下文或挂载卷，保证至少一处路径存在该文件。
