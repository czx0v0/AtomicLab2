# Documentation index — AtomicLab (`modelspace-deploy`)

本目录存放产品说明、技术方案、对内/对外汇报与迭代记录，供研发、评测、部署与学术展示共用一套口径。

---

## Document map

| File | Audience | Purpose |
|------|----------|---------|
| [`TECHNICAL_REPORT.md`](TECHNICAL_REPORT.md) | PM + ML/infra | 双视角长文：体验闭环、Router/RAG/tooling、**§3.7.1** 离线评测 |
| [`REPORT_INTERNAL.md`](REPORT_INTERNAL.md) | Engineering | 架构、关键 API、排障（含流式气泡等）— **事实与接口以此为准** |
| [`REPORT_EXTERNAL.md`](REPORT_EXTERNAL.md) | Outreach | 价值主张、Demo 话术、对外指标口径 |
| [`PROJECT_DEEP_DIVE.md`](PROJECT_DEEP_DIVE.md) | Onboarding | 一页索引：目录、环境、数据流、评测入口 |
| [`CHANGELOG.md`](CHANGELOG.md) | All | 按阶段的能力与风险变更 |
| [`mission-control.md`](mission-control.md) | UX / PM | 任务控制中心交互说明 |

---

## Suggested reading order

1. `TECHNICAL_REPORT.md` — 产品视角 → 算法与工程视角（含 §3.7.1）。  
2. `REPORT_INTERNAL.md` — 联调、接口与排障。  
3. `REPORT_EXTERNAL.md` — 汇报与演示（与 INTERNAL 冲突时以 INTERNAL 为准）。  
4. `CHANGELOG.md` — 版本锚点。  
5. `PROJECT_DEEP_DIVE.md` — 快速定位脚本与环境变量。

---

## System capabilities (concise)

- 多模态阅读与解析（PDF、Markdown、轻量图谱）；混合检索（向量 + BM25 + 1-hop graph）。  
- Agent 路由、检索与写作工具调用；写作舱与引用解析。  
- Organize **发现**：ArXiv + 秘书流；CJK 查询英译后再检索。  
- **Mission Control**：截稿与时间线、跳转写作/助手场景。  
- 离线评测：`scripts/eval/run_evaluation.py`，指标定义见 `TECHNICAL_REPORT.md` §3.7.1。

---

## Offline evaluation (`run_evaluation`)

| Topic | Location |
|-------|----------|
| Entry | [`scripts/eval/run_evaluation.py`](../scripts/eval/run_evaluation.py) |
| CLI、端口、`UVICORN_PORT` | [`scripts/eval/README.md`](../scripts/eval/README.md) |
| `context_precision` / `faithfulness`、CSV、Summary 去重 | `TECHNICAL_REPORT.md` §3.7.1 |
| 排障摘录 | `REPORT_INTERNAL.md` §7.3 |

**Note**: Judge uses `DEEPSEEK_API_KEY`; `--chat-url` must match the backend listen port.

---

## Maintenance

- **INTERNAL vs EXTERNAL**: same facts as `REPORT_INTERNAL.md`; update `REPORT_EXTERNAL.md` when conflicts arise.  
- Ship milestones in `CHANGELOG.md`; large architecture edits → `TECHNICAL_REPORT.md`.  
- Visible UI changes should touch `CHANGELOG.md` plus one of the short reports where relevant.
