# Demo 白皮书

- **demo_paper.pdf**：预置 PDF。用户点击「加载白皮书」后，`GET /api/demo/pdf` 返回该文件流供阅读器展示。
- **demo_static_bundle.json** + **demo_markdown.md**：`POST /api/demo/load` 的解析结果来源（静态、运行时无 MinerU）。须与 `demo_paper.pdf` 内容一致。

## 更换 PDF 或刷新静态产物

在 **`aether_engine`** 目录下配置好 MinerU（与线上一致的环境变量），执行：

```bash
set PYTHONPATH=.
python tools/export_demo_static.py --from-pdf
```

会对 `demo_paper.pdf` 跑一次 MinerU，覆盖生成 `demo_static_bundle.json` 与 `demo_markdown.md`，再将二者与 PDF 一并提交。

若本地已有历史解析缓存，也可从缓存导出（不再次跑 MinerU）：

```bash
python tools/export_demo_static.py --from-cache
```

（依赖 `aether_engine/data/demo_cache.json`。）

仅修改手写 Markdown、不解析 PDF 时：

```bash
python tools/export_demo_static.py
```

其他 `sections_demo.json` / `notes_demo.json` 为历史示例，运行时以 `demo_static_bundle.json` 为准。
