# AtomicLab

**沉浸式学术文献解析与写作工作站 (GraphRAG-Powered)**

基于「原子知识 (Atomic Knowledge)」理念，利用大模型将 PDF 自动解构为单一概念卡片，构建可解释的知识图谱，并提供带有精准坐标引用的沉浸式写作体验。

## 核心特性

- **DDD 领域驱动设计**: `models.py` 定义严谨的 Pydantic Schema (`AtomicNote`, `Document`, `Annotation`)，确保类型安全。
- **高阶 GraphRAG**:
  - **混合检索**: ChromaDB (向量语义) + NetworkX (图谱关联) 双引擎。
  - **空间感知**: 检索结果包含 `bbox` 与 `page_num`，支持前端高亮原文。
  - **动态扩展**: 基于 `Requires_Concept` 与 `Cites` 边进行 1-hop 检索扩展。
- **智能提取 (Crusher Agent)**: 基于 LLM 的结构化信息抽取，支持重试机制与 JSON Schema 强校验。

## 运行

```bash
# 后端 (Aether-Engine)
cd Aether-Engine
conda activate py-agent
pip install -r requirements.txt
python -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload

# 前端 (Lumina-UI)
cd Lumina-UI
npm install && npm run dev

# Docker 联调
docker compose up
```

## API

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/health` | 健康检查 |
| POST | `/api/parse-document` | 上传 PDF → Markdown |
| POST | `/api/extract-knowledge` | Markdown → AtomicNotes (Crusher) |
| POST | `/api/query-rag` | GraphRAG 混合检索 (支持引用扩展) |
