import { create } from 'zustand';

export const useStore = create((set) => ({
  isZenMode: false,
  toggleZenMode: () => set((state) => ({ isZenMode: !state.isZenMode })),
  
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
  
  // Pomodoro State
  isPomodoroActive: false,
  pomodoroTime: 25 * 60, // 25 minutes
  togglePomodoro: () => set((state) => ({ isPomodoroActive: !state.isPomodoroActive })),
  decrementPomodoro: () => set((state) => ({ pomodoroTime: Math.max(0, state.pomodoroTime - 1) })),
  resetPomodoro: (time) => set({ pomodoroTime: time, isPomodoroActive: false }),
}));
