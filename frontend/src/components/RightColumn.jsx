import React, { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import {
  Bold, Italic, List, Quote, Code, BookOpen, ChevronLeft, ChevronRight,
  Sparkles, FileText, Maximize2, Minimize2, Timer, TimerOff, Play, Pause,
  Square, Download, Upload, Trash2, PanelLeftOpen, Eye, EyeOff, AlignJustify, ListTree, X, Bot
} from 'lucide-react';
import { useStore } from '../store/useStore';
import { Document, Page, pdfjs } from 'react-pdf';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import rehypeHighlight from 'rehype-highlight';
import clsx from 'clsx';
import { motion, AnimatePresence } from 'framer-motion';
import * as api from '../api/client';

pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

// 行内助手建议 diff 展示：删除红、新增绿、续写灰（类似 git diff）
function getGhostDiffSegments(ghost, fullContent) {
  if (!ghost) return [];
  const { result, action, paragraphStart, paragraphEnd } = ghost;
  const orig = fullContent.slice(paragraphStart, paragraphEnd);
  if (action === 'continue') {
    return [{ type: 'continue', text: result }];
  }
  if (!orig && result) return [{ type: 'add', text: result }];
  if (orig && !result) return [{ type: 'del', text: orig }];
  if (!orig && !result) return [];
  // replace / polish 等：公共前缀 + 删除 + 新增 + 公共后缀
  let prefixLen = 0;
  const maxP = Math.min(orig.length, result.length);
  while (prefixLen < maxP && orig[prefixLen] === result[prefixLen]) prefixLen++;
  let suffixLen = 0;
  const maxS = Math.min(orig.length - prefixLen, result.length - prefixLen);
  while (suffixLen < maxS && orig[orig.length - 1 - suffixLen] === result[result.length - 1 - suffixLen]) suffixLen++;
  const del = orig.slice(prefixLen, orig.length - suffixLen);
  const add = result.slice(prefixLen, result.length - suffixLen);
  const segs = [];
  if (prefixLen > 0) segs.push({ type: 'same', text: orig.slice(0, prefixLen) });
  if (del.length > 0) segs.push({ type: 'del', text: del });
  if (add.length > 0) segs.push({ type: 'add', text: add });
  if (suffixLen > 0) segs.push({ type: 'same', text: orig.slice(orig.length - suffixLen) });
  return segs.length ? segs : [{ type: 'add', text: result }];
}

function GhostSuggestionContent({ ghost, fullContent, maxChars = 400 }) {
  const segs = getGhostDiffSegments(ghost, fullContent);
  let len = 0;
  return (
    <span className="whitespace-pre-wrap break-words">
      {segs.map((s, i) => {
        if (len >= maxChars) return null;
        const slice = s.text.length + len > maxChars ? s.text.slice(0, maxChars - len) : s.text;
        len += slice.length;
        if (s.type === 'del') return <span key={i} className="text-red-600 line-through bg-red-50/80">{slice}</span>;
        if (s.type === 'add') return <span key={i} className="text-green-700 bg-green-50/80">{slice}</span>;
        if (s.type === 'continue') return <span key={i} className="text-slate-500 bg-slate-100/80">{slice}</span>;
        return <span key={i} className="text-gray-700">{slice}</span>;
      })}
      {(ghost?.result?.length ?? 0) > maxChars ? '…' : ''}
    </span>
  );
}

// ─── 专注模式倒计时组件 ────────────────────────────────────────────────────────
const PomodoroTimer = ({ onExit }) => {
  const {
    pomodoroActive, setPomodoroActive,
    pomodoroMinutes, pomodoroSeconds,
    setPomodoroTimer, resetPomodoro,
  } = useStore();

  const totalSeconds = pomodoroMinutes * 60 + pomodoroSeconds;
  const [initialTotal] = useState(totalSeconds > 0 ? totalSeconds : 25 * 60);

  useEffect(() => {
    if (!pomodoroActive) return;
    const id = setInterval(() => {
      const mins = useStore.getState().pomodoroMinutes;
      const secs = useStore.getState().pomodoroSeconds;
      if (mins === 0 && secs === 0) {
        clearInterval(id);
        useStore.getState().setPomodoroActive(false);
        // 完成通知
        if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
          new Notification('⏰ 专注时间结束！', { body: '休息一下吧 ~' });
        }
        return;
      }
      if (secs === 0) {
        setPomodoroTimer(mins - 1, 59);
      } else {
        setPomodoroTimer(mins, secs - 1);
      }
    }, 1000);
    return () => clearInterval(id);
  }, [pomodoroActive]);

  const progress = totalSeconds / initialTotal;
  const circumference = 2 * Math.PI * 28;
  const dashOffset = circumference * (1 - progress);

  const pad = (n) => String(n).padStart(2, '0');

  return (
    <div className="flex items-center gap-3">
      {/* 环形进度 */}
      <div className="relative w-14 h-14">
        <svg className="w-full h-full -rotate-90" viewBox="0 0 64 64">
          <circle cx="32" cy="32" r="28" fill="none" stroke="rgba(120,113,108,0.15)" strokeWidth="4" />
          <circle
            cx="32" cy="32" r="28" fill="none"
            stroke={pomodoroActive ? '#d97706' : '#a8a29e'}
            strokeWidth="4"
            strokeDasharray={circumference}
            strokeDashoffset={dashOffset}
            strokeLinecap="round"
            style={{ transition: 'stroke-dashoffset 1s linear' }}
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-[9px] font-sans text-stone-600">
            {pad(pomodoroMinutes)}:{pad(pomodoroSeconds)}
          </span>
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <div className="flex gap-1">
          <button
            onClick={() => setPomodoroActive(!pomodoroActive)}
            className="p-1.5 bg-stone-100 hover:bg-stone-200 rounded text-stone-600"
            title={pomodoroActive ? '暂停' : '开始'}
          >
            {pomodoroActive ? <Pause size={12} /> : <Play size={12} />}
          </button>
          <button
            onClick={() => resetPomodoro(25)}
            className="p-1.5 bg-stone-100 hover:bg-stone-200 rounded text-stone-600"
            title="重置"
          >
            <Square size={12} />
          </button>
          <button
            onClick={onExit}
            className="p-1.5 bg-stone-100 hover:bg-red-100 rounded text-stone-400 hover:text-red-500"
            title="退出专注模式"
          >
            <Minimize2 size={12} />
          </button>
        </div>
        <span className="text-[9px] font-sans text-stone-500 uppercase">
          {pomodoroActive ? 'FOCUS' : 'READY'}
        </span>
      </div>
    </div>
  );
};

// ─── 知识卡片侧边栏 ────────────────────────────────────────────────────────────
const BrainstormDrawer = ({ isOpen, onClose }) => {
  const { notes, setActiveReference, markdownContent } = useStore();

  const related = notes.filter((n) => {
    const snippet = n.content?.substring(0, 15).toLowerCase() ?? '';
    return snippet && markdownContent.toLowerCase().includes(snippet);
  });
  const display = related.length > 0 ? related : notes.slice(0, 4);

  const insertRef = (note) => {
    const ref = `[@${note.id.substring(0, 8)}](page-${note.page ?? 1} "${note.content?.substring(0, 30)}")`;
    const el = document.getElementById('main-editor');
    if (!el) return;
    const start = el.selectionStart;
    const val = useStore.getState().markdownContent;
    useStore.getState().setMarkdownContent(val.slice(0, start) + ref + val.slice(start));
  };

  return (
    <motion.div
      initial={{ width: 0 }}
      animate={{ width: isOpen ? 260 : 0 }}
      transition={{ type: 'spring', stiffness: 300, damping: 30 }}
      className="h-full border-r border-amber-200/50 bg-amber-50 overflow-hidden flex flex-col shrink-0"
    >
      <div className="p-3 border-b border-amber-200 flex items-center justify-between bg-amber-100 min-w-[260px]">
        <span className="text-xs font-bold text-amber-800 flex items-center gap-2 font-sans">
          <Sparkles size={12} />
          BRAINSTORM
        </span>
        <button onClick={onClose} className="hover:bg-amber-200 p-1 rounded text-amber-700">
          <ChevronLeft size={14} />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-3 space-y-3 min-w-[260px]">
        {display.length === 0 && (
          <p className="text-xs text-gray-400 text-center mt-10 italic">
            暂无相关原子卡片
          </p>
        )}
        {display.map((note) => (
          <div
            key={note.id}
            className="bg-white border border-amber-300 p-2 shadow-sm text-xs cursor-pointer hover:shadow-md transition-all group"
            draggable
            onDragEnd={() => insertRef(note)}
          >
            <div className="flex justify-between mb-1 items-center">
              <span className="font-bold text-gray-700 uppercase text-[10px]">#{note.type}</span>
              <button
                className="bg-gray-100 px-1.5 py-0.5 rounded text-[10px] hover:bg-blue-100 hover:text-blue-600 flex items-center gap-1"
                onClick={() => setActiveReference({ page: note.page ?? 1, bbox: note.bbox ?? [0,0,0,0] })}
              >
                <BookOpen size={9} />
                p.{note.page}
              </button>
            </div>
            <p className="line-clamp-3 text-gray-600 leading-relaxed">{note.content}</p>
            <div className="mt-1 opacity-0 group-hover:opacity-100 text-[10px] text-amber-600">
              拖拽插入引用
            </div>
          </div>
        ))}
      </div>
    </motion.div>
  );
};

// ─── Markdown 渲染组件（支持文末参考文献列表）────────────────────────────────────
const MarkdownPreview = ({ content, references = [] }) => {
  const { setActiveReference } = useStore();

  const components = {
    a: ({ href, children }) => {
      // 拦截 page-N 格式链接
      if (href?.startsWith('page-')) {
        const page = parseInt(href.replace('page-', ''), 10) || 1;
        return (
          <span
            className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-blue-50 border border-blue-200 rounded text-blue-700 cursor-pointer hover:bg-blue-100 text-sm"
            onClick={() => setActiveReference({ page, bbox: [0, 0, 0, 0] })}
          >
            <BookOpen size={11} />
            {children}
          </span>
        );
      }
      return (
        <a href={href} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">
          {children}
        </a>
      );
    },
  };

  return (
    <div className="h-full overflow-y-auto p-8 custom-scrollbar">
      <div className="prose prose-sm max-w-none prose-a:text-blue-600 prose-code:bg-slate-100 prose-code:px-1 prose-code:rounded prose-h1:text-2xl prose-h1:font-extrabold prose-h1:mt-8 prose-h1:mb-3 prose-h1:text-slate-900 prose-h1:border-b prose-h1:border-slate-200 prose-h1:pb-2 prose-h2:text-xl prose-h2:font-bold prose-h2:mt-6 prose-h2:mb-2 prose-h2:text-slate-800 prose-h2:border-b prose-h2:border-slate-100 prose-h2:pb-1 prose-h3:text-lg prose-h3:font-semibold prose-h3:mt-4 prose-h3:mb-1 prose-h3:text-slate-800">
        <ReactMarkdown
          remarkPlugins={[remarkGfm, remarkMath]}
          rehypePlugins={[rehypeKatex, rehypeHighlight]}
          components={components}
        >
          {content}
        </ReactMarkdown>
      </div>
      {references && references.length > 0 && (
        <div className="mt-8 pt-6 border-t border-slate-200">
          <h3 className="text-sm font-bold text-slate-700 mb-3">参考文献</h3>
          <ol className="list-decimal list-inside space-y-2 text-xs text-slate-600">
            {references.map((ref, i) => {
              const key = ref.key ?? String(i + 1);
              const doiUrl = ref.doi ? `https://doi.org/${ref.doi.replace(/^https?:\/\/doi\.org\//i, '')}` : null;
              return (
                <li key={ref.id || i} className="leading-relaxed">
                  <span>[{key}] {ref.title || ''}{ref.authors ? `, ${ref.authors}` : ''}{ref.year ? ` (${ref.year})` : ''}.</span>
                  {doiUrl ? (
                    <a href={doiUrl} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline ml-1">DOI</a>
                  ) : ref.url ? (
                    <a href={ref.url} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline ml-1">链接</a>
                  ) : null}
                </li>
              );
            })}
          </ol>
        </div>
      )}
    </div>
  );
};

// ─── 主编辑器 ──────────────────────────────────────────────────────────────────
export const RightColumn = () => {
  const {
    markdownContent, setMarkdownContent,
    isZenMode, toggleZenMode,
    setCopilotOpen,
    pomodoroActive,
    pdfFile, pdfUrl, currentPage, setCurrentPage,
    notes,
    references,
    addReference,
    pdfFileName,
    parsedDocName,
    pendingInsert, setPendingInsert,
  } = useStore();

  const [showPreview, setShowPreview] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [showOutlinePopover, setShowOutlinePopover] = useState(false);
  const [assistLoading, setAssistLoading] = useState('');
  const [assistTasks, setAssistTasks] = useState([]);
  const [inlineOpen, setInlineOpen] = useState(false);
  const [inlineInput, setInlineInput] = useState('');
  const [inlineLoading, setInlineLoading] = useState(false);
  const [inlineContextMode, setInlineContextMode] = useState('paragraph'); // 'selection' | 'paragraph'
  const [inlineSelectedCardIds, setInlineSelectedCardIds] = useState([]); // 行内助手已选卡片，加入上下文
  const [inlineScopeForCards, setInlineScopeForCards] = useState(''); // 打开行内时用于推荐卡片的文本（段落或选区）
  const [ghostSuggestion, setGhostSuggestion] = useState(null); // { result, action, paragraphStart, paragraphEnd }
  const [zenPdfObjectUrl, setZenPdfObjectUrl] = useState(null);
  const [zenPdfLoading, setZenPdfLoading] = useState(true);
  const [zenPdfError, setZenPdfError] = useState(null);
  const [resolveRefLoading, setResolveRefLoading] = useState(false);
  const [showRefsPopover, setShowRefsPopover] = useState(false);
  const [showResolvePopover, setShowResolvePopover] = useState(false);
  const [refSearchTitle, setRefSearchTitle] = useState('');
  const [refSearchDoi, setRefSearchDoi] = useState('');
  const inlineInputRef = useRef(null);
  const savedCursorRef = useRef(null);
  const savedSelectionRef = useRef(null); // { start, end } 选中文本时用，Ctrl+J 时为 null
  const textAreaRef = useRef(null);

  // 根据当前光标或选区文本推荐卡片（词重叠打分，取 top5）
  const inlineRecommendedNotes = useMemo(() => {
    if (!inlineOpen || !notes?.length || !inlineScopeForCards.trim()) return [];
    const words = new Set(inlineScopeForCards.replace(/\s+/g, ' ').trim().split(/\s+/).filter(Boolean));
    if (words.size === 0) return notes.slice(0, 5);
    const scored = notes.map((n) => {
      const text = (n.content || n.axiom || '').trim();
      const noteWords = text.split(/\s+/).filter(Boolean);
      let hit = 0;
      noteWords.forEach((w) => { if (words.has(w)) hit++; });
      return { note: n, score: hit };
    });
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, 5).map((s) => s.note);
  }, [inlineOpen, notes, inlineScopeForCards]);

  // 从 content 和 cursor 位置截取当前段落
  const getParagraphAtCursor = useCallback((content, cursor) => {
    if (!content || cursor < 0) return content.slice(0, 400);
    let start = content.lastIndexOf('\n\n', cursor);
    if (start < 0) start = 0; else start += 2;
    let end = content.indexOf('\n\n', cursor);
    if (end < 0) end = content.length;
    return content.slice(start, end).trim() || content.slice(0, 400);
  }, []);

  useEffect(() => {
    if (pdfFile && typeof pdfFile === 'object' && pdfFile instanceof File) {
      const url = URL.createObjectURL(pdfFile);
      setZenPdfObjectUrl(url);
      return () => URL.revokeObjectURL(url);
    }
    setZenPdfObjectUrl(null);
  }, [pdfFile]);
  useEffect(() => {
    if (zenPdfObjectUrl || pdfUrl) {
      setZenPdfLoading(true);
      setZenPdfError(null);
    }
  }, [zenPdfObjectUrl, pdfUrl]);

  // 从 Markdown 解析大纲（# 标题）用于专注模式跳转
  const outlineHeadings = useMemo(() => {
    const lines = markdownContent.split('\n');
    const list = [];
    let offset = 0;
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(/^(#{1,6})\s+(.+)$/);
      if (m) list.push({ level: m[1].length, title: m[2].trim(), offset });
      offset += lines[i].length + 1;
    }
    return list;
  }, [markdownContent]);
  const jumpToOutline = useCallback((charOffset) => {
    const el = textAreaRef.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(charOffset, charOffset);
    el.scrollTop = Math.max(0, (el.scrollHeight * (charOffset / markdownContent.length)) - el.clientHeight / 2);
    setShowOutlinePopover(false);
  }, [markdownContent]);

  // 工具栏操作：正确包裹选中文字
  const wrapSelection = useCallback((prefix, suffix = '') => {
    const el = textAreaRef.current;
    if (!el) return;

    const start = el.selectionStart;
    const end = el.selectionEnd;
    const selected = markdownContent.slice(start, end);
    const wrapped = `${prefix}${selected || '文字'}${suffix || prefix}`;
    const newVal =
      markdownContent.slice(0, start) + wrapped + markdownContent.slice(end);

    setMarkdownContent(newVal);
    // 恢复光标位置
    requestAnimationFrame(() => {
      el.focus();
      const cursorPos = start + prefix.length + (selected || '文字').length + (suffix || prefix).length;
      el.setSelectionRange(cursorPos, cursorPos);
    });
  }, [markdownContent, setMarkdownContent]);

  const insertAtCursor = useCallback((text) => {
    const el = textAreaRef.current;
    if (!el) return;
    const start = el.selectionStart;
    const newVal =
      markdownContent.slice(0, start) + text + markdownContent.slice(start);
    setMarkdownContent(newVal);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + text.length, start + text.length);
    });
  }, [markdownContent, setMarkdownContent]);

  // 参考面板 [+] 插入：消费 pendingInsert 并插入到光标
  useEffect(() => {
    if (!pendingInsert) return;
    const el = textAreaRef.current;
    if (el) {
      const start = el.selectionStart;
      const newVal =
        markdownContent.slice(0, start) + pendingInsert + markdownContent.slice(start);
      setMarkdownContent(newVal);
      requestAnimationFrame(() => {
        el.focus();
        el.setSelectionRange(start + pendingInsert.length, start + pendingInsert.length);
      });
    }
    setPendingInsert(null);
  }, [pendingInsert, setPendingInsert, markdownContent, setMarkdownContent]);

  const insertRefAtCursor = useCallback((key) => {
    insertAtCursor(`[${key}]`);
    setShowRefsPopover(false);
  }, [insertAtCursor]);

  const openResolvePopover = useCallback(() => {
    setRefSearchTitle(pdfFileName || parsedDocName || '');
    setRefSearchDoi('');
    setShowResolvePopover(true);
  }, [pdfFileName, parsedDocName]);

  const handleResolveCitation = useCallback(async (titleOrUseCurrent, doi = '') => {
    const title = (typeof titleOrUseCurrent === 'string' ? titleOrUseCurrent : (pdfFileName || parsedDocName || '')).trim();
    if (!title && !doi.trim()) {
      useStore.getState().setNotification?.('请填写标题或 DOI', 'warn');
      return;
    }
    setResolveRefLoading(true);
    try {
      const result = await api.resolveCitation(title, doi.trim() || undefined);
      addReference({
        title: result.title,
        authors: result.authors ?? '',
        year: result.year ?? '',
        doi: result.doi ?? '',
        url: result.url ?? '',
        journal: result.journal ?? '',
        source: result.source ?? '',
      });
      const nextKey = String((references?.length ?? 0) + 1);
      insertAtCursor(`[${nextKey}]`);
      setShowRefsPopover(false);
      setShowResolvePopover(false);
    } catch (e) {
      useStore.getState().setNotification?.(`查找引用失败: ${e?.message || e}`, 'error');
    } finally {
      setResolveRefLoading(false);
    }
  }, [pdfFileName, parsedDocName, addReference, references?.length, insertAtCursor]);

  const applyGhostSuggestion = useCallback(() => {
    if (!ghostSuggestion) return;
    const { result, action, paragraphStart, paragraphEnd } = ghostSuggestion;
    if (action === 'continue') {
      const before = markdownContent.slice(0, paragraphEnd);
      const after = markdownContent.slice(paragraphEnd);
      setMarkdownContent(before + (paragraphEnd > 0 && before.slice(-1) !== '\n' ? '\n\n' : '') + result + after);
    } else {
      const before = markdownContent.slice(0, paragraphStart);
      const after = markdownContent.slice(paragraphEnd);
      setMarkdownContent(before + result + after);
    }
    setGhostSuggestion(null);
  }, [ghostSuggestion, markdownContent, setMarkdownContent]);

  // Ghost 建议条出现时：全局监听 Enter/Esc，避免焦点不在编辑器时无反应
  useEffect(() => {
    if (!ghostSuggestion) return;
    const onKey = (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        applyGhostSuggestion();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        setGhostSuggestion(null);
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [ghostSuggestion, applyGhostSuggestion]);

  // Tab 键支持 + Ctrl+J 行内 Copilot + Ghost 确认/取消（编辑器内也响应，与全局一致）
  const handleKeyDown = (e) => {
    if (ghostSuggestion) {
      if (e.key === 'Enter') {
        e.preventDefault();
        applyGhostSuggestion();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        setGhostSuggestion(null);
      }
      return;
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      insertAtCursor('  ');
    }
    if (e.ctrlKey && e.key === 'j') {
      e.preventDefault();
      const el = textAreaRef.current;
      if (el) {
        savedSelectionRef.current = null;
        const pos = el.selectionStart;
        savedCursorRef.current = pos;
        setInlineScopeForCards(getParagraphAtCursor(markdownContent, pos));
        setInlineContextMode('paragraph');
        setInlineOpen(true);
        setInlineInput('');
        requestAnimationFrame(() => inlineInputRef.current?.focus());
      }
    }
    if (e.ctrlKey && e.key === 'b') {
      e.preventDefault();
      wrapSelection('**');
    }
    if (e.ctrlKey && e.key === 'i') {
      e.preventDefault();
      wrapSelection('*');
    }
    if (e.key === 'Escape' && isZenMode) {
      toggleZenMode();
    }
  };

  // 导出 Markdown
  const exportMd = () => {
    const blob = new Blob([markdownContent], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `note_${new Date().toISOString().slice(0, 10)}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // 字数统计
  const wordCount = markdownContent.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean).length;
  const charCount = markdownContent.length;

  const getSelectedText = () => {
    const el = textAreaRef.current;
    if (!el) return { text: '', start: 0, end: 0 };
    const start = el.selectionStart;
    const end = el.selectionEnd;
    return { text: markdownContent.slice(start, end), start, end };
  };

  /** 根据光标位置取当前段落（以 \n\n 为界） */
  const getParagraphAtPosition = useCallback((pos) => {
    const content = markdownContent;
    let pStart = 0;
    for (let i = 0; i <= pos; i++) {
      if (content.slice(i, i + 2) === '\n\n') pStart = i + 2;
    }
    let pEnd = content.length;
    for (let i = pos; i < content.length; i++) {
      if (content.slice(i, i + 2) === '\n\n') {
        pEnd = i;
        break;
      }
    }
    const text = content.slice(pStart, pEnd).trim();
    return { text, start: pStart, end: pEnd };
  }, [markdownContent]);

  const replaceSelectedText = (text, start, end) => {
    const newVal = markdownContent.slice(0, start) + text + markdownContent.slice(end);
    setMarkdownContent(newVal);
    requestAnimationFrame(() => {
      const el = textAreaRef.current;
      if (!el) return;
      el.focus();
      const pos = start + text.length;
      el.setSelectionRange(pos, pos);
    });
  };

  const upsertTask = (taskId, patch) => {
    setAssistTasks((tasks) => tasks.map((t) => (t.id === taskId ? { ...t, ...patch } : t)));
  };

  const removeTask = (taskId) => {
    setAssistTasks((tasks) => tasks.filter((t) => t.id !== taskId));
  };

  const applyTaskResult = (task) => {
    if (!task?.result) return;
    if (typeof task.start === 'number' && typeof task.end === 'number' && task.end > task.start) {
      replaceSelectedText(task.result, task.start, task.end);
      return;
    }
    if (task.action === 'continue') {
      setMarkdownContent(`${markdownContent.trimEnd()}\n\n${task.result}`);
      return;
    }
    setMarkdownContent(task.result);
  };

  const handleInlineSubmit = async () => {
    const sel = savedSelectionRef.current;
    let paragraphText;
    let paragraphStart;
    let paragraphEnd;
    if (sel && sel.end > sel.start) {
      paragraphText = markdownContent.slice(sel.start, sel.end);
      paragraphStart = sel.start;
      paragraphEnd = sel.end;
    } else {
      const cursorPos = savedCursorRef.current ?? 0;
      const para = getParagraphAtPosition(cursorPos);
      paragraphText = para.text;
      paragraphStart = para.start;
      paragraphEnd = para.end;
    }
    if (!paragraphText && !inlineInput.trim()) return;
    const command = inlineInput.trim() || '结合现有卡片续写';
    const selectedCards = notes.filter((n) => inlineSelectedCardIds.includes(n.id));
    const cardsContext = selectedCards.length > 0
      ? markdownContent + '\n\n【已选卡片】\n' + selectedCards.map((n) => n.content || n.axiom || '').join('\n\n')
      : markdownContent;
    setInlineOpen(false);
    setInlineInput('');
    setInlineSelectedCardIds([]);
    savedSelectionRef.current = null;
    setInlineLoading(true);
    try {
      const resp = await api.writingInline(command, paragraphText || markdownContent.slice(0, 500), cardsContext);
      setGhostSuggestion({
        result: resp.result || '',
        action: resp.action || 'continue',
        paragraphStart,
        paragraphEnd,
      });
    } catch (e) {
      if (typeof useStore.getState().setNotification === 'function') {
        useStore.getState().setNotification(`行内助手失败: ${e instanceof Error ? e.message : String(e)}`, 'warn');
      }
    } finally {
      setInlineLoading(false);
    }
  };

  /** 双击时打开行内助手：以当前选区或光标所在段落为上下文 */
  const handleEditorDoubleClick = useCallback((e) => {
    const el = e.target;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    if (end > start) {
      savedSelectionRef.current = { start, end };
      savedCursorRef.current = start;
      setInlineScopeForCards(markdownContent.slice(start, end));
      setInlineContextMode('selection');
    } else {
      const cursorPos = start;
      savedCursorRef.current = cursorPos;
      const para = getParagraphAtPosition(cursorPos);
      savedSelectionRef.current = { start: para.start, end: para.end };
      setInlineScopeForCards(para.text);
      setInlineContextMode('paragraph');
    }
    setInlineOpen(true);
    setInlineInput('');
    requestAnimationFrame(() => inlineInputRef.current?.focus());
  }, [markdownContent, getParagraphAtPosition]);

  const handleAssist = async (action) => {
    const { text, start, end } = getSelectedText();
    const target = text || markdownContent;
    if (!target.trim()) return;

    const taskId = `${action}-${Date.now()}`;
    const actionLabel = {
      spell: '错别字检查',
      grammar: '病句检查',
      polish: '学术润色',
      continue: 'RAG 续写',
    }[action] || action;

    setAssistTasks((tasks) => [
      {
        id: taskId,
        action,
        actionLabel,
        status: 'running',
        progress: 8,
        message: '任务已创建，正在分析文本...',
        result: '',
        changed: false,
        start,
        end,
        usedRag: false,
        usedAcademicApi: false,
        sources: [],
      },
      ...tasks,
    ]);

    const progressTimer = setInterval(() => {
      setAssistTasks((tasks) => tasks.map((t) => {
        if (t.id !== taskId || t.status !== 'running') return t;
        return { ...t, progress: Math.min(92, (t.progress || 0) + 9) };
      }));
    }, 350);

    setAssistLoading(action);
    try {
      const resp = await api.writingAssist(action, target, markdownContent);
      clearInterval(progressTimer);
      upsertTask(taskId, {
        status: 'done',
        progress: 100,
        result: resp.result || '',
        changed: !!resp.changed,
        message: resp.message || '任务完成',
        usedRag: !!resp.used_rag,
        usedAcademicApi: !!resp.used_academic_api,
        sources: resp.sources || [],
      });
    } catch (e) {
      clearInterval(progressTimer);
      upsertTask(taskId, {
        status: 'error',
        progress: 100,
        message: `任务失败: ${e instanceof Error ? e.message : String(e)}`,
      });
    } finally {
      setAssistLoading('');
    }
  };

  // ── 专注模式全屏覆盖 ──────────────────────────────────────────────────────────
  if (isZenMode) {
    return (
      <div className="fixed inset-0 z-50 bg-stone-100 flex flex-col">
        {/* 专注模式顶栏 */}
        <div className="flex items-center justify-between px-6 py-2.5 bg-white/90 backdrop-blur border-b border-stone-200 shrink-0">
          <div className="flex items-center gap-3">
            <span className="font-sans text-xs text-stone-600 tracking-widest">✦ 专注模式</span>
            <div className="w-px h-4 bg-stone-300" />
            <button
              onClick={() => setDrawerOpen(!drawerOpen)}
              className="text-stone-500 hover:text-amber-600 flex items-center gap-1 text-xs"
            >
              <Sparkles size={12} />
              知识卡片
            </button>
            <button
              type="button"
              onClick={() => setCopilotOpen(true)}
              className="text-stone-500 hover:text-amber-600 flex items-center gap-1 text-xs"
              title="打开原子助手"
            >
              <Bot size={12} />
              原子助手
            </button>
          </div>

          <PomodoroTimer onExit={toggleZenMode} />
        </div>

        {/* 三栏内容区 */}
        <div className="flex-1 flex overflow-hidden min-h-0">
          {/* 左侧：原文参考（与阅读区 PDF 同款样式） */}
          <div className="w-[320px] shrink-0 bg-white border-r border-slate-200 overflow-hidden flex flex-col">
            <div className="px-3 py-2 border-b border-slate-200 text-xs text-slate-600 flex items-center justify-between">
              <span>原文 PDF</span>
              <span>p.{currentPage}</span>
            </div>
            <div className="flex-1 overflow-auto p-3 flex flex-col items-center">
              {(zenPdfObjectUrl || pdfUrl) ? (
                <>
                  <div className="relative bg-white border border-slate-200 rounded-lg shadow-sm overflow-hidden min-h-[400px]">
                    {zenPdfLoading && (
                      <div className="absolute inset-0 flex items-center justify-center text-slate-400 text-sm bg-white/90">Loading PDF…</div>
                    )}
                    {zenPdfError && (
                      <div className="p-3 text-amber-600 text-xs">{zenPdfError}</div>
                    )}
                    <Document
                      key={zenPdfObjectUrl || pdfUrl}
                      file={zenPdfObjectUrl || pdfUrl}
                      onLoadSuccess={() => { setZenPdfLoading(false); setZenPdfError(null); }}
                      onLoadError={(e) => { setZenPdfLoading(false); setZenPdfError(e?.message || 'PDF 加载失败'); }}
                      loading=""
                    >
                      {!zenPdfLoading && !zenPdfError && (
                        <Page pageNumber={Math.max(1, currentPage)} width={290} renderTextLayer={false} renderAnnotationLayer={false} />
                      )}
                    </Document>
                  </div>
                  {!zenPdfLoading && !zenPdfError && (
                    <div className="flex items-center gap-2 mt-2 text-xs text-slate-600">
                      <button onClick={() => setCurrentPage((p) => Math.max(1, p - 1))} className="px-2 py-1 rounded border border-slate-200 hover:bg-slate-50">上一页</button>
                      <button onClick={() => setCurrentPage((p) => p + 1)} className="px-2 py-1 rounded border border-slate-200 hover:bg-slate-50">下一页</button>
                    </div>
                  )}
                </>
              ) : (
                <p className="text-xs text-slate-400 p-2">暂无 PDF，可在 Read 中上传或从 Organize → ArXiv 加载。</p>
              )}
            </div>
          </div>

          {/* 卡片侧栏（可折叠） */}
          <AnimatePresence>
            {drawerOpen && (
              <motion.div
                initial={{ x: -280, opacity: 0 }}
                animate={{ x: 0, opacity: 1 }}
                exit={{ x: -280, opacity: 0 }}
                className="w-[280px] shrink-0 bg-white border-r border-stone-200 overflow-hidden flex flex-col"
              >
                <BrainstormDrawer isOpen={true} onClose={() => setDrawerOpen(false)} />
              </motion.div>
            )}
          </AnimatePresence>

          {/* 右侧悬浮：大纲导航 */}
          <div className="absolute right-4 top-1/2 -translate-y-1/2 z-10 flex flex-col items-end gap-2">
            <button
              type="button"
              onClick={() => setShowOutlinePopover((v) => !v)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg border-2 border-stone-300 bg-white/95 shadow-md hover:border-amber-400 hover:bg-amber-50/80 text-xs font-sans text-stone-600"
              title="大纲导航"
            >
              <ListTree size={14} /> 大纲
            </button>
            {showOutlinePopover && (
              <div className="w-56 max-h-64 overflow-y-auto bg-white border-2 border-stone-200 rounded-lg shadow-lg py-2 custom-scrollbar">
                {outlineHeadings.length === 0 ? (
                  <p className="px-3 py-2 text-[10px] text-stone-400">暂无标题（使用 # 或 ## 书写）</p>
                ) : (
                  outlineHeadings.map((h, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => jumpToOutline(h.offset)}
                      className="w-full text-left px-3 py-1.5 hover:bg-amber-50 text-[11px] text-stone-700 border-l-2 border-transparent hover:border-amber-400"
                      style={{ paddingLeft: 8 + (h.level - 1) * 10 }}
                    >
                      {h.title}
                    </button>
                  ))
                )}
              </div>
            )}
          </div>

          {/* 中间：编辑器 */}
          <div className="flex-1 flex flex-col justify-center items-center overflow-hidden min-w-0">
            <div className="w-full max-w-3xl h-full flex flex-col p-4">
              {/* 编辑/预览切换 */}
              <div className="flex items-center justify-between mb-2 shrink-0">
                <button onClick={() => setShowPreview(!showPreview)} className="text-xs text-stone-400 hover:text-stone-600 flex items-center gap-1">
                  {showPreview ? <EyeOff size={12} /> : <Eye size={12} />}
                  {showPreview ? '编辑' : '预览'}
                </button>
                <span className="text-[10px] text-stone-400 font-mono">{wordCount} 词 · {charCount} 字符</span>
              </div>
              {showPreview ? (
                <div className="flex-1 overflow-y-auto bg白 rounded-lg shadow-sm border border-stone-200 p-8 custom-scrollbar">
                  <MarkdownPreview content={markdownContent} references={references} />
                </div>
              ) : (
                <>
                  {inlineOpen && (
                    <div className="w-full mb-2 p-2 rounded-lg border-2 border-amber-300 bg-amber-50 shadow-md">
                      <div className="flex gap-2 items-center">
                        <input
                          ref={inlineInputRef}
                          type="text"
                          value={inlineInput}
                          onChange={(e) => setInlineInput(e.target.value)}
                          onKeyDown={(e) => e.key === 'Enter' && handleInlineSubmit()}
                          placeholder="续写 / 润色 / 纠错 / 病句"
                          className="flex-1 px-3 py-2 text-sm border border-amber-200 rounded focus:outline-none focus:ring-2 focus:ring-amber-400"
                        />
                        <button type="button" onClick={handleInlineSubmit} className="px-3 py-2 bg-amber-600 text-white rounded hover:bg-amber-700 text-xs font-bold">发送</button>
                        <button type="button" onClick={() => setInlineOpen(false)} className="p-2 text-gray-400 hover:text-gray-600"><X size={14} /></button>
                      </div>
                      {inlineRecommendedNotes.length > 0 && (
                        <div className="mt-2 border-t border-amber-200 pt-2">
                          <p className="text-[10px] text-amber-800 mb-1.5 font-medium">推荐卡片（可加入上下文）</p>
                          <div className="space-y-1 max-h-28 overflow-y-auto">
                            {inlineRecommendedNotes.map((n, i) => {
                              const id = n.id ?? n.axiom ?? `rec-${i}`;
                              const added = inlineSelectedCardIds.includes(id);
                              return (
                                <div key={id} className="flex items-start gap-2 text-xs bg-white/80 rounded px-2 py-1 border border-amber-100">
                                  <span className="flex-1 line-clamp-2 text-gray-700">{(n.content || n.axiom || '').slice(0, 80)}…</span>
                                  <button type="button" onClick={() => setInlineSelectedCardIds((prev) => added ? prev.filter((x) => x !== id) : [...prev, id])} className={added ? 'text-amber-600 font-medium' : 'text-amber-600 hover:underline'}>
                                    {added ? '已加入' : '加入上下文'}
                                  </button>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                  {ghostSuggestion && (
                    <div className="w-full mb-2 p-2 rounded-lg border-2 border-emerald-300 bg-emerald-50 shadow-md">
                      <p className="text-[10px] text-emerald-800 mb-1.5 font-sans uppercase">AI 建议</p>
                      <div className="text-xs max-h-20 overflow-y-auto line-clamp-3">
                        <GhostSuggestionContent ghost={ghostSuggestion} fullContent={markdownContent} maxChars={300} />
                      </div>
                      <div className="flex items-center gap-2 mt-2">
                        <button type="button" onClick={applyGhostSuggestion} className="px-2 py-1 text-[10px] bg-emerald-600 text-white rounded hover:bg-emerald-700">确认 (Enter)</button>
                        <button type="button" onClick={() => setGhostSuggestion(null)} className="px-2 py-1 text-[10px] border border-emerald-300 text-emerald-700 rounded hover:bg-emerald-100">取消 (Esc)</button>
                      </div>
                    </div>
                  )}
                  {inlineLoading && <div className="w-full py-1 text-center text-xs text-amber-600">行内助手处理中…</div>}
                  <textarea
                    ref={textAreaRef}
                    id="main-editor"
                    className="flex-1 bg-white rounded-lg shadow-sm border border-stone-200 resize-none p-8 focus:outline-none focus:ring-2 focus:ring-amber-200 font-mono text-sm text-stone-800 leading-relaxed custom-scrollbar caret-amber-500 selection:bg-amber-100"
                    value={markdownContent}
                    onChange={(e) => setMarkdownContent(e.target.value)}
                    onDoubleClick={handleEditorDoubleClick}
                    onKeyDown={handleKeyDown}
                    placeholder="开始书写..."
                    autoFocus
                  />
                </>
              )}
            </div>
          </div>
        </div>

        {/* 专注模式底栏 */}
        <div className="flex items-center justify-between px-6 py-2 bg-white/80 border-t border-stone-200 text-xs text-stone-400 font-mono shrink-0">
          <div className="flex items-center gap-4">
            <button onClick={exportMd} className="hover:text-stone-600 flex items-center gap-1">
              <Download size={12} /> 导出
            </button>
            <span className="text-[10px]">Ctrl+B 粗体 · Ctrl+I 斜体 · Esc 退出</span>
          </div>
          <div className="flex items-center gap-2">
            {pomodoroActive && <span className="text-amber-600 animate-pulse">● 专注中</span>}
            <span>{wordCount} 词</span>
          </div>
        </div>
      </div>
    );
  }

  // ── 普通模式 ────────────────────────────────────────────────────────────────
  return (
    <div className="flex h-full bg-white relative overflow-hidden">
      {/* 知识卡片侧栏 */}
      <BrainstormDrawer isOpen={drawerOpen} onClose={() => setDrawerOpen(false)} />

      {/* 主内容 */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* 工具栏 */}
        <div className="flex items-center justify-between px-2 py-1.5 border-b border-gray-200 bg-gray-50 shrink-0 gap-1 flex-wrap">
          <div className="flex items-center gap-0.5 flex-wrap">
            {!drawerOpen && (
              <button
                onClick={() => setDrawerOpen(true)}
                className="mr-2 p-1.5 text-gray-400 hover:text-amber-600 hover:bg-amber-50 rounded"
                title="打开知识卡片"
              >
                <Sparkles size={14} />
              </button>
            )}
            {/* 文字格式工具 */}
            <button onClick={() => wrapSelection('**')} className="p-1 hover:bg-gray-200 rounded text-gray-600" title="粗体 Ctrl+B"><Bold size={14} /></button>
            <button onClick={() => wrapSelection('*')} className="p-1 hover:bg-gray-200 rounded text-gray-600" title="斜体 Ctrl+I"><Italic size={14} /></button>
            <button onClick={() => wrapSelection('`')} className="p-1 hover:bg-gray-200 rounded text-gray-600" title="行内代码"><Code size={14} /></button>
            <button onClick={() => insertAtCursor('\n# 一级标题\n')} className="p-1 hover:bg-gray-200 rounded text-gray-600 text-[10px]" title="一级标题">H1</button>
            <button onClick={() => insertAtCursor('\n## 二级标题\n')} className="p-1 hover:bg-gray-200 rounded text-gray-600 text-[10px]" title="二级标题">H2</button>
            <button onClick={() => insertAtCursor('\n### 三级标题\n')} className="p-1 hover:bg-gray-200 rounded text-gray-600 text-[10px]" title="三级标题">H3</button>
            <div className="relative">
              <button
                type="button"
                onClick={() => setShowOutlinePopover((v) => !v)}
                className={clsx('p-1 hover:bg-gray-200 rounded text-gray-600 flex items-center gap-1 text-[10px] border px-2', showOutlinePopover && 'bg-amber-50 border-amber-300 text-amber-700')}
                title="写作大纲"
              >
                <ListTree size={12} /> 写作大纲
              </button>
              {showOutlinePopover && (
                <div className="absolute left-0 top-full mt-1 w-52 max-h-72 overflow-y-auto bg白 border border-gray-200 rounded-lg shadow-lg py-2 z-50 custom-scrollbar">
                  {outlineHeadings.length === 0 ? (
                    <p className="px-3 py-2 text-[10px] text-gray-400">暂无标题（使用 # / ## / ### 书写）</p>
                  ) : (
                    outlineHeadings.map((h, i) => (
                      <button
                        key={i}
                        type="button"
                        onClick={() => jumpToOutline(h.offset)}
                        className="w-full(text-left px-3 py-1.5 hover:bg-amber-50 text-[11px] text-gray-700 border-l-2 border-transparent hover:border-amber-400"
                        style={{ paddingLeft: 8 + (h.level - 1) * 10 }}
                      >
                        {h.title}
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
            <div className="w-px h-4 bg-gray-200 mx-1" />
            <button onClick={() => insertAtCursor('\n- 列表项\n')} className="p-1 hover:bg-gray-200 rounded text-gray-600" title="列表"><List size={14} /></button>
            <button onClick={() => insertAtCursor('\n> ')} className="p-1 hover:bg-gray-200 rounded text-gray-600" title="引用"><Quote size={14} /></button>
            <div className="w-px h-4 bg-gray-200 mx-1" />
            <button
              onClick={() => insertAtCursor('[页码引用](page-1 "描述")')}
              className="p-1 hover:bg-gray-200 rounded text-gray-600 flex items-center gap-1 text-xs border border-gray-200 px-2"
              title="插入页码引用"
            >
              <BookOpen size={11} /> 引用
            </button>
            <div className="relative">
              <button
                onClick={openResolvePopover}
                disabled={resolveRefLoading}
                className="p-1 hover:bg-gray-200 rounded text-gray-600 text-[10px] border border-gray-200 px-2 disabled:opacity-50"
                title="按标题或 DOI 查找引用（Crossref / Semantic Scholar）并插入 [n]"
              >
                {resolveRefLoading ? '查找中…' : '查找引用'}
              </button>
              {showResolvePopover && (
                <div className="absolute left-0 top-full mt-1 w-64 bg-white border border-gray-200 rounded-lg shadow-lg p-3 z-50">
                  <div className="text-[10px] font-semibold text-gray-600 mb-2">按标题或 DOI 查找</div>
                  <input
                    type="text"
                    value={refSearchTitle}
                    onChange={(e) => setRefSearchTitle(e.target.value)}
                    placeholder="文献标题（默认当前文档）"
                    className="w-full text-xs border border-gray-200 rounded px-2 py-1.5 mb-2"
                  />
                  <input
                    type="text"
                    value={refSearchDoi}
                    onChange={(e) => setRefSearchDoi(e.target.value)}
                    placeholder="DOI（可选）"
                    className="w-full text-xs border border-gray-200 rounded px-2 py-1.5 mb-2"
                  />
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => handleResolveCitation(refSearchTitle, refSearchDoi)}
                      disabled={resolveRefLoading || (!refSearchTitle.trim() && !refSearchDoi.trim())}
                      className="flex-1 text-[10px] px-2 py-1.5 rounded bg-blue-100 text-blue-700 hover:bg-blue-200 disabled:opacity-50"
                    >
                      {resolveRefLoading ? '查找中…' : '查找并插入 [n]'}
                    </button>
                    <button type="button" onClick={() => setShowResolvePopover(false)} className="px-2 py-1.5 text-gray-500 hover:bg-gray-100 rounded text-[10px]">取消</button>
                  </div>
                </div>
              )}
            </div>
            <div className="relative">
              <button
                type="button"
                onClick={() => setShowRefsPopover((v) => !v)}
                className="p-1 hover:bg-gray-200 rounded text-gray-600 text-[10px] border border-gray-200 px-2 flex items-center gap-1"
                title="参考文献"
              >
                参考文献 {references?.length ? `(${references.length})` : ''}
              </button>
              {showRefsPopover && (
                <div className="absolute left-0 top-full mt-1 w-72 max-h-64 overflow-y-auto bg-white border border-gray-200 rounded-lg shadow-lg py-2 z-50 custom-scrollbar">
                  <div className="px-2 pb-2 border-b border-gray-100 text-[10px] font-semibold text-gray-600">参考文献</div>
                  {(!references || references.length === 0) && (
                    <p className="px-2 py-2 text-[10px] text-gray-400">暂无。点击「查找引用」根据当前文档添加。</p>
                  )}
                  {references?.map((ref, i) => {
                    const key = ref.key ?? String(i + 1);
                    return (
                      <div key={ref.id || i} className="px-2 py-1.5 flex items-start justify-between gap-2 border-b border-gray-50 last:border-0">
                        <span className="text-[10px] text-gray-600 line-clamp-2 flex-1 min-w-0">[{key}] {ref.title || '无标题'}</span>
                        <button type="button" onClick={() => insertRefAtCursor(key)} className="shrink-0 px-1.5 py-0.5 text-[10px] bg-blue-100 text-blue-700 rounded hover:bg-blue-200">插入 [{key}]</button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
            <div className="w-px h-4 bg-gray-200 mx-1" />
            <button onClick={() => handleAssist('spell')} disabled={assistLoading !== ''} className="p-1 hover:bg-gray-200 rounded text-gray-600 text-[10px] disabled:opacity-50" title="错别字检测">错别字</button>
            <button onClick={() => handleAssist('grammar')} disabled={assistLoading !== ''} className="p-1 hover:bg-gray-200 rounded text-gray-600 text-[10px] disabled:opacity-50" title="病句检测">病句</button>
            <button onClick={() => handleAssist('polish')} disabled={assistLoading !== ''} className="p-1 hover:bg-gray-200 rounded text-gray-600 text-[10px] disabled:opacity-50" title="优化润色">润色</button>
            <button onClick={() => handleAssist('continue')} disabled={assistLoading !== ''} className="p-1 hover:bg-gray-200 rounded text-gray-600 text-[10px] disabled:opacity-50" title="建议续写">续写</button>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setShowPreview(!showPreview)}
              className={clsx(
                'text-xs font-bold px-2 py-1 rounded border flex items-center gap-1',
                showPreview
                  ? 'bg-blue-100 text-blue-700 border-blue-300'
                  : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-100'
              )}
            >
              {showPreview ? <EyeOff size={12} /> : <Eye size={12} />}
              {showPreview ? '编辑' : '预览'}
            </button>
            <button
              onClick={exportMd}
              className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded"
              title="导出 Markdown"
            >
              <Download size={14} />
            </button>
            <button
              onClick={toggleZenMode}
              className="p-1.5 text-gray-400 hover:text-purple-600 hover:bg-purple-50 rounded"
              title="进入专注模式"
            >
              <Maximize2 size={14} />
            </button>
          </div>
        </div>

        {/* 行内 Copilot 弹出框（Ctrl+J 唤起） */}
        {inlineOpen && (
          <div className="mx-2 mt-2 p-2 rounded-lg border-2 border-amber-300 bg-amber-50 shadow-md">
            <div className="flex gap-2 items-center">
              <input
                ref={inlineInputRef}
                type="text"
                value={inlineInput}
                onChange={(e) => setInlineInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleInlineSubmit()}
                placeholder="输入指令，如：结合现有卡片续写、润色、纠错、病句检查"
                className="flex-1 px-3 py-2 text-sm border border-amber-200 rounded focus:outline-none focus:ring-2 focus:ring-amber-400"
              />
              <button
                type="button"
                onClick={handleInlineSubmit}
                className="px-3 py-2 bg-amber-600 text-white rounded hover:bg-amber-700 text-xs font-bold"
              >
                发送
              </button>
              <button type="button" onClick={() => setInlineOpen(false)} className="p-2 text-gray-400 hover:text-gray-600">
                <X size={14} />
              </button>
            </div>
            <p className="text-[10px] text-amber-700 mt-1">
              {inlineContextMode === 'selection' ? '基于选中文本' : '基于当前段落'} + 全文上下文，Enter 发送 · 也可 Ctrl+J 唤起
            </p>
            {inlineRecommendedNotes.length > 0 && (
              <div className="mt-2 border-t border-amber-200 pt-2">
                <p className="text-[10px] text-amber-800 mb-1.5 font-medium">推荐卡片（可加入上下文）</p>
                <div className="space-y-1 max-h-28 overflow-y-auto">
                  {inlineRecommendedNotes.map((n, i) => {
                    const id = n.id ?? n.axiom ?? `rec-${i}`;
                    const added = inlineSelectedCardIds.includes(id);
                    return (
                      <div key={id} className="flex items-start gap-2 text-xs bg-white/80 rounded px-2 py-1 border border-amber-100">
                        <span className="flex-1 line-clamp-2 text-gray-700">{(n.content || n.axiom || '').slice(0, 80)}…</span>
                        <button type="button" onClick={() => setInlineSelectedCardIds((prev) => added ? prev.filter((x) => x !== id) : [...prev, id])} className={added ? 'text-amber-600 font-medium' : 'text-amber-600 hover:underline'}>
                          {added ? '已加入' : '加入上下文'}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
        {/* Ghost 建议条：确认 Enter / 取消 Esc */}
        {ghostSuggestion && (
          <div className="mx-2 mt-2 p-2 rounded-lg border-2 border-emerald-300 bg-emerald-50 shadow-md">
            <p className="text-[10px] text-emerald-800 mb-1.5 font-sans uppercase">AI 建议</p>
            <div className="text-xs leading-relaxed max-h-24 overflow-y-auto mb-2 line-clamp-4">
              <GhostSuggestionContent ghost={ghostSuggestion} fullContent={markdownContent} maxChars={400} />
            </div>
            <div className="flex items-center gap-2">
              <button type="button" onClick={applyGhostSuggestion} className="px-2 py-1 text-[10px] bg-emerald-600 text-white rounded hover:bg-emerald-700">确认 (Enter)</button>
              <button type="button" onClick={() => setGhostSuggestion(null)} className="px-2 py-1 text-[10px] border border-emerald-300 text-emerald-700 rounded hover:bg-emerald-100">取消 (Esc)</button>
            </div>
          </div>
        )}
        {inlineLoading && (
          <div className="mx-2 mt-2 py-2 text-center text-xs text-amber-600">行内助手处理中…</div>
        )}
        {/* 编辑区 / 预览区 */}
        <div className="flex-1 overflow-hidden">
          {assistTasks.length > 0 && (
            <div className="px-3 pt-2 space-y-2 max-h-48 overflow-y-auto border-b border-gray-100 bg-gray-50/70">
              {assistTasks.slice(0, 6).map((task) => (
                <div key={task.id} className="bg-white border border-gray-200 rounded px-2 py-1.5 text-[11px]">
                  <div className="flex(items-center justify-between mb-1">
                    <span className="font-semibold text-gray-700">{task.actionLabel}</span>
                    <div className="flex items-center gap-2">
                      <span className={`text-[10px] ${task.status === 'error' ? 'text-red-500' : task.status === 'done' ? 'text-emerald-600' : 'text-blue-600'}`}>
                        {task.status === 'running' ? '处理中' : task.status === 'done' ? '已完成' : '失败'}
                      </span>
                      <button className="text-gray-400 hover:text-gray-700" onClick={() => removeTask(task.id)}>关闭</button>
                    </div>
                  </div>
                  <div className="h-1.5 w-full bg-gray-100 rounded overflow-hidden mb-1">
                    <div className={`h-full ${task.status === 'error' ? 'bg-red-400' : task.status === 'done' ? 'bg-emerald-500' : 'bg-blue-500'}`} style={{ width: `${task.progress || 0}%` }} />
                  </div>
                  <p className="text-gray-500">{task.message}</p>
                  {task.status === 'done' && (
                    <div className="mt-1 flex items-center gap-2 text-[10px] text-gray-500">
                      <span>RAG: {task.usedRag ? '是' : '否'}</span>
                      <span>学术 API: {task.usedAcademicApi ? '是' : '否'}</span>
                      {task.sources?.length > 0 && <span>来源: {task.sources.length}</span>}
                    </div>
                  )}
                  {task.status === 'done' && !!task.result && (
                    <div className="mt-1 flex items-center gap-2">
                      <button
                        onClick={() => applyTaskResult(task)}
                        className="px-2 py-0.5 border border-blue-200 text-blue-700 rounded hover:bg-blue-50"
                      >
                        应用结果
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
          {showPreview ? (
            <MarkdownPreview content={markdownContent} references={references} />
          ) : (
            <textarea
              ref={textAreaRef}
              id="main-editor"
              className="w-full h-full resize-none p-8 focus:outline-none font-mono text-sm text-gray-800 leading-relaxed custom-scrollbar selection:bg-yellow-200 caret-blue-500"
              value={markdownContent}
              onChange={(e) => setMarkdownContent(e.target.value)}
              onDoubleClick={handleEditorDoubleClick}
              onKeyDown={handleKeyDown}
              placeholder="# 开始书写...\n\n使用 **粗体**、*斜体*、`代码`。双击文字或 Ctrl+J 唤出行内助手（续写/润色/纠错）"
              spellCheck={false}
            />
          )}
        </div>

        {/* 状态栏 */}
        <div className="h-6 border-t border-gray-100 bg-white/80 px-3 flex items-center justify-between text-[10px] text-gray-400 font-mono shrink-0">
          <span className="flex items-center gap-1">
            <AlignJustify size={10} />
            Markdown · 双击文字或 Ctrl+J 唤出行内助手
          </span>
          <span>{wordCount} 词 · {charCount} 字符</span>
        </div>
      </div>
    </div>
  );
};

