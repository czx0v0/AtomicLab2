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
const MARKDOWN_CACHE_KEY = 'atomiclab_markdown_cache';

/** 刷新后恢复当前文献 URL，便于笔记 bbox 重新裁图（File 上传仍无法跨刷新恢复） */
const PDF_URL_KEY = 'atomiclab_pdf_url';
const PDF_NAME_KEY = 'atomiclab_pdf_name';
const PDF_DOC_ID_KEY = 'atomiclab_active_doc_id';

function loadPersistedPdfState() {
  try {
    return {
      pdfUrl: sessionStorage.getItem(PDF_URL_KEY) || null,
      pdfFileName: sessionStorage.getItem(PDF_NAME_KEY) || '',
      activeDocId: sessionStorage.getItem(PDF_DOC_ID_KEY) || '',
    };
  } catch {
    return { pdfUrl: null, pdfFileName: '', activeDocId: '' };
  }
}

function persistPdfUrlState(url, name, docId) {
  try {
    if (url) sessionStorage.setItem(PDF_URL_KEY, url);
    else sessionStorage.removeItem(PDF_URL_KEY);
    if (name != null) sessionStorage.setItem(PDF_NAME_KEY, name);
    if (docId != null) sessionStorage.setItem(PDF_DOC_ID_KEY, docId);
  } catch {}
}

function clearPersistedPdfState() {
  try {
    sessionStorage.removeItem(PDF_URL_KEY);
    sessionStorage.removeItem(PDF_NAME_KEY);
    sessionStorage.removeItem(PDF_DOC_ID_KEY);
  } catch {}
}

// ── 学术课题 / 投稿进度（Project & Submission）────────────────────────────
/** @typedef {'Plan'|'Reading'|'Drafting'|'Reviewing'|'Submitted'|'Rebuttal'} ProjectStatus */
export const PROJECT_STATUSES = ['Plan', 'Reading', 'Drafting', 'Reviewing', 'Submitted', 'Rebuttal'];

export const PROJECT_STATUS_LABELS = {
  Plan: '选题',
  Reading: '文献储备',
  Drafting: '草稿中',
  Reviewing: '同行评审',
  Submitted: '已投递',
  Rebuttal: '返修',
};

/** sessionStorage：本标签页内仅注入一次截稿催更消息 */
export const PROJECT_REMINDER_SESSION_KEY = 'atomiclab_project_deadline_reminder';

/** localStorage：持久化课题标题、目标类型、截止日期（用户可改，非写死会议名） */
export const PROJECT_LOCAL_STORAGE_KEY = 'atomiclab_projects_v1';

function loadPersistedProjectsState() {
  try {
    const raw = localStorage.getItem(PROJECT_LOCAL_STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || !Array.isArray(data.projects) || data.projects.length === 0) return null;
    const id = typeof data.activeProjectId === 'string' ? data.activeProjectId : data.projects[0]?.id;
    const projects = data.projects.filter(
      (p) => p && typeof p.id === 'string' && typeof p.title === 'string' && typeof p.target_journal === 'string' && p.deadline && p.status
    );
    if (projects.length === 0) return null;
    const activeProjectId = projects.some((p) => p.id === id) ? id : projects[0].id;
    return { projects, activeProjectId };
  } catch {
    return null;
  }
}

function persistProjectsState(projects, activeProjectId) {
  try {
    localStorage.setItem(PROJECT_LOCAL_STORAGE_KEY, JSON.stringify({ projects, activeProjectId }));
  } catch {}
}

/** @param {string} iso ISO 8601 截止日期 */
export function daysUntilDeadline(iso) {
  if (!iso) return Infinity;
  const end = new Date(iso);
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  end.setHours(0, 0, 0, 0);
  return Math.ceil((end.getTime() - start.getTime()) / 86400000);
}

function makeDeadlineIsoDaysFromNow(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(23, 59, 59, 999);
  return d.toISOString();
}

/** 截止日期 ISO → `<input type="date">` 用的 yyyy-mm-dd（本地日历日） */
export function deadlineIsoToDateInput(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** `<input type="date">` → 当日 23:59:59.999 的 ISO 字符串 */
export function dateInputToDeadlineIso(yyyymmdd) {
  if (!yyyymmdd || !/^\d{4}-\d{2}-\d{2}$/.test(yyyymmdd)) return makeDeadlineIsoDaysFromNow(5);
  const d = new Date(`${yyyymmdd}T23:59:59.999`);
  return Number.isNaN(d.getTime()) ? makeDeadlineIsoDaysFromNow(5) : d.toISOString();
}

/** 默认课题（可被用户覆盖并写入 localStorage） */
export const MOCK_PROJECT = {
  id: 'proj-default',
  title: '我的课题',
  target_journal: '毕业论文',
  deadline: makeDeadlineIsoDaysFromNow(5),
  status: 'Drafting',
};

function buildProjectDeadlineReminder(project) {
  const days = daysUntilDeadline(project.deadline);
  const d = Math.max(0, days);
  const stage = PROJECT_STATUS_LABELS[project.status] || project.status;
  const target = project.target_journal || '当前任务';
  return `⚠️ 侦测到您的课题《${project.title}》（${target}）距离截止日期仅剩 ${d} 天！当前处于 [${stage}] 阶段。需要我帮您检查格式，或者模拟同行评审 (Peer Review) 吗？`;
}

const persistedProjectState = loadPersistedProjectsState();
const defaultProjectsSeed = () => [{ ...MOCK_PROJECT, deadline: makeDeadlineIsoDaysFromNow(5) }];

function getInitialMarkdown() {
  try {
    const cached = sessionStorage.getItem(MARKDOWN_CACHE_KEY);
    if (cached && cached.trim()) return cached;
  } catch {}
  return '# 研究笔记\n\n在此开始写作...\n\n## 研究问题\n\n';
}

export const useStore = create((set, get) => ({
      // ── 布局与视图 ─────────────────────────────────────────────────────────
      isZenMode: false,
      toggleZenMode: () => set((s) => ({ isZenMode: !s.isZenMode })),

      viewMode: 'read', // 'read' | 'organize' | 'write'（ArXiv/对话在 Organize 子视图）
      setViewMode: (mode) =>
        set((s) => {
          // #region agent log
          fetch('http://127.0.0.1:7911/ingest/d425475d-29d6-4d24-8a29-340d5c8049ce',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'360e80'},body:JSON.stringify({sessionId:'360e80',runId:'pre-fix',hypothesisId:'H4',location:'useStore.js:setViewMode',message:'view mode transition',data:{from:s.viewMode,to:mode,markdownLen:(s.markdownContent||'').length},timestamp:Date.now()})}).catch(()=>{});
          // #endregion
          const patch = { viewMode: mode };
          // 进入写作页前：保证 markdown 为字符串，避免 RightColumn 对非 string 调用 slice 崩溃
          if (mode === 'write' && typeof s.markdownContent !== 'string') {
            patch.markdownContent = getInitialMarkdown();
          }
          return patch;
        }),
      writeRefTab: 'notes', // write 右侧固定栏 tab: notes | atomic | graph
      setWriteRefTab: (tab) => set({ writeRefTab: tab }),
      mobileReferenceOpen: false, // 移动端写作参考资料半屏抽屉
      setMobileReferenceOpen: (v) => set({ mobileReferenceOpen: v }),

      // ── PDF 状态 ────────────────────────────────────────────────────────────
      pdfFile: null,          // File 对象（不持久化）
      pdfUrl: null,           // 支持Arxiv链接
      pdfFileName: '',
      activeDocId: '',
      pdfDocument: null,      // react-pdf Document onLoadSuccess 返回对象（运行态）
      pdfNumPages: null,
      setPdfRuntime: (pdfDocument, numPages) =>
        set({ pdfDocument: pdfDocument ?? null, pdfNumPages: Number.isFinite(numPages) ? numPages : null }),
      resetPdfRuntime: () => set({ pdfDocument: null, pdfNumPages: null }),
      setPdfFile: (file) => {
        try {
          sessionStorage.removeItem(PDF_URL_KEY);
          if (file?.name) sessionStorage.setItem(PDF_NAME_KEY, file.name);
          sessionStorage.removeItem(PDF_DOC_ID_KEY);
        } catch {}
        set({
          pdfFile: file,
          pdfUrl: null,
          pdfFileName: file?.name ?? '',
          activeDocId: '',
          currentPage: 1,
          pdfDocument: null,
          pdfNumPages: null,
        });
      },
      setPdfUrl: (url, name, docId = '') => {
        persistPdfUrlState(url, name, docId);
        set({
          pdfFile: null,
          pdfUrl: url,
          pdfFileName: name,
          activeDocId: docId,
          currentPage: 1,
          pdfDocument: null,
          pdfNumPages: null,
        });
      },
      currentPage: 1,
      setCurrentPage: (pageOrUpdater) =>
        set((s) => {
          const next =
            typeof pageOrUpdater === 'function'
              ? pageOrUpdater(s.currentPage)
              : pageOrUpdater;
          const n = Number(next);
          return { currentPage: Number.isFinite(n) ? Math.max(1, Math.floor(n)) : s.currentPage };
        }),
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
      markdownContent: getInitialMarkdown(),
      setMarkdownContent: (content) =>
        set((s) => {
          const next = typeof content === 'string' ? content : content == null ? '' : String(content);
          try { sessionStorage.setItem(MARKDOWN_CACHE_KEY, next); } catch {}
          // #region agent log
          fetch('http://127.0.0.1:7911/ingest/d425475d-29d6-4d24-8a29-340d5c8049ce',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'360e80'},body:JSON.stringify({sessionId:'360e80',runId:'pre-fix',hypothesisId:'H4',location:'useStore.js:setMarkdownContent',message:'markdown content mutation',data:{prevLen:(s.markdownContent||'').length,nextLen:next.length,viewMode:s.viewMode},timestamp:Date.now()})}).catch(()=>{});
          // #endregion
          return { markdownContent: next };
        }),
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

      /** Organize 中栏子 Tab（deck/inbox/…），任务中心等跳转后由 NexusPanel 消费并清空 */
      pendingOrganizeTab: null,
      setPendingOrganizeTab: (tab) => set({ pendingOrganizeTab: tab }),

      // ── 原子助手边栏与上下文附件 ─────────────────────────────────────────────
      copilotOpen: false,
      setCopilotOpen: (v) => set({ copilotOpen: v }),
      contextAttachment: null, // { text: string, page?: number, docName?: string, noteId?: string }
      setContextAttachment: (a) => set({ contextAttachment: a }),

      // ── 写作区「插入到光标」：参考面板点击 [+] 时写入，RightColumn 消费后清空 ─────
      pendingInsert: null,
      setPendingInsert: (text) => set({ pendingInsert: text }),
      // Agent Tool Calling：后端下发编辑器动作，RightColumn 消费执行
      pendingEditorAction: null, // { function:'update_markdown_editor', action_type:'append|replace|insert', content:string }
      setPendingEditorAction: (action) => set({ pendingEditorAction: action || null }),

      // ── 学术课题（投稿与进度，持久化至 localStorage）──────────────────────────
      /** @type {{ id: string, title: string, target_journal: string, deadline: string, status: ProjectStatus }[]} */
      projects: persistedProjectState?.projects ?? defaultProjectsSeed(),
      activeProjectId: persistedProjectState?.activeProjectId ?? MOCK_PROJECT.id,
      setProjects: (projects) => {
        const arr = Array.isArray(projects) ? projects : [];
        set({ projects: arr });
        const s = get();
        persistProjectsState(s.projects, s.activeProjectId);
      },
      setActiveProjectId: (id) => {
        set({ activeProjectId: id });
        const s = get();
        persistProjectsState(s.projects, s.activeProjectId);
      },
      updateProject: (id, patch) =>
        set((s) => {
          const projects = s.projects.map((p) => (p.id === id ? { ...p, ...patch } : p));
          persistProjectsState(projects, s.activeProjectId);
          return { projects };
        }),

      /** 助手展开时调用：截稿不足 7 天则在消息列表最前插入一条 Agent 催更（每会话一次） */
      ensureProjectDeadlineReminder: () => {
        let blocked = false;
        try {
          blocked = sessionStorage.getItem(PROJECT_REMINDER_SESSION_KEY) === '1';
        } catch {}
        if (blocked) return;
        const s = get();
        const ap = s.projects.find((p) => p.id === s.activeProjectId);
        if (!ap) return;
        const daysLeft = daysUntilDeadline(ap.deadline);
        if (daysLeft >= 7) return;
        if (s.messages.some((m) => m.projectReminder)) {
          try {
            sessionStorage.setItem(PROJECT_REMINDER_SESSION_KEY, '1');
          } catch {}
          return;
        }
        const msg = {
          id: `proj-reminder-${Date.now()}`,
          role: 'agent',
          agentType: 'system',
          content: buildProjectDeadlineReminder(ap),
          projectReminder: true,
        };
        set({ messages: [msg, ...s.messages].slice(-80) });
        try {
          sessionStorage.setItem(PROJECT_REMINDER_SESSION_KEY, '1');
        } catch {}
      },

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
        set((s) => {
          try {
            sessionStorage.removeItem(PROJECT_REMINDER_SESSION_KEY);
          } catch {}
          clearPersistedPdfState();
          // #region agent log
          fetch('http://127.0.0.1:7911/ingest/d425475d-29d6-4d24-8a29-340d5c8049ce',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'360e80'},body:JSON.stringify({sessionId:'360e80',runId:'pre-fix',hypothesisId:'H4',location:'useStore.js:startOver',message:'startOver called',data:{viewMode:s.viewMode,markdownLen:(s.markdownContent||'').length,activeDocId:s.activeDocId||''},timestamp:Date.now()})}).catch(()=>{});
          // #endregion
          return {
          pdfFile: null,
          pdfUrl: null,
          pdfFileName: '',
          activeDocId: '',
          pdfDocument: null,
          pdfNumPages: null,
          notes: [],
          messages: [
            {
              id: 1,
              role: 'agent',
              agentType: 'system',
              content: '欢迎来到 AtomicLab！上传 PDF 开始原子化解析，或直接提问让 Seeker 为你检索知识库。',
            },
          ],
          // 课题设置保留在 localStorage，不在「重新开始」时清空
          parseStatus: 'idle',
          parseProgress: [],
          parsedMarkdown: '',
          parsedSections: [],
          parsedDocName: '',
          currentPage: 1,
          graphData: { nodes: [], links: [] },
          noteLinks: [],
          searchResults: [],
          searchQuery: '',
          references: [],
          pendingOrganizeTab: null,
          };
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
