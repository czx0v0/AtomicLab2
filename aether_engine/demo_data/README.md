# Demo 白皮书

- **demo_paper.pdf**：预置 PDF。用户点击「加载白皮书」后，后端通过 `GET /api/demo/pdf` 返回该文件流，前端当作用户上传并走解析流程（上传 + MinerU 解析）。
- `POST /api/demo/load` 仅清空当前会话，便于随后加载白皮书。

无需 JSON；替换 `demo_paper.pdf` 即可更换体验用白皮书。
