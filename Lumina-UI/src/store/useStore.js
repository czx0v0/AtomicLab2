import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

export const useStore = create(
  persist(
    (set, get) => ({
      // ── 布局与视图 ─────────────────────────────────────────────────────────
      isZenMode: false,
      toggleZenMode: () => set((s) => ({ isZenMode: !s.isZenMode })),

      viewMode: 'read', // 'read' | 'organize' | 'write' | 'chat' | 'arxiv'
      setViewMode: (mode) => set({ viewMode: mode }),

      // ── PDF 状态 ────────────────────────────────────────────────────────────
      pdfFile: null,          // File 对象（不持久化）
      pdfFileName: '',
      setPdfFile: (file) => set({ pdfFile: file, pdfFileName: file?.name ?? '' }),
      currentPage: 1,
      setCurrentPage: (page) => set({ currentPage: page }),
      highlights: [],
      addHighlight: (highlight) =>
        set((s) => ({ highlights: [...s.highlights, highlight] })),
      clearHighlights: () => set({ highlights: [] }),

      // ── 导航 & 交叉引用 ────────────────────────────────────────────────────
      activeReference: null, // { page: number, bbox: [x,y,w,h] }
      setActiveReference: (ref) =>
        set({ activeReference: ref, currentPage: ref?.page ?? get().currentPage }),

      // ── 编辑器状态（持久化） ────────────────────────────────────────────────
      markdownContent: '# 研究笔记\n\n在此开始写作...\n\n## 研究问题\n\n',
      setMarkdownContent: (content) => set({ markdownContent: content }),
      citations: [
        { id: '1', key: 'vaswani2017attention', title: 'Attention Is All You Need', authors: 'Vaswani et al.' },
        { id: '2', key: 'devlin2018bert', title: 'BERT: Pre-training', authors: 'Devlin et al.' },
      ],

      // ── 原子笔记（持久化本地，后端同步） ────────────────────────────────────
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
      addMessage: (msg) => set((s) => ({ messages: [...s.messages, msg] })),
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
      setParseStatus: (status) => set({ parseStatus: status }),
      addParseLog: (msg) =>
        set((s) => ({ parseProgress: [...s.parseProgress, msg] })),
      setParsedMarkdown: (md) => set({ parsedMarkdown: md }),
      clearParseState: () =>
        set({ parseStatus: 'idle', parseProgress: [], parsedMarkdown: '' }),

      // ── 后端连接状态 ────────────────────────────────────────────────────────
      backendOnline: false,
      setBackendOnline: (v) => set({ backendOnline: v }),
    }),
    {
      name: 'atomiclab-storage',
      storage: createJSONStorage(() => localStorage),
      // 只持久化文本内容、笔记和设置，不持久化 File 对象和临时状态
      partialize: (state) => ({
        markdownContent: state.markdownContent,
        notes: state.notes,
        highlights: state.highlights,
        viewMode: state.viewMode,
        pomodoroMinutes: state.pomodoroMinutes,
        messages: state.messages.slice(-50), // 只保留最近 50 条
      }),
    }
  )
);
