import React, { useEffect, useState, useRef, useCallback } from 'react';
import {
  Bold, Italic, List, Quote, Code, BookOpen, ChevronLeft, ChevronRight,
  Sparkles, FileText, Maximize2, Minimize2, Timer, TimerOff, Play, Pause,
  Square, Download, Upload, Trash2, PanelLeftOpen, Eye, EyeOff, AlignJustify
} from 'lucide-react';
import { useStore } from '../store/useStore';
import { Document, Page, pdfjs } from 'react-pdf';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import clsx from 'clsx';
import { motion, AnimatePresence } from 'framer-motion';
import * as api from '../api/client';

pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

// ─── Zen 倒计时组件 ────────────────────────────────────────────────────────────
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
          <span className="text-[9px] font-pixel text-stone-600">
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
        <span className="text-[9px] font-pixel text-stone-500 uppercase">
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
        <span className="text-xs font-bold text-amber-800 flex items-center gap-2 font-pixel">
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

// ─── Markdown 渲染组件 ─────────────────────────────────────────────────────────
const MarkdownPreview = ({ content }) => {
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
      <div className="prose prose-sm max-w-none prose-headings:font-bold prose-a:text-blue-600 prose-code:bg-gray-100 prose-code:px-1 prose-code:rounded">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[]}
          components={components}
        >
          {content}
        </ReactMarkdown>
      </div>
    </div>
  );
};

// ─── 主编辑器 ──────────────────────────────────────────────────────────────────
export const RightColumn = () => {
  const {
    markdownContent, setMarkdownContent,
    isZenMode, toggleZenMode,
    pomodoroActive,
    pdfFile, pdfUrl, currentPage, setCurrentPage,
  } = useStore();

  const [showPreview, setShowPreview] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [assistLoading, setAssistLoading] = useState('');
  const [assistTasks, setAssistTasks] = useState([]);
  const textAreaRef = useRef(null);

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

  // Tab 键支持
  const handleKeyDown = (e) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      insertAtCursor('  ');
    }
    // Ctrl+B 加粗
    if (e.ctrlKey && e.key === 'b') {
      e.preventDefault();
      wrapSelection('**');
    }
    // Ctrl+I 斜体
    if (e.ctrlKey && e.key === 'i') {
      e.preventDefault();
      wrapSelection('*');
    }
    // Esc 退出 Zen 模式
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

  // ── Zen Mode 全屏覆盖 ──────────────────────────────────────────────────────
  if (isZenMode) {
    return (
      <div className="fixed inset-0 z-50 bg-stone-100 flex flex-col">
        {/* Zen 顶栏 */}
        <div className="flex items-center justify-between px-6 py-2.5 bg-white/90 backdrop-blur border-b border-stone-200 shrink-0">
          <div className="flex items-center gap-3">
            <span className="font-pixel text-xs text-stone-600 tracking-widest">✦ ZEN MODE</span>
            <div className="w-px h-4 bg-stone-300" />
            <button
              onClick={() => setDrawerOpen(!drawerOpen)}
              className="text-stone-500 hover:text-amber-600 flex items-center gap-1 text-xs"
            >
              <Sparkles size={12} />
              知识卡片
            </button>
          </div>

          <PomodoroTimer onExit={toggleZenMode} />
        </div>

        {/* 三栏内容区 */}
        <div className="flex-1 flex overflow-hidden min-h-0">
          {/* 左侧：原文参考 */}
          <div className="w-[320px] shrink-0 bg-white border-r border-stone-200 overflow-hidden flex flex-col">
            <div className="px-3 py-2 border-b border-stone-200 text-[10px] font-pixel text-stone-600 flex items-center justify-between">
              <span>ORIGINAL PDF</span>
              <span>p.{currentPage}</span>
            </div>
            <div className="flex-1 overflow-auto p-2">
              {(pdfFile || pdfUrl) ? (
                <Document file={pdfFile || pdfUrl}>
                  <Page pageNumber={currentPage} width={290} renderTextLayer={false} renderAnnotationLayer={false} />
                </Document>
              ) : (
                <p className="text-xs text-stone-400 p-2">暂无 PDF，可在阅读区上传或从 ArXiv 加载。</p>
              )}
            </div>
            <div className="p-2 border-t border-stone-200 flex items-center justify-between">
              <button
                onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
                className="px-2 py-1 text-[10px] bg-stone-100 rounded hover:bg-stone-200"
              >
                Prev
              </button>
              <button
                onClick={() => setCurrentPage(currentPage + 1)}
                className="px-2 py-1 text-[10px] bg-stone-100 rounded hover:bg-stone-200"
              >
                Next
              </button>
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
                <div className="flex-1 overflow-y-auto bg-white rounded-lg shadow-sm border border-stone-200 p-8 custom-scrollbar">
                  <div className="prose prose-sm max-w-none prose-headings:font-bold prose-stone">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {markdownContent}
                    </ReactMarkdown>
                  </div>
                </div>
              ) : (
                <textarea
                  ref={textAreaRef}
                  id="main-editor"
                  className="flex-1 bg-white rounded-lg shadow-sm border border-stone-200 resize-none p-8 focus:outline-none focus:ring-2 focus:ring-amber-200 font-mono text-sm text-stone-800 leading-relaxed custom-scrollbar caret-amber-500 selection:bg-amber-100"
                  value={markdownContent}
                  onChange={(e) => setMarkdownContent(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="开始书写..."
                  autoFocus
                />
              )}
            </div>
          </div>
        </div>

        {/* Zen 底栏 */}
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
              title="进入 Zen 专注模式"
            >
              <Maximize2 size={14} />
            </button>
          </div>
        </div>

        {/* 编辑区 / 预览区 */}
        <div className="flex-1 overflow-hidden">
          {assistTasks.length > 0 && (
            <div className="px-3 pt-2 space-y-2 max-h-48 overflow-y-auto border-b border-gray-100 bg-gray-50/70">
              {assistTasks.slice(0, 6).map((task) => (
                <div key={task.id} className="bg-white border border-gray-200 rounded px-2 py-1.5 text-[11px]">
                  <div className="flex items-center justify-between mb-1">
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
            <MarkdownPreview content={markdownContent} />
          ) : (
            <textarea
              ref={textAreaRef}
              id="main-editor"
              className="w-full h-full resize-none p-8 focus:outline-none font-mono text-sm text-gray-800 leading-relaxed custom-scrollbar selection:bg-yellow-200 caret-blue-500"
              value={markdownContent}
              onChange={(e) => setMarkdownContent(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="# 开始书写...\n\n使用 **粗体**、*斜体*、`代码`。\n\n插入页码引用：[Attention 机制](page-3 '详见第3页')"
              spellCheck={false}
            />
          )}
        </div>

        {/* 状态栏 */}
        <div className="h-6 border-t border-gray-100 bg-white/80 px-3 flex items-center justify-between text-[10px] text-gray-400 font-mono shrink-0">
          <span className="flex items-center gap-1">
            <AlignJustify size={10} />
            Markdown · GFM
          </span>
          <span>{wordCount} 词 · {charCount} 字符</span>
        </div>
      </div>
    </div>
  );
};
