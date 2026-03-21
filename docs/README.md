# AtomicLab 文档中心

本目录用于沉淀 `modelspace-deploy` 的产品说明、技术方案与迭代记录，便于开发、测试、部署与汇报对齐。

## 文档结构

- `README.md`：文档导航与阅读顺序（本文件）
- `CHANGELOG.md`：按阶段记录功能迭代、修复与架构调整
- `TECHNICAL_REPORT.md`：详细技术说明报告（产品经理/大模型算法工程师双视角）
- `REPORT_EXTERNAL.md`：对外汇报版（偏业务价值与里程碑）
- `REPORT_INTERNAL.md`：对内研发版（偏架构、接口、排障与测试）

## 建议阅读顺序

1. 先读 `TECHNICAL_REPORT.md` 的“产品视角”，理解目标与体验闭环
2. 再读 `TECHNICAL_REPORT.md` 的“算法工程视角”，理解 Router/RAG/Tool Calling 设计
3. 面向汇报时读 `REPORT_EXTERNAL.md`
4. 面向研发联调时读 `REPORT_INTERNAL.md`
5. 最后查 `CHANGELOG.md`，定位版本演进与风险点

## 当前系统能力摘要

- 多模态文档阅读与解析（PDF + Markdown + 图谱）
- 混合检索（向量 + BM25 + Graph 1-hop）
- Agent 路由与工具调用（检索工具 + 写作动作工具）
- 写作舱（卡片/原子知识/知识树）与一键注入正文
- Organize **发现**：ArXiv 检索 + 秘书收件箱；中日韩查询自动英译后再检索
- **任务控制中心**：截稿进度、时间线一键跳转 Organize/写作/助手（模拟评审、返修预填）
- 助手气泡：Markdown + 公式/表格 + 可点击文献引用 `[1]`
- 反馈埋点（RLHF）与工程化本地/容器部署

## 维护约定

- 每个里程碑更新 `CHANGELOG.md`
- 大改架构时同步更新 `TECHNICAL_REPORT.md` 中“架构图谱与关键决策”
- 对外汇报优先引用 `docs/` 内容，避免口径漂移
