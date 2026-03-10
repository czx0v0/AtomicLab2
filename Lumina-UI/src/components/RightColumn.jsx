import React, { useEffect, useState, useRef, useCallback } from 'react';
import {
  Bold, Italic, List, Quote, Code, BookOpen, ChevronLeft, ChevronRight,
  Sparkles, FileText, Maximize2, Minimize2, Timer, TimerOff, Play, Pause,
  Square, Download, Upload, Trash2, PanelLeftOpen, Eye, EyeOff, AlignJustify
} from 'lucide-react';
import { useStore } from '../store/useStore';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import clsx from 'clsx';
import { motion, AnimatePresence } from 'framer-motion';

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
          <circle cx="32" cy="32" r="28" fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="4" />
          <circle
            cx="32" cy="32" r="28" fill="none"
            stroke={pomodoroActive ? '#60A5FA' : '#6B7280'}
            strokeWidth="4"
            strokeDasharray={circumference}
            strokeDashoffset={dashOffset}
            strokeLinecap="round"
            style={{ transition: 'stroke-dashoffset 1s linear' }}
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-[9px] font-pixel text-white/80">
            {pad(pomodoroMinutes)}:{pad(pomodoroSeconds)}
          </span>
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <div className="flex gap-1">
          <button
            onClick={() => setPomodoroActive(!pomodoroActive)}
            className="p-1.5 bg-white/10 hover:bg-white/20 rounded text-white/80"
            title={pomodoroActive ? '暂停' : '开始'}
          >
            {pomodoroActive ? <Pause size={12} /> : <Play size={12} />}
          </button>
          <button
            onClick={() => resetPomodoro(25)}
            className="p-1.5 bg-white/10 hover:bg-white/20 rounded text-white/80"
            title="重置"
          >
            <Square size={12} />
          </button>
          <button
            onClick={onExit}
            className="p-1.5 bg-white/10 hover:bg-red-500/40 rounded text-white/60"
            title="退出专注模式"
          >
            <Minimize2 size={12} />
          </button>
        </div>
        <span className="text-[9px] font-pixel text-white/40 uppercase">
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
  } = useStore();

  const [showPreview, setShowPreview] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
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

  // ── Zen Mode 全屏覆盖 ──────────────────────────────────────────────────────
  if (isZenMode) {
    return (
      <div className="fixed inset-0 z-50 bg-gray-900 flex flex-col">
        {/* Zen 顶栏 */}
        <div className="flex items-center justify-between px-6 py-3 bg-gray-800/80 backdrop-blur border-b border-gray-700">
          <div className="flex items-center gap-3">
            <span className="font-pixel text-xs text-gray-300 tracking-widest">ZEN MODE</span>
            <div className="w-px h-4 bg-gray-600" />
            <button
              onClick={() => setDrawerOpen(!drawerOpen)}
              className="text-gray-400 hover:text-gray-200 flex items-center gap-1 text-xs"
            >
              <Sparkles size={12} />
              知识卡片
            </button>
          </div>

          <PomodoroTimer onExit={toggleZenMode} />
        </div>

        {/* 内容区 */}
        <div className="flex-1 flex overflow-hidden">
          {/* 知识侧边栏（Zen时悬浮） */}
          <AnimatePresence>
            {drawerOpen && (
              <motion.div
                initial={{ x: -260, opacity: 0 }}
                animate={{ x: 0, opacity: 1 }}
                exit={{ x: -260, opacity: 0 }}
                className="w-[260px] shrink-0 bg-gray-800 border-r border-gray-700 overflow-y-auto"
              >
                <BrainstormDrawer isOpen={true} onClose={() => setDrawerOpen(false)} />
              </motion.div>
            )}
          </AnimatePresence>

          {/* 编辑器 */}
          <div className="flex-1 flex justify-center overflow-hidden">
            {showPreview ? (
              <div className="w-full max-w-3xl h-full overflow-y-auto p-12 text-gray-100 custom-scrollbar">
                <div className="prose prose-invert prose-sm max-w-none">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {markdownContent}
                  </ReactMarkdown>
                </div>
              </div>
            ) : (
              <textarea
                ref={textAreaRef}
                id="main-editor"
                className="flex-1 max-w-3xl w-full bg-transparent text-gray-100 resize-none p-12 focus:outline-none font-mono text-base leading-relaxed custom-scrollbar caret-blue-400 selection:bg-blue-500/30"
                value={markdownContent}
                onChange={(e) => setMarkdownContent(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="开始书写..."
                autoFocus
              />
            )}
          </div>
        </div>

        {/* Zen 底栏 */}
        <div className="flex items-center justify-between px-6 py-2 bg-gray-800/60 border-t border-gray-700 text-xs text-gray-500 font-mono">
          <div className="flex items-center gap-4">
            <button onClick={() => setShowPreview(!showPreview)} className="hover:text-gray-300 flex items-center gap-1">
              {showPreview ? <EyeOff size={12} /> : <Eye size={12} />}
              {showPreview ? '编辑' : '预览'}
            </button>
            <button onClick={exportMd} className="hover:text-gray-300 flex items-center gap-1">
              <Download size={12} /> 导出
            </button>
          </div>
          <span>{wordCount} 词 · {charCount} 字符</span>
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
