import { create } from 'zustand';

// 生成或恢复会话 ID
function getOrCreateSessionId() {
  const key = 'atomiclab_session_id';
  let sid = sessionStorage.getItem(key);
  if (!sid) {
    sid = crypto.randomUUID();
    sessionStorage.setItem(key, sid);
  }
  return sid;
}

export const SESSION_ID = getOrCreateSessionId();

export const useStore = create((set, get) => ({
      // ── 布局与视图 ─────────────────────────────────────────────────────────
      isZenMode: false,
      toggleZenMode: () => set((s) => ({ isZenMode: !s.isZenMode })),

      viewMode: 'read', // 'read' | 'organize' | 'write'（ArXiv/对话在 Organize 子视图）
      setViewMode: (mode) => set({ viewMode: mode }),

      // ── PDF 状态 ────────────────────────────────────────────────────────────
      pdfFile: null,          // File 对象（不持久化）
      pdfUrl: null,           // 支持Arxiv链接
      pdfFileName: '',
      activeDocId: '',
      setPdfFile: (file) => set({ pdfFile: file, pdfUrl: null, pdfFileName: file?.name ?? '' }),
      setPdfUrl: (url, name, docId = '') => set({ pdfFile: null, pdfUrl: url, pdfFileName: name, activeDocId: docId }),
      currentPage: 1,
      setCurrentPage: (page) => set({ currentPage: page }),
      highlights: [],
      addHighlight: (highlight) =>
        set((s) => {
          const id = highlight?.id ?? Date.now();
          const entry = { ...highlight, id };
          if (s.highlights.some((h) => h.id === id)) return {};
          return { highlights: [...s.highlights, entry] };
        }),
      clearHighlights: () => set({ highlights: [] }),

      // ── 文献库 ──────────────────────────────────────────────────────────────
      library: [], // [{ id, name, addedAt, source: 'upload'|'arxiv', arxivId?, noteCount }]
      addToLibrary: (doc) =>
        set((s) => {
          if (s.library.some((d) => d.id === doc.id)) return {};
          return { library: [...s.library, doc] };
        }),
      removeFromLibrary: (id) =>
        set((s) => ({ library: s.library.filter((d) => d.id !== id) })),

      // ── 导航 & 交叉引用 ────────────────────────────────────────────────────
      activeReference: null, // { page: number, bbox: [x,y,w,h] }
      setActiveReference: (ref) =>
        set({ activeReference: ref, currentPage: ref?.page ?? get().currentPage }),

      // ── 编辑器状态（会话态） ────────────────────────────────────────────────
      markdownContent: '# 研究笔记\n\n在此开始写作...\n\n## 研究问题\n\n',
      setMarkdownContent: (content) => set({ markdownContent: content }),
      citations: [],
      // 参考文献列表（写作区引用）[{ id, key, title, authors, year, doi, url, journal, source }]
      references: [],
      setReferences: (refs) => set({ references: Array.isArray(refs) ? refs : [] }),
      addReference: (ref) =>
        set((s) => {
          const nextKey = String((s.references.length || 0) + 1);
          const entry = {
            id: ref?.id ?? crypto.randomUUID(),
            key: ref?.key ?? nextKey,
            title: ref?.title ?? '',
            authors: ref?.authors ?? '',
            year: ref?.year ?? '',
            doi: ref?.doi ?? '',
            url: ref?.url ?? '',
            journal: ref?.journal ?? '',
            source: ref?.source ?? '',
          };
          return { references: [...s.references, entry] };
        }),

      // ── 原子笔记（会话态 + 后端同步） ──────────────────────────────────────
      notes: [],
      setNotes: (notes) => set({ notes }),
      addNote: (note) =>
        set((s) => {
          const id = note?.id ?? crypto.randomUUID();
          const entry = { ...note, id };
          const byId = s.notes.findIndex((n) => n.id === id);
          if (byId >= 0) {
            const next = [...s.notes];
            next[byId] = entry;
            return { notes: next };
          }
          return { notes: [entry, ...s.notes] };
        }),
      removeNote: (id) => set((s) => ({ notes: s.notes.filter((n) => n.id !== id) })),
      updateNoteContent: (id, content) =>
        set((s) => ({
          notes: s.notes.map((n) => (n.id === id ? { ...n, content } : n)),
        })),

      // ── 截图/高亮待识别队列（加入时未解析出文字则入队，切页或解析完成后尝试补全）──
      pendingScreenshotQueue: [], // [{ noteId, page, bbox }]
      addPendingScreenshot: (item) =>
        set((s) => ({ pendingScreenshotQueue: [...s.pendingScreenshotQueue, item] })),
      removePendingScreenshot: (noteId) =>
        set((s) => ({
          pendingScreenshotQueue: s.pendingScreenshotQueue.filter((p) => p.noteId !== noteId),
        })),

      // ── 搜索状态 ────────────────────────────────────────────────────────────
      searchQuery: '',
      setSearchQuery: (q) => set({ searchQuery: q }),
      searchStatus: 'idle', // 'idle' | 'tokenizing' | 'vector' | 'fusion' | 'done' | 'error'
      setSearchStatus: (status) => set({ searchStatus: status }),
      searchResults: [],
      setSearchResults: (results) => set({ searchResults: results }),

      // ── 知识图谱 ────────────────────────────────────────────────────────────
      graphData: { nodes: [], links: [] },
      setGraphData: (data) => set({ graphData: data }),

      // ── 笔记间手动连接（在图谱中显示为边）────────────────────────────────────
      noteLinks: [], // [{ sourceId, targetId }]
      addNoteLink: (sourceId, targetId) =>
        set((s) => {
          if (sourceId === targetId) return {};
          const exists = s.noteLinks.some((l) => (l.sourceId === sourceId && l.targetId === targetId) || (l.sourceId === targetId && l.targetId === sourceId));
          if (exists) return {};
          return { noteLinks: [...s.noteLinks, { sourceId, targetId }] };
        }),
      removeNoteLink: (sourceId, targetId) =>
        set((s) => ({
          noteLinks: s.noteLinks.filter(
            (l) => !(l.sourceId === sourceId && l.targetId === targetId) && !(l.sourceId === targetId && l.targetId === sourceId)
          ),
        })),

      // ── 划词「问 AI」预填问题（从阅读区选中文字后点问 AI 跳转聊天并填入）──
      pendingChatQuestion: null,
      setPendingChatQuestion: (q) => set({ pendingChatQuestion: q }),

      // ── 原子助手边栏与上下文附件 ─────────────────────────────────────────────
      copilotOpen: false,
      setCopilotOpen: (v) => set({ copilotOpen: v }),
      contextAttachment: null, // { text: string, page?: number, docName?: string, noteId?: string }
      setContextAttachment: (a) => set({ contextAttachment: a }),

      // ── 写作区「插入到光标」：参考面板点击 [+] 时写入，RightColumn 消费后清空 ─────
      pendingInsert: null,
      setPendingInsert: (text) => set({ pendingInsert: text }),

      // ── RPG 多智能体聊天 ────────────────────────────────────────────────────
      messages: [
        {
          id: 1,
          role: 'agent',
          agentType: 'system',
          content: '欢迎来到 AtomicLab！上传 PDF 开始原子化解析，或直接提问让 Seeker 为你检索知识库。',
        },
      ],
      addMessage: (msg) =>
        set((s) => ({
          messages: [...s.messages, msg].slice(-80),
        })),
      updateLastMessage: (patch) =>
        set((s) => {
          const msgs = [...s.messages];
          if (msgs.length === 0) return {};
          msgs[msgs.length - 1] = { ...msgs[msgs.length - 1], ...patch };
          return { messages: msgs };
        }),
      clearMessages: () => set({ messages: [] }),
      isAgentThinking: false,
      setAgentThinking: (v) => set({ isAgentThinking: v }),

      // ── ArXiv 相关 ──────────────────────────────────────────────────────────
      arxivResults: [],
      setArxivResults: (results) => set({ arxivResults: results }),
      arxivQuery: '',
      setArxivQuery: (q) => set({ arxivQuery: q }),

      // ── Pomodoro / Zen Mode 计时器 ──────────────────────────────────────────
      pomodoroActive: false,
      pomodoroMinutes: 25,
      pomodoroSeconds: 0,
      zenStartTime: null,
      setPomodoroActive: (v) =>
        set((s) => ({
          pomodoroActive: v,
          zenStartTime: v ? Date.now() : s.zenStartTime,
        })),
      setPomodoroTimer: (min, sec) =>
        set({ pomodoroMinutes: min, pomodoroSeconds: sec }),
      resetPomodoro: (minutes = 25) =>
        set({ pomodoroActive: false, pomodoroMinutes: minutes, pomodoroSeconds: 0 }),

      // ── PDF 解析状态 ─────────────────────────────────────────────────────────
      parseStatus: 'idle', // 'idle' | 'parsing' | 'done' | 'error'
      parseProgress: [],   // 解析日志列表
      parsedMarkdown: '',
      parsedSections: [],  // [{ title, summary, content }]
      parsedDocName: '',
      setParseStatus: (status) => set({ parseStatus: status }),
      addParseLog: (msg) =>
        set((s) => ({ parseProgress: [...s.parseProgress, msg] })),
      setParsedMarkdown: (md, docName = '') => set({ parsedMarkdown: md, parsedDocName: docName }),
      setParsedSections: (sections) => set({ parsedSections: Array.isArray(sections) ? sections : [] }),
      addParsedSection: (section) =>
        set((s) => ({ parsedSections: [...s.parsedSections, section] })),
      updateParsedSectionSummary: (title, summary) =>
        set((s) => ({
          parsedSections: s.parsedSections.map((it) =>
            it.title === title ? { ...it, summary: summary || it.summary } : it
          ),
        })),
      clearParseState: () =>
        set({ parseStatus: 'idle', parseProgress: [], parsedMarkdown: '', parsedSections: [], parsedDocName: '' }),

      // ── 由 Header/其他处触发「加载白皮书」：LeftColumn 消费后拉取 demo PDF 并当作用户上传解析 ──
      startDemoLoad: false,
      setStartDemoLoad: (v) => set({ startDemoLoad: v }),

      // ── 重新开始（清空会话态：笔记、对话、解析结果、图谱等；需配合 api resetSession 使用）──
      startOver: () =>
        set({
          notes: [],
          messages: [
            {
              id: 1,
              role: 'agent',
              agentType: 'system',
              content: '欢迎来到 AtomicLab！上传 PDF 开始原子化解析，或直接提问让 Seeker 为你检索知识库。',
            },
          ],
          parseStatus: 'idle',
          parseProgress: [],
          parsedMarkdown: '',
          parsedSections: [],
          parsedDocName: '',
          graphData: { nodes: [], links: [] },
          noteLinks: [],
          searchResults: [],
          searchQuery: '',
          references: [],
        }),

      // ── 后端连接状态 ────────────────────────────────────────────────────────
      backendOnline: false,
      setBackendOnline: (v) => set({ backendOnline: v }),

      // ── 全局浮动通知（替代 alert/Toast，柔和像素风）────────────────────────────
      notification: null, // { message: string, type?: 'info'|'warn'|'error' }
      setNotification: (message, type = 'info') =>
        set({ notification: message ? { message, type } : null }),
      clearNotification: () => set({ notification: null }),
}));
