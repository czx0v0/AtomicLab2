import { create } from 'zustand';

export const useStore = create((set) => ({
  isZenMode: false,
  toggleZenMode: () => set((state) => ({ isZenMode: !state.isZenMode })),

  // Layout View Mode: 'read', 'organize', 'write', 'chat'
  viewMode: 'read',
  setViewMode: (mode) => set({ viewMode: mode }),
  panelSizes: [30, 40, 30], // [Left, Middle, Right]
  setPanelSizes: (sizes) => set({ panelSizes: sizes }),
  
  // PDF State
  pdfFile: null,
  setPdfFile: (file) => set({ pdfFile: file }),
  currentPage: 1,
  setCurrentPage: (page) => set({ currentPage: page }),
  highlights: [],
  addHighlight: (highlight) => set((state) => ({ highlights: [...state.highlights, highlight] })),
  
  // Navigation & Linkage
  activeReference: null, // { page: 3, bbox: [x,y,w,h] }
  setActiveReference: (ref) => set({ activeReference: ref, currentPage: ref.page }),

  // Editor State
  markdownContent: "# 研究笔记\n\n在此输入...",
  setMarkdownContent: (content) => set({ markdownContent: content }),
  citations: [
    { id: '1', key: 'vaswani2017attention', title: 'Attention Is All You Need', authors: 'Vaswani et al.' },
    { id: '2', key: 'devlin2018bert', title: 'BERT: Pre-training of Deep Bidirectional Transformers', authors: 'Devlin et al.' }
  ],

  // Nexus State (Organize & Chat)
  notes: [
      {
          id: 'n1',
          type: 'method', // method, formula, idea
          content: 'Self-Attention Mechanism: The model learns to weigh the importance of different words in the sentence regardless of their position.',
          translation: '自注意力机制：模型学习权衡句子中不同单词的重要性，而不管它们的位置如何。',
          page: 3,
          bbox: [100, 300, 400, 150], // x, y, w, h
          timestamp: '2023-10-27T10:00:00Z'
      },
      {
          id: 'n2',
          type: 'formula',
          content: 'Attention(Q, K, V) = softmax(QK^T / sqrt(d_k))V',
          translation: '注意力计算公式',
          page: 4,
          bbox: [150, 400, 300, 100],
          timestamp: '2023-10-27T10:05:00Z'
      },
      {
          id: 'n3',
          type: 'idea',
          content: 'The Transformer replaces recurrent layers with multi-headed self-attention.',
          translation: 'Transformer 用多头自注意力取代了循环层。',
          page: 2,
          bbox: [100, 200, 400, 100],
          timestamp: '2023-10-27T10:10:00Z'
      }
  ],
  addNote: (note) => set((state) => ({ notes: [note, ...state.notes] })),
  
  // Search State
  searchQuery: '',
  setSearchQuery: (q) => set({ searchQuery: q }),
  searchStatus: 'idle', // idle, transforming, searching, ranking, done
  setSearchStatus: (status) => set({ searchStatus: status }),
  
  // RPG Chat State
  messages: [
      {
          id: 1,
          role: 'user',
          content: 'Transformer 和 RNN 的核心区别？'
      },
      {
          id: 2,
          role: 'agent',
          agentType: 'search', // search, critic
          content: '正在检索相关文献... 发现关键概念：[Self-Attention] (Page 3) 和 [Parallelization] (Page 6)。',
          relatedNotes: ['n1', 'n3']
      },
      {
          id: 3,
          role: 'agent',
          agentType: 'critic',
          content: '传统 RNN 无法并行计算，因为当前时刻依赖上一时刻的状态。Transformer 通过自注意力解决了这个问题，极大地提高了训练效率。',
          relatedNotes: []
      }
  ],
  addMessage: (msg) => set((state) => ({ messages: [...state.messages, msg] })),

  // Write Mode Recommendations
  recommendations: [], // Current contextual recommendations for Zen Mode sidebar
  updateRecommendations: (recs) => set({ recommendations: recs }),
  
  // Pomodoro State
  
  // Pomodoro State
  isPomodoroActive: false,
  pomodoroTime: 25 * 60, // 25 minutes
  togglePomodoro: () => set((state) => ({ isPomodoroActive: !state.isPomodoroActive })),
  decrementPomodoro: () => set((state) => ({ pomodoroTime: Math.max(0, state.pomodoroTime - 1) })),
  resetPomodoro: (time) => set({ pomodoroTime: time, isPomodoroActive: false }),
}));
