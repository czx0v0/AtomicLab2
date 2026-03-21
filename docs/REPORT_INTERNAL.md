# AtomicLab 对内研发版（架构/接口/排障）

## 1. 系统分层

- **API 层**：`aether_engine/api/*`
- **服务层**：`aether_engine/service/*`
- **前端层**：`frontend/src/components/*`
- **状态层**：`frontend/src/store/useStore.js`
- **部署层**：Docker + `app.py` 单端口服务

## 2. 核心链路

### 2.1 文档入库链路

1. 文档上传/加载 Demo
2. 解析为 Markdown 与结构段落
3. 写入 DocumentRAG（切块向量）与 BM25 文档索引
4. 生成可检索结果（含 `doc_id/page_num/bbox`）

### 2.2 检索链路（Hybrid）

通道：

- `doc_vector`
- `doc_bm25`
- `note_vector`
- `note_bm25`
- `graph_1hop`
- `screenshot_ocr`（可用时）

融合：

- 加权 RRF + 原始分融合
- 输出统一结果字段供前端跳转

### 2.3 对话与动作链路

1. Router 判定意图（细节问答 vs 通用/写作意图）
2. 细节问答走检索证据合成
3. 写作意图触发 function calling：`update_markdown_editor`
4. SSE 下发 `action` 事件
5. 前端消费动作并更新编辑器内容

### 2.4 翻译与发现（ArXiv 秘书）

- `POST /api/translate`：`translateText(text, targetLang)`（见 `frontend/src/api/client.js`）；发现页 `prepareSecretaryKeywords` 在含 CJK 时将关键词/目标译为英文再调 ArXiv 秘书相关接口

### 2.5 Mission Control → 前端路由

- `MissionControlFab.handleTimelineStage`：`setViewMode` + `setPendingOrganizeTab` + `setCopilotOpen` + `setPendingChatQuestion`
- `MiddleColumn`：`useEffect` 监听 `pendingOrganizeTab`, `NEXUS_ORGANIZE_TAB_IDS` 切换 Tab；`ChatMessage` 渲染 `MarkdownRenderer` + 可点击 `[n]`

## 3. 关键接口清单

### 3.1 搜索相关

- `POST /api/search`
  - 入参：`query`, `top_k`, `doc_id`, `max_rounds`
  - 出参：`results[]`, `context`, `channels`, `total`

- `POST /api/search/index-document`
  - 入参：`doc_id`, `doc_title`, `markdown`
  - 用途：文档切块写入索引

### 3.2 对话相关

- `POST /api/chat`
- `POST /api/chat/stream`
  - SSE 事件：`step`, `delta`, `action`, `done`

- `POST /api/chat/feedback`
  - 入参：`message_id`, `session_id`, `rating`, `user_comment`, `retrieved_contexts`

### 3.3 Demo 相关

- `POST /api/demo/load`
  - 全局单例解析 + 会话级挂载
- `GET /api/demo/pdf`

### 3.4 翻译（发现页 / 划词等复用）

- `POST /api/translate`
  - 入参：`text`, `target_lang`（如 `en` / `zh`）
  - 出参：`translation` 等（见 `aether_engine/api/translate.py`）

## 4. 前端状态关键字段（Zustand）

- 阅读定位：`pdfUrl`, `activeDocId`, `currentPage`, `activeReference`
- 检索状态：`searchQuery`, `searchStatus`, `searchResults`
- 写作状态：`markdownContent`, `pendingInsert`, `pendingEditorAction`
- 助手状态：`messages`, `contextAttachment`, `copilotOpen`
- 跨视图：`pendingOrganizeTab`, `pendingChatQuestion`（一次性消费，见 `useStore.js`）

## 5. 已知问题与技术债

- `RightColumn.jsx` 历史 TS 诊断较多（当前不阻塞构建）
- 历史笔记数据部分缺 `doc_id/source_name`，影响跨文献跳转完整性
- 前端主包偏大，需继续分包与懒加载

## 6. 排障手册（常见）

### 6.1 搜索有结果但无法跳转

检查：

1. 结果项是否含 `doc_id/page_num/bbox`
2. `activeDocId` 与目标 `doc_id` 是否切换成功
3. `setActiveReference` 是否被调用

### 6.2 Demo 重复解析

检查：

1. `doc_id` 是否统一为全局 Demo ID
2. 全局索引是否已存在
3. 缓存文件是否可读写

### 6.3 写作工具不触发

检查：

1. Router 是否识别为写作意图
2. SSE 是否发出 `action` 事件
3. 前端是否消费 `pendingEditorAction`

## 7. 测试建议（最小回归集）

### 7.1 E2E 用例

- 搜索关键词 -> 下拉结果 -> 点击 -> 跳转高亮
- 聊天引用 `[1]` 点击 -> 跳转高亮
- “帮我写” -> action 事件 -> 编辑器内容变化
- 写作舱 Notes/Atomic/Graph 三视图搜索与注入
- Organize **发现**：中文关键词检索 -> 应出现英译提示并成功拉取 arXiv 结果（依赖翻译 API 可用）
- Mission Control：点击时间线 **阅读** -> 应切到 Organize **发现**；点击 **审稿中** -> 助手输入框含「模拟同行评审」预填

### 7.2 指标采集

- 检索空返回率
- 跳转成功率
- 写作动作执行成功率
- 点赞/点踩比与评论密度

## 8. 近期研发优先级

1. 反馈日志 JSONL 化
2. Tool Calling 增加 `target` 粒度
3. 统一结果字段约束与后端 schema 校验
4. 引入回归脚本（接口 + UI）
