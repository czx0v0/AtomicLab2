# Changelog

## [0.2.0] - 2026-03-10

- **Core**: 实现了 DDD 领域模型 (`AtomicNote`, `Section`, `Document`, `Annotation`)，定义严谨的 Pydantic Schema。
- **Service**: 实现了 `CrusherAgent`，利用 LLM 进行结构化信息抽取与原子笔记生成，集成 Tenacity 重试机制。
- **RAG Engine**: 构建了 `AtomicRAG` 混合检索服务：
  - 基于 ChromaDB 的向量摘要存储。
  - 基于 NetworkX 的内存图谱构建（Concept + Citation 边）。
  - 实现 `query_with_citations`，支持 1-hop 图谱扩展与原文坐标感知。

## [0.1.0] - 2026-03-09

- 项目骨架：Lumina-UI (React+Vite+TailwindCSS) + Aether-Engine (FastAPI DDD 分层)
- PDF 解析接口：`POST /api/parse-document`，集成 MinerU
- 健康检查 + 优雅停机
- Docker 多阶段构建 + docker-compose 开发联调
