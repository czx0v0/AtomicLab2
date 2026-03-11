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

      viewMode: 'read', // 'read' | 'organize' | 'write' | 'chat' | 'arxiv'
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
        set((s) => ({ highlights: [...s.highlights, highlight] })),
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

      // ── 原子笔记（会话态 + 后端同步） ──────────────────────────────────────
      notes: [],
      setNotes: (notes) => set({ notes }),
      addNote: (note) => set((s) => ({ notes: [note, ...s.notes] })),
      removeNote: (id) => set((s) => ({ notes: s.notes.filter((n) => n.id !== id) })),

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

      // ── 后端连接状态 ────────────────────────────────────────────────────────
      backendOnline: false,
      setBackendOnline: (v) => set({ backendOnline: v }),
}));
