# AtomicLab (modelspace-deploy) 代码审查报告

> 审查时间：2026-10-19 · 审查范围：`app.py`、`aether_engine/`（FastAPI 后端 + RAG/服务层）、`integrations/`、`frontend/src/`（关键模块）、`Dockerfile`、依赖清单与核心文档。
>
> 审查维度：单一事实来源、结构规范、代码简洁合理、文档一致性、功能全局一致复用。

## 结论先行

项目功能闭环完整（PDF 解析 → 多源混合检索 → 多智能体编排 → 写作/图谱/Zotero/LaTeX），但存在**系统性的"单一事实来源"失守**——同一常量/逻辑/配置被复制 3～12 处，并由此引入了若干**真实正确性缺陷**（本地重置失效、双数据目录、ALIYUN 提供商下路由失效等）。

严重度分级：🔴 严重（P0/P1）、🟠 中等（P2）、🟡 轻微（P3）。

---

## 一、单一事实来源（Single Source of Truth）——最突出的问题

### 🔴 1. `IN_MODELSCOPE_SPACE` 复制 12 处

`os.path.exists("/mnt/workspace")` 这个部署环境判定，被原样复制到 **12 个文件**：
`app.py#L29`、`api/documents.py#L25`、`api/notes.py#L24`、`api/search.py#L26`、`api/domains.py#L22`、`api/integration_zotero.py#L23`、`service/doc_rag.py#L19`、`service/note_rag.py#L26`、`service/bm25_engine.py#L27`、`service/embedding.py#L19`、`service/knowledge_graph_store.py#L18`、`service/arxiv_secretary.py#L24`。

**建议**：在 `config/settings.py` 或 `core/` 提供唯一的 `is_modelscope_space()`（或常量），其余全部导入。

### 🔴 2. 会话 ID 获取三套机制并存

- `Depends(get_session_id)`：`api/reset.py#L22`、`api/demo.py#L155`、`api/writing.py#L406`（4 处）。
- `x_session_id: str = Header(default="")`：**30 处**（`api/search.py#L833` 等）。
- `session_id: str = ""` 查询参数：`api/documents.py#L204`（与 Header 并存的双通道）。

且 `get_session_id`（`core/session.py#L29`）返回**未净化**原始值，`sanitize_session_id` 只在 reset/demo 中二次调用，其余端点完全不净化。

**建议**：统一为一个 FastAPI `Depends`，内部完成「读头 → 净化 → 本地模式返回 None」的全部逻辑。

### 🔴 3. 笔记文件路径三套命名并存，导致本地"重置/清空"失效

这是最实质的正确性缺陷：

- 笔记写入用 `data_path("notes.json")`（无会话后缀）：`api/notes.py#L37`。
- 但 reset/demo 删除的是 `notes_{sanitize}.json`：`api/reset.py#L18`、`api/demo.py#L52`。
- 会话工作记忆又是 `conversation_state_{sid}.json`：`core/conversation_state.py#L33`。

**本地模式（`IN_MODELSCOPE_SPACE=False`）下**，`notes.py` 全程 `session_id=None` → 写 `data/notes.json`；而 reset 经 `get_session_id` 得到 `"default"` → 删 `data/notes_default.json`（该文件不存在）。**结论：本地"重新开始/Demo 清空"删除不到真实笔记文件**，只能靠 `NoteRAG.reset()` 清向量层，`notes.json` 残留。仓库里 `aether_engine/data/notes_{...}.json` 正是旧命名方案的遗留证据。

**建议**：把「笔记文件路径解析」收敛到 `core/` 单一函数 `notes_file(session_id)`，reset/demo/notes/note_rag/bm25 全部走它。

### 🔴 4. 全局 Demo doc_id 复制 5+ 处

`"global_demo_official"` 出现在 `api/chat.py#L31`、`api/organize.py#L22`、`api/search.py#L23`、`api/demo.py#L28`（`DEMO_DOC_ID`）、`frontend/src/lib/constants.js#L2` 及 `tools/*`。

**建议**：后端定义唯一常量，前端 constants.js 注释已声明"与后端一致"，但应通过接口/单一模块对齐，避免静默漂移。

### 🔴 5. 三套并存的"原子笔记"模型，两套是死代码

- `core/models.py` 的 `Document/Section/AtomicNote/Domain`（Pydantic 富模型）——**仅被两个死模块 import**。
- `service/rag_engine.py#L16` `AtomicRAG`（旧 Chroma+networkx 图谱实现）——**0 引用**。
- `service/extractor.py#L70` `CrusherAgent`（mock LLM）——**0 引用**。
- 实际存活路径：`api/notes.py` 的 dict 笔记 + `note_rag` + `atomic_decomposer`/`note_distiller` + `knowledge_graph_store`。

三套"原子知识"字段（`concept_title/summary/keywords` vs `axiom/method/boundary` vs `axiom/methodology/boundary`）语义各不相同，极易误用。

**建议**：删除 `rag_engine.py`、`extractor.py`、`core/models.py`，或明确标注为废弃并给出迁移说明。

### 🔴 6. LLM 模型/客户端选择不统一，且存在提供商切换 Bug

- `model="deepseek-chat"` **硬编码 10 处**：`api/translate.py#L55`、`service/atomic_decomposer.py#L101`、`service/note_distiller.py#L82`、`service/latex_exporter.py#L34`、`service/arxiv_secretary.py#L122`、`api/writing.py#L323`、`api/chat.py#L511/L566/L586/L945`。
- `DEEPSEEK_CHAT_MODEL` 环境变量 **7 处**（search/parser/project_planner 等）与之并存。
- `chat.py` 内部同时有 `_call_deepseek`（#L557）/`_stream_deepseek`（#L577）与 provider-aware 的 `_call_chat_llm`（#L624）/`_stream_chat_llm`（#L644）。

**由此产生真实 Bug**：`_route_with_tools` 用 `os.getenv("DEEPSEEK_API_KEY")`（#L769）判断是否启用 function-calling Router，而主回答链用 `_get_chat_llm_config()`（#L601，支持 `CHAT_LLM_PROVIDER=aliyun`）。**配置了 ALIYUN 而未配 DeepSeek 时，Router 函数调用被静默降级为本地检索**，且 Router 本身仍写死 `deepseek-chat`（#L945）。

**建议**：抽一个 `core/llm.py` 统一 `get_llm_client()/call_llm()/stream_llm()`，所有模块（translate、atomic、distill、latex、planner、arxiv_secretary、writing、chat）复用。

### 🔴 7. arXiv 检索/解析三处重复

`api/chat.py#L668` `_search_arxiv_external` 与 `api/writing.py#L76` `_search_arxiv_external` 几乎逐字相同；`api/arxiv.py#L39` `_parse_arxiv_response` 是第三份正则解析（被 arxiv_secretary 复用）。三份正则各自维护，字段输出不完全一致。

**建议**：保留 `api/arxiv.py` 为唯一 arXiv 客户端，chat/writing/secretary 都调用它。

### 🟠 8. Markdown 分段三份实现

`service/parser.py#L171` `_split_sections`、`service/doc_rag.py#L28` `_split_markdown`、`service/extractor.py#L18` `parse_markdown_to_sections`，外加 `tools/regen_bundle_from_markdown.py#L47` 又复制了一份 `_split_sections`。

**建议**：章节切分与检索切块是两个不同语义（后者带 overlap/硬切），保留两者但放到同一 `service/markdown.py`，删除 extractor 与 tools 中的副本。

### 🟠 9. 配置重复三处

`app.py` 内联硬编码 ModelScope 缓存目录/MinerU/端口（#L20-L240），`config/settings.py` 又以**相同默认值**再写一遍（`MODELSCOPE_CACHE#L37`、`UVICORN_PORT#L23`），`Dockerfile` 再 `ENV UVICORN_PORT=7860`。`.env` 加载也有两套路径（`app.py` 的 `_MS_ENV/_REPO_ENV` vs `settings.py` 的 `../../.env` 与 `../.env`）。

**建议**：环境判定与所有默认值统一收口到 `config/settings.py`，`app.py` 只调用。

### 🟠 10. 依赖清单三份且互斥

- `aether_engine/requirements.txt`：含 `modelscope>=1.10.0`，**无 torch、无 pytest/pypdf/matplotlib**。
- `environment.yml`：含 `torch>=2.5.0`、`pytest/pypdf/matplotlib`，**注释明言"排除 modelscope/mineru"**。
- `Dockerfile#L23-L40`：ad-hoc `pip install ... || true/exit 1`，注释称"与 requirements.txt 对齐"，但版本未锁、集合不同。

**建议**：以 `requirements.txt` 为唯一真相，`environment.yml` 引用 pip 段，`Dockerfile` 直接 `pip install -r`。

### 🟠 11. "写后同步"样板复制 7+ 处

`note_rag.sync_notes()` + `bm25.invalidate()` + `knowledge_graph.upsert_note_node()` 三段式后台线程，在 `api/notes.py`（4 处）、`api/note.py#L75-L88`、`api/arxiv_secretary.py#L62-L77`、`service/zotero_sync.py#L75-L90` 重复出现。

**建议**：抽 `service/sync.py::sync_note_after_write(session_id, note_id)` 一处实现，所有调用点复用。

---

## 二、数据与路径正确性

### 🔴 12. 双 `data/` 目录 + parse_images 不尊重 DATA_DIR

运行时数据根是 CWD 相对 `data/`（`app.py#L16` 锚定到仓库根 → `core/paths.py`），但：

- `service/parser.py#L43` 硬编码 `aether_engine/data/parse_images`，**不受 `DATA_DIR` 隔离控制**（评测脚本切 `DATA_DIR` 时解析图片仍写正式目录）。
- `Dockerfile#L50-L51` `mkdir -p /home/user/app/aether_engine/data/{documents,chroma_store}` 创建的是**运行时用不到的目录**（运行期写在 `/home/user/app/data/`）。
- 仓库内同时存在 `data/`（运行时）与 `aether_engine/data/`（遗留）两棵树，`notes.json` 各一份（2.2MB vs 420KB），是 CWD 锚定脆弱性的直接产物。

**建议**：`parse_images` 改走 `data_path("parse_images")`；Dockerfile 改为 `mkdir -p /home/user/app/data/{documents,chroma_store}`；清理遗留 `aether_engine/data/`。

### 🟠 13. `BM25Engine.invalidate()` 语义失效

`bm25_engine.py#L468-L480` 只清内存、不删磁盘 pickle；而 `_try_load_cache`（#L195）按 mtime/size 签名判定。**源文件未变时，invalidate 之后再次 build 仍会命中旧缓存**，"标记失效、下次空重建"的注释与行为不符。目前 reset 场景碰巧因删了 notes 文件才绕过，但语义本身是错的。

**建议**：`invalidate()` 同时删除对应 pickle 文件。

### 🟠 14. `note_rag.search()` 每次全量同步

`note_rag.py#L150` 每次检索前 `sync_notes()`：全文读取 2.2MB `notes.json` + 逐条 MD5 比对。高频检索下是明显性能隐患。

**建议**：以文件 mtime 做粗粒度跳过，或由写路径显式触发同步。

### 🟡 15. `parser.py` 硬编码本机路径

`service/parser.py#L112` 写死 `D:\anaconda\envs\py-agent\Scripts\magic-pdf.exe`，不应进入提交。

### 🟠 16. `conversation_state` 六字段三死

`intent`、`subquestions` 从未读取；`concluded` 只写不读（`_build_synthesis_prompt` 用 `body.history` 重算摘要而非读 `state["concluded"]`）。真正生效的只有 `evidence_cache`/`last_question`/`turn`。

**建议**：要么在 prompt 中真正消费 `concluded`/`intent`，要么删除死字段，消除"文档承诺的多跳拆解/已确认结论"与实现脱节。

---

## 三、代码简洁合理 / 结构规范

### 🔴 17. `chat.py` 1809 行，两套几乎相同的编排

`chat()`（#L1309）与 `_chat_stream_generator()`（#L1491）重复了完整流程（editor_action 规划 → skip_rag → followup 复用 → route → sanitize → synthesize → `_finalize`），仅同步/流式与 SSE 包裹不同，约 2×180 行重复。

**建议**：合并为单一 `_run_chat(...)` 返回事件流，`chat()` 聚合为非流式响应。

### 🟠 18. `organize.py` 两端点前置逻辑重复

`/graph`（#L436）与 `/triples`（#L484）的 notes/docs/domain 过滤、`docs_map`、`_load_doc_chunks`、建图、trim 约 30 行逐字重复；`_build_graph` 单函数 ~300 行。

**建议**：抽 `_load_organize_inputs()` 公共函数，拆分 `_build_graph`。

### 🟠 19. 私有函数被跨模块当公共 API 用

`api/sections.py#L9` 导入 `service.parser._llm_enhance_summary/_split_sections`；`service/zotero_sync.py`/`api/search.py` 导入 `api.notes._load_notes`。下划线私有函数边界被打破，重构时极易断裂。

**建议**：为跨模块复用升格为公开函数并移动至 service 层。

### 🟠 20. 死代码/冗余定义

- `api/domains.py#L27-L29` 的 `DOMAINS_ROOT/DOMAINS_FILE` 与 `api/documents.py#L30-L32` 的 `DOC_ROOT/META_FILE` 定义后从未使用，实际用 `data_path("documents")` 重算。
- `repository/__init__.py` 空壳。

**建议**：删除。

### 🟡 21. HTTP 风格不统一

`arxiv.py` 用 `httpx.AsyncClient`，`writing.py`/`latex_exporter.py`/`arxiv_secretary.py`/`zotero_client.py` 用同步 `httpx`。同步客户端阻塞事件循环（writing/assist、resolve-citation 等 `def` 端点跑在线程池尚可，但风格不统一）。

**建议**：统一为 async 或显式 `asyncio.to_thread`。

### 🟡 22. `translate.py` 无 Key 返回假数据

`api/translate.py#L33-L38` 无 `DEEPSEEK_API_KEY` 时返回 `[Mock 翻译] …` 且 `is_mock=True`。生产环境把 mock 内容当真实翻译返回，与其它模块"无 Key 走诚实 fallback/503"口径不一致（如 `sections.py#L22-L26` 明确 503）。

**建议**：无 Key 返回 503，或明确标注不可用，禁止混入正式翻译。

---

## 四、文档一致性

### 🔴 23. `search.py` 内部 docstring 与代码权重不符

`api/search.py#L588` 注释写「文档向量(1.8) + 文档BM25(**1.5**) + 笔记向量(0.9) + 笔记BM25(0.7) + 截图OCR(0.5)」，但代码实际为：doc_vector=1.8、doc_bm25=`RAG_BM25_WEIGHT`（默认 **1.0**）、note_vector=0.9、note_bm25=0.7、graph 1.0/0.85/0.75（docstring 完全未提 graph 权重）。

**建议**：docstring 改为「权重表见代码常量」，或引入单一 `CHANNEL_WEIGHTS` 字典供注释与代码共同引用。

### 🟠 24. README 的"会话隔离"未注明仅创空间生效

`README.md` 称「`X-Session-ID` 隔离」，但本地模式（`IN_MODELSCOPE_SPACE=False`）下**所有 API 强制 `session_id=None`**，隔离完全不生效。文档未说明该前提，易误导本地联调。

### 🟠 25. 依赖文档三处互斥（承接 #10）

Dockerfile 注释「与 requirements.txt 对齐」、environment.yml 注释「排除 modelscope/mineru」与 requirements.txt「含 modelscope」互相矛盾。

### 🟡 26. "Domain" 概念两义 + 注释与实际路径不符

`api/domains.py#L15` 注释「与 documents 并列」，但 `domains.json` 实际写在 `data/documents/domains.json`（#L36）。同时 `core/models.py` 的 `Domain(domain_id+documents)` 与 `api/domains.py` 的 `DomainItem(id+name+created_at)` 是两套语义。

### 🟡 27. "截图 OCR" 通道名不副实

`_extract_screenshot_texts`（`api/search.py#L495`）只是对笔记 text 做 token-overlap 打分，注释自认「未来可接真 OCR」，但通道名 `screenshot_ocr` 与 docstring「截图 OCR」对外暗示有 OCR 能力。**学术/算法规范角度**：这是"通道命名与实现不符"，会误导评测口径（消融报告中 `screenshot_ocr` 通道并不存在真实 OCR 增益）。

---

## 五、算法/学术视角的补充观察（供专家判断）

1. **加权 RRF 的权重绑死在通道内、且随轮次变化**（doc_vector 首轮 1.8、次轮 1.2；doc_bm25 首轮 1.0、次轮 0.6），融合权重与轮次耦合，消融实验（`eval_*` 大量 CSV）的可复现性依赖"首轮/次轮"这一隐性状态，建议将权重表外置为单点配置并纳入实验清单。
2. **`_reviewer_heuristic`（`chat.py#L235`）把平均相似度 `avg*10` 当作"证据融合评分 X/10"呈现给用户**，这是无校准的伪指标。学术规范上应向用户标明"启发式相关度估计"，或改用有定义的 metric，避免把软分数包装成客观评分。
3. **`score = max(0, 1-dist)`（doc_rag/note_rag）隐含 cosine 空间**；`rag_engine.py`（死代码）未设 `hnsw:space`，若有人复活它会出现距离量纲错误——再次印证死代码应删除而非留存。

---

## 六、优先修复路线图

| 优先级 | 事项 | 影响 |
|---|---|---|
| P0 | #3 笔记路径统一（修复本地重置失效） | 数据正确性 |
| P0 | #6 LLM 客户端统一（修复 ALIYUN 路由失效） | 核心链路 |
| P1 | #12 双 data 目录 + parse_images 走 DATA_DIR；#13 bm25 invalidate | 隔离/缓存正确性 |
| P1 | #1/#2/#4 环境判定、会话获取、demo id 单点化 | 单一事实来源 |
| P1 | #17 chat 编排合并；#11 写后同步收敛 | 可维护性 |
| P1 | #5/#20 删除死代码（rag_engine/extractor/core.models/冗余常量） | 降低误用风险 |
| P2 | #7/#8/#23 arXiv/分段/权重文档收敛 | 一致性 |
| P2 | #10/#25 依赖清单单点化 | 部署可复现 |
| P3 | #15/#21/#22 硬编码路径、HTTP 风格、mock 翻译 | 整洁度 |
