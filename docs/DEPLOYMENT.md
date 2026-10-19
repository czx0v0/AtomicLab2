# 部署、数据存储与使用指南

> 本文是「部署 + 数据存储 + 使用 + 技术问答」的总览，配套 `ROADMAP.md`（规划）、`MULTIAGENT_ARCH.md`（多智能体架构）、`IMPROVEMENT_PLAN.md`（审查整改）。

## 0. 系统架构（单次请求 + 数据流）

```
                        ┌─────────────────────────────────────────────┐
  HTTP POST /api/chat   │  应用层（FastAPI）                          │
        │               │  chat / chat_stream                        │
        ▼               └───────────────┬─────────────────────────────┘
 load_state ─── ConversationState       │
        │               └── 工作记忆（data/conversation_state_{sid}.json）
        ▼
 _is_followup（追问判断）
        │
        ▼
 _prepare_chat_context ──► Router(_route_with_tools)
        │                      │
        │          ┌───────────┼───────────────┐
        │          ▼           ▼               ▼
        │     Seeker 检索    arXiv 外链      Zotero 书库
        │     (search.py)   (arxiv.py)    (zotero_sync)
        │          │
        │          ├─ 文档向量 1.8 ─┐
        │          ├─ 文档 BM25 1.0 ─┤  纯 RRF 融合
        │          ├─ 笔记向量 0.9 ─┤  (1/(60+rank))
        │          ├─ 笔记 BM25 0.7 ─┤
        │          ├─ 图谱 1/2-hop ─┘
        │          └─ 重排(cross_encoder/llm/none) → top_k=10
        ▼
 Reviewer（_reviewer_heuristic，证据评分）
        ▼
 Synthesizer（_build_synthesis_prompt + core/llm 合成）
        ▼
 _finalize（更新 ConversationState）
        ▼
 JSON（chat）/ SSE 流（chat_stream：step/delta/action/done）
```

```
                    ┌──────────── 数据存储分层 ────────────┐
                    │                                      │
    磁盘持久化（跨重启）                    内存缓存（进程内）
    data/                                  _instances dict
    ├─ conversation_state_{sid}.json        ├─ NoteRAG（ChromaDB client）
    ├─ notes.json                           ├─ DocumentRAG（ChromaDB client）
    ├─ documents/documents.json             ├─ BM25Engine（分词+BM25Okapi）
    ├─ documents/domains.json               ├─ knowledge_graph_store（networkx 图）
    ├─ chroma_store/  ← 向量库(sqlite)      └─ SessionDataStore（云端会话）
    ├─ bm25_cache_{key}.pkl
    ├─ knowledge_graph_{key}.json
    ├─ parse_images/
    ├─ arxiv_inbox.json
    └─ feedback_log.json
```

## 1. 使用指南

### 后端

```powershell
conda activate modelspace
D:\anaconda3\envs\modelspace\python.exe app.py        # 启动，默认 http://127.0.0.1:7860
```

冒烟测试（PowerShell 用单引号 JSON）：

```powershell
curl.exe -X POST http://127.0.0.1:7860/api/chat -H "Content-Type: application/json" -d '{"question":"Transformer 的缩放因子是什么？"}'
```

### 前端

```powershell
cd frontend
npm install            # 首次
npm run build          # 生产构建（改 src/ 后必须）；产物 frontend/dist
# npm run dev          # 开发模式（HMR）
```

### 评测回归

```powershell
# direct 模式（不走 chat.py）
D:\anaconda3\envs\modelspace\python.exe scripts/eval/run_evaluation.py --mode direct --type multi-hop --top-k 10 --max-rounds 2 --data-root data/eval_runtime/multi --limit 2 --fresh
# http 模式（走 chat.py）
D:\anaconda3\envs\modelspace\python.exe scripts/eval/run_evaluation.py --mode http --type multi-hop --top-k 10 --max-rounds 2 --chat-url http://127.0.0.1:7860/api/chat --limit 2 --fresh
```

## 2. ModelScope 创空间部署指南

### 2.1 环境变量（创空间平台手动配置，git 不带 .env）

| 变量 | 取值 | 必需 |
|---|---|---|
| `CHAT_LLM_PROVIDER` | `deepseek`（默认）/ `aliyun` | 是 |
| `DEEPSEEK_API_KEY` | provider=deepseek 时 | 二选一 |
| `ALIYUN_API_KEY` + `ALIYUN_MODEL` + `ALIYUN_API_BASE` | provider=aliyun 时 | 二选一 |
| `MINERU_API_KEY` / `MINERU_API_TOKEN` | 解析 PDF 用 | 是 |
| 其余（top_k/BM25/历史窗口/输入输出） | 全部默认最优 | 否 |

> 唯一必配：`CHAT_LLM_PROVIDER` + 一套 LLM key + MinerU key。其余全部代码默认。

### 2.2 推送流程

```powershell
# 1. 本地 commit + push（ModelScope 仓库的 master 分支）
git add -A
git commit -m "feat: ..."
git push origin master

# 2. 创空间检测到 master 更新后自动用 Dockerfile 构建
#    Dockerfile：node 构建前端 → modelscope python 镜像装依赖 → 复制代码 → python app.py
```

### 2.3 云端 vs 本地差异

| 维度 | 本地 | 创空间 |
|---|---|---|
| 环境判定 | `is_modelscope_space()` = False | True（存在 `/mnt/workspace`） |
| 数据目录 | `data/`（CWD） | `/mnt/workspace`（持久） |
| 会话隔离 | 无（session_id=None） | `X-Session-ID` → `/tmp/atomiclab_sessions/`（1h 过期） |
| 模型缓存 | 本地路径 | `/mnt/workspace/.cache/modelscope` |
| 端口 | 7860 | 7860（Dockerfile EXPOSE） |

## 3. 数据存储完整盘点

### 磁盘持久化（统一走 `data_path`/`notes_file`/`get_session_path`）

| 数据 | 类型 | 存什么 | 为什么 | 路径 |
|---|---|---|---|---|
| 工作记忆 | JSON | last_question/evidence_cache/concluded/turn | 跨轮追问复用 | `data/conversation_state_{sid}.json` |
| 原子笔记 | JSON | 笔记内容+类型+标签 | 长期记忆 | `data/notes.json` |
| 文档元数据 | JSON | 文献标题/来源/解析状态 | 文献索引 | `data/documents/documents.json` |
| 领域 | JSON | 领域分类 | 领域管理 | `data/documents/domains.json` |
| 向量库 | ChromaDB(sqlite) | 文档/笔记 embedding | 语义检索 | `data/chroma_store/` |
| BM25 缓存 | pickle | jieba 分词语料 | 词法检索加速 | `data/bm25_cache_{key}.pkl` |
| 知识图谱 | JSON(networkx) | 笔记节点+关系边 | 跨文档关联 | `data/knowledge_graph_{key}.json` |
| parse_images | 图片文件 | PDF 解析插图 | 原文插图 | `data/parse_images/` |
| arXiv 收件箱 | JSON | 秘书拉取的论文 | arXiv 推荐 | `data/arxiv_inbox.json` |
| 反馈日志 | JSON | 用户反馈 | 质量追踪 | `data/feedback_log.json` |
| 云端会话 | 目录 | 多用户隔离数据 | Demo 隔离 | `/tmp/atomiclab_sessions/`（故意不持久） |

### 内存缓存（进程内，非持久）

| 内存 | 存什么 | 为什么 |
|---|---|---|
| NoteRAG/DocumentRAG 实例 | ChromaDB client + collection 句柄 | 向量检索（per-session 单例） |
| BM25Engine 实例 | 分词语料 + BM25Okapi 对象 | 词法检索（磁盘 pickle 加速加载） |
| knowledge_graph_store | networkx 图对象 | 图谱 1/2-hop 查询 |
| SessionDataStore | 会话元数据 | 云端多用户隔离 + 1h 过期 |

## 4. 技术问答

### 4.1 怎么被模型检索？

数据 → 解析（MinerU）→ 切块（`_split_markdown` 800 字）→ 建索引（向量 ChromaDB + BM25 分词）→ 查询时多路召回 → RRF 融合 → 重排 → top_k 拼进 prompt → LLM 生成。

### 4.2 Zotero 实现了吗？

✅ 已实现：`api/integration_zotero.py`（路由）+ `service/zotero_sync.py`（同步）。需用户在设置里配 Zotero API key + library ID 后才生效。

### 4.3 NoteRAG/DocumentRAG 每次重建吗？

❌ 不重建。它们是 **per-session 单例**（`_instances` dict 缓存）；ChromaDB 是持久 sqlite，collection `get_or_create`（复用已有索引）；BM25 索引仅在 `invalidate()`（笔记/文档变更）或缓存失效时重建。

### 4.4 为什么选 ChromaDB？

轻量嵌入式向量库（sqlite 持久化）、无需外部服务、API 简单（`get_or_create_collection`）、自带 cosine 距离、适合小规模 RAG（几十篇论文）。对比 FAISS（纯内存、无持久化元数据）更省心。

### 4.5 demo 数据库需要更新吗？

- 向量库结构未变，**不需要手动迁移**；
- demo 索引在**每次启动 `warm_demo_global_assets()` 自动重建**（`_ensure_demo_index` → `index_document` + `invalidate()`），用当前代码（含 800 硬切修复）；
- 若旧 demo 库是在「超长硬切」修复前建的，**重启服务即可自动重建**。

### 4.6 demo LaTeX（article.tex）需要优化重写吗？

✅ 需要，有 4 处与实际系统不符：

| 位置 | 现状 | 应为 |
|---|---|---|
| §1 "Crusher Agent" | 已删的死代码 | `note_distiller` / `atomic_decomposer` |
| §2 "FAISS HNSW" | 实际用 ChromaDB | **ChromaDB** |
| §2 "1-hop expansion" | 实际 1/2-hop | **1/2-hop** |
| §Agentic "Seeker/Reviewer/Synthesizer" | 缺 Router | **Router→Seeker→Reviewer→Synthesizer** |

## 5. 分支建议

- 单人项目，**直接在 master 提交**，无需 feature 分支；
- 当前本地有未提交改动（流式 bug 修复 + #8/#17 + 文档），提交后 `git push origin master` 即可触发创空间重建。

> 若想更规范：`git checkout -b chore/refactor-single-source` → 合入 master → 删分支。但对单人小项目，直接 master 更简单。

## 6. demo 白皮书更新（article.tex → demo 建库）

### 6.1 三个 demo 文件（代码事实）

| 文件 | 位置 | 用途 |
|---|---|---|
| `demo_paper.pdf` | `aether_engine/demo_data/` 或 `public/` | 「跳转原文」显示的 PDF |
| `demo_markdown.md` | `aether_engine/demo_data/` | markdown 源（regen 输入） |
| `demo_static_bundle.json` | `aether_engine/demo_data/` | **建索引的内容**（markdown + sections + demo_notes） |

> 索引**不是从 PDF 建**，是从 `demo_static_bundle.json` 的 markdown 建（`_ensure_demo_index` → `rag.index_document(DEMO_DOC_ID, "demo_paper.pdf", markdown)`）。PDF 只用于「跳转原文」。

> ⚠️ **MinerU 关系（准确说法）**：`demo_markdown.md` 的**准确内容由 MinerU 解析 `demo_paper.pdf` 生成一次**（保留表格/公式/排版），缓存下来后，demo **加载时**不再跑 MinerU（直接复用 markdown → 切块 → 向量/BM25 索引，秒级）。即「MinerU 跑一次生成 md，之后运行时复用」。

### 6.2 更新流程（4 步，含 MinerU 生成 md + 清旧笔记）

```powershell
cd D:\Coding\agent\AtomicLab\modelspace-deploy

# ① 复制编译好的新 PDF（article.pdf → demo_paper.pdf）
Copy-Item D:\Coding\resume-main\article.pdf aether_engine\demo_data\demo_paper.pdf

# ② MinerU 解析 demo_paper.pdf → 生成准确的 demo_markdown.md + demo_static_bundle.json
cd aether_engine
$env:MINERU_API_TOKEN = "<你的 MinerU token>"   # 云端 API（或本地装 magic-pdf 走 CLI）
set PYTHONPATH=.
D:\anaconda3\envs\modelspace\python.exe tools\export_demo_static.py --from-pdf
cd ..

# ③ 清旧 demo 笔记（notes.json 里 source=demo_seed 的残留，避免重复/显示旧中文）
D:\anaconda3\envs\modelspace\python.exe -c "import json; p='data/notes.json'; d=json.load(open(p,encoding='utf-8')); n=[x for x in d if x.get('source')!='demo_seed']; json.dump(n, open(p,'w',encoding='utf-8'), ensure_ascii=False, indent=2); print(f'cleared demo_seed, {len(n)} left')"

# ④ 重启后端 → warm_demo_global_assets() 自动重建向量索引 + BM25；浏览器 Ctrl+F5 强刷
D:\anaconda3\envs\modelspace\python.exe app.py
```

### 6.3 MinerU 两种模式

| 模式 | 配置 | 适用 |
|---|---|---|
| 云 API | 设 `MINERU_API_TOKEN`（或 `MINERU_API_KEY`） | 有 MinerU 云端 token（与创空间复用） |
| 本地 CLI | 安装 `magic-pdf`/`mineru`，`_find_mineru_bin()` 找到 CLI | 本地已装 MinerU + 模型 |

> 判定逻辑（`parser.py`）：有 token → 云 API；无 token → 找本地 `mineru`/`magic-pdf` CLI；都没有 → 报「MinerU 未安装且未配置 MINERU_API_TOKEN」。

> 更新版 `.tex` 在 `docs/demo_whitepaper_updated.tex`；备份 `.bak` 文件保留兜底。
