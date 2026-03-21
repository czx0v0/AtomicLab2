import clsx from 'clsx';
import { AnimatePresence, motion } from 'framer-motion';
import {
    AlertCircle,
    ArrowRight,
    BookOpen,
    Bot,
    Brain,
    ChevronRight,
    Download, ExternalLink,
    FileSearch,
    FileText,
    GitBranch,
    Inbox,
    Highlighter,
    Languages,
    Layers,
    Link2,
    ListTree,
    Loader2,
    Plus,
    Network,
    Search,
    Send,
    Sparkles,
    Tag, Trash2,
    ThumbsDown,
    ThumbsUp,
    User,
    Waypoints,
    X,
    Flag
} from 'lucide-react';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ForceGraph2D from 'react-force-graph-2d';
import { Document, Page } from 'react-pdf';
import * as api from '../api/client';
import { AgentTraceThoughtChain } from './AgentTraceThoughtChain';
import { MarkdownRenderer } from './MarkdownRenderer';
import { ErrorBoundary } from './ErrorBoundary';
import { AssistantSidebar } from './CopilotSidebar';
import { useScreenshot } from '../hooks/useScreenshot';
import { SESSION_ID, useStore } from '../store/useStore';

// ─── 笔记连接面板（连接至其他卡片，在图谱中显示）────────────────────────────────
const NoteLinkPanel = ({ note, otherNotes = [] }) => {
  const { noteLinks, addNoteLink, removeNoteLink } = useStore();
  const linkedIds = React.useMemo(() => {
    const set = new Set();
    (noteLinks || []).forEach((l) => {
      if (l.sourceId === note.id) set.add(l.targetId);
      if (l.targetId === note.id) set.add(l.sourceId);
    });
    return set;
  }, [noteLinks, note.id]);
  const linkedNotes = otherNotes.filter((n) => linkedIds.has(n.id));

  return (
    <div className="border-t border-gray-100 pt-2 mt-2">
      <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-1.5 flex items-center gap-1">
        <Link2 size={10} /> 连接
      </p>
      <select
        className="w-full text-[11px] border border-gray-200 rounded px-2 py-1.5 mb-2 bg-white"
        value=""
        onChange={(e) => {
          const targetId = e.target.value;
          if (targetId) addNoteLink(note.id, targetId);
          e.target.value = '';
        }}
      >
        <option value="">连接至…</option>
        {otherNotes.filter((n) => !linkedIds.has(n.id)).map((n) => (
          <option key={n.id} value={n.id}>{(n.content || n.axiom || '无标题').slice(0, 24)}…</option>
        ))}
      </select>
      {linkedNotes.length > 0 && (
        <ul className="space-y-1">
          {linkedNotes.map((n) => (
            <li key={n.id} className="flex items-center justify-between gap-1 text-[11px] text-gray-600 bg-gray-50 rounded px-2 py-1">
              <span className="truncate">{(n.content || n.axiom || '无标题').slice(0, 20)}…</span>
              <button type="button" onClick={() => removeNoteLink(note.id, n.id)} className="p-0.5 text-red-500 hover:bg-red-50 rounded" title="取消连接"><X size={12} /></button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

// ─── 结构化原子卡片（公理 / 方法 / 边界，含 KaTeX 公式 + 醒目徽标）────────────
const AtomicCardDetail = ({ note, compact = false }) => {
  const hasStructured = note.axiom || note.method || note.boundary;
  if (!hasStructured) {
    return (
      <p className="text-xs text-gray-900 leading-relaxed font-sans line-clamp-4">{note.content}</p>
    );
  }
  const blockCls = compact ? 'text-[11px] leading-relaxed' : 'text-xs leading-relaxed';
  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap gap-1.5 mb-1">
        {note.axiom && (
          <span className="px-2 py-0.5 text-[9px] font-bold rounded-md bg-white text-red-800 border-2 border-red-300 shadow-sm">
            🔴 Axiom 公理
          </span>
        )}
        {note.method && (
          <span className="px-2 py-0.5 text-[9px] font-bold rounded-md bg-white text-blue-800 border-2 border-blue-300 shadow-sm">
            🔵 Method 方法
          </span>
        )}
        {note.boundary && (
          <span className="px-2 py-0.5 text-[9px] font-bold rounded-md bg-white text-emerald-800 border-2 border-emerald-300 shadow-sm">
            🟢 Boundary 边界
          </span>
        )}
      </div>
      {note.axiom && (
        <div className="rounded-md border border-red-100 bg-red-50/40 px-2 py-1.5">
          <p className="text-[9px] font-sans text-red-700 font-semibold mb-0.5">Axiom</p>
          <p className={clsx('text-gray-900', blockCls)}>{note.axiom}</p>
        </div>
      )}
      {note.method && (
        <div className="rounded-md border border-blue-100 bg-blue-50/40 px-2 py-1.5">
          <p className="text-[9px] font-sans text-blue-800 font-semibold mb-0.5">Method</p>
          <div className={clsx('bg-white border border-slate-200 rounded-md px-2 py-1.5 overflow-x-auto [&_.katex]:text-sm', blockCls)}>
            <MarkdownRenderer>
              {note.method}
            </MarkdownRenderer>
          </div>
        </div>
      )}
      {note.boundary && (
        <div className="rounded-md border border-emerald-100 bg-emerald-50/40 px-2 py-1.5">
          <p className="text-[9px] font-sans text-emerald-800 font-semibold mb-0.5">Boundary</p>
          <p className={clsx('text-gray-800', blockCls)}>{note.boundary}</p>
        </div>
      )}
      {note.content && !note.axiom && !note.method && !note.boundary && (
        <p className={clsx('text-gray-900', blockCls)}>{note.content}</p>
      )}
    </div>
  );
};

// ─── 搜索可视化组件 ────────────────────────────────────────────────────────────
const SearchVisualizer = ({ status, query }) => {
  const steps = [
    { id: 'tokenizing', label: '分词', icon: Layers },
    { id: 'vector',     label: '向量检索', icon: Brain },
    { id: 'fusion',     label: 'RRF 融合', icon: Sparkles },
    { id: 'done',       label: '完成', icon: ArrowRight },
  ];
  const order = ['idle', 'tokenizing', 'vector', 'fusion', 'done'];
  const getStatus = (sid) => {
    const ci = order.indexOf(status);
    const si = order.indexOf(sid);
    if (ci > si) return 'completed';
    if (ci === si) return 'active';
    return 'pending';
  };
  if (status === 'idle' || status === 'error') return null;
  return (
    <div className="w-full bg-blue-50 border-2 border-black p-3 font-sans mb-3 shadow-[4px_4px_0px_#000]">
      <div className="flex items-center justify-between mb-3 pb-2 border-b border-blue-200">
        <span className="text-[9px] text-blue-600 uppercase flex items-center gap-2">
          <span className="animate-pulse">●</span> PROCESSING
        </span>
        <span className="text-[9px] text-gray-500 truncate max-w-[150px]">"{query}"</span>
      </div>
      <div className="flex items-center justify-between gap-1">
        {steps.map((step) => {
          const st = getStatus(step.id);
          return (
            <div key={step.id} className={clsx('flex-1 flex flex-col items-center gap-1.5 transition-all',
              st === 'active' && 'scale-110', st === 'pending' && 'opacity-40 grayscale')}>
              <div className={clsx('w-7 h-7 flex items-center justify-center border-2 border-black bg-white shadow-[2px_2px_0px_#000]',
                st === 'completed' && 'bg-green-100 border-green-800',
                st === 'active' && 'bg-yellow-100 border-yellow-600 animate-bounce')}>
                <step.icon size={13} className={st === 'completed' ? 'text-green-800' : 'text-gray-800'} />
              </div>
              <span className={clsx('text-[8px] uppercase tracking-tighter font-bold',
                st === 'active' ? 'text-blue-600' : 'text-gray-500')}>
                {step.label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};

// ─── 笔记卡片：普通笔记（原文摘录）与原子知识（结构化 + 白底阴影）严格区分 ───────
const NoteCard = ({ note, onDelete }) => {
  const { pdfFile, pdfUrl, setActiveReference, addHighlight } = useStore();
  const pdfSource = note.screenshot ? null : (pdfFile || pdfUrl || null);
  const { imageSrc: hookSrc, loading: hookLoading } = useScreenshot(
    pdfSource,
    note.page,
    note.bbox
  );
  const imageSrc = note.screenshot || hookSrc;
  const loading = !note.screenshot && hookLoading;
  const [actionLoading, setActionLoading] = useState(null);

  const isAtomicKnowledge = !!(note.axiom || note.method || note.boundary);

  const typeColor = {
    method:     'bg-cyan-100 text-cyan-900 border-cyan-800',
    formula:    'bg-purple-100 text-purple-900 border-purple-800',
    idea:       'bg-amber-100 text-amber-900 border-amber-800',
    definition: 'bg-green-100 text-green-900 border-green-800',
    data:       'bg-rose-100 text-rose-900 border-rose-800',
  };

  const handleTranslate = async () => {
    if (!note.content || actionLoading) return;
    setActionLoading('translate');
    try {
      const resp = await api.translateText(note.content.substring(0, 2000));
      const notes = useStore.getState().notes;
      useStore.getState().setNotes(notes.map(n =>
        n.id === note.id ? { ...n, translation: resp.translation } : n
      ));
    } catch (e) {
      console.warn('翻译失败:', e);
    } finally {
      setActionLoading(null);
    }
  };

  const handleHighlight = () => {
    if (note.page && note.bbox) {
      addHighlight({
        page: note.page,
        text: note.content?.substring(0, 50) || '',
        color: 'yellow',
        bbox: note.bbox,
        id: Date.now(),
      });
      setActiveReference({ page: note.page, bbox: note.bbox });
    }
  };

  const handleAnnotate = () => {
    const text = prompt('输入批注内容：');
    if (text) {
      const notes = useStore.getState().notes;
      useStore.getState().setNotes(notes.map(n =>
        n.id === note.id ? { ...n, content: `${n.content}\n\n[批注] ${text}` } : n
      ));
    }
  };

  const handleCrush = async () => {
    if (!note.content || actionLoading) return;
    // #region agent log
    fetch('http://127.0.0.1:7911/ingest/d425475d-29d6-4d24-8a29-340d5c8049ce',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'360e80'},body:JSON.stringify({sessionId:'360e80',runId:'pre-fix',hypothesisId:'H2',location:'MiddleColumn.jsx:handleCrush:start',message:'crush clicked',data:{noteId:note.id||'',contentLen:(note.content||'').length,hasAtomic:!!(note.axiom||note.method||note.boundary)},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    setActionLoading('crush');
    try {
      const resp = await api.decomposeNote(note.content, note.id, useStore.getState().activeDocId || '');
      const firstAtom = Array.isArray(resp?.atoms) && resp.atoms.length > 0 ? resp.atoms[0] : {};
      const axiom = (resp.axiom ?? firstAtom?.axiom ?? '').trim();
      const method = (resp.method ?? firstAtom?.methodology ?? '').trim();
      const boundary = (resp.boundary ?? firstAtom?.boundary ?? '').trim();
      // #region agent log
      fetch('http://127.0.0.1:7911/ingest/d425475d-29d6-4d24-8a29-340d5c8049ce',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'360e80'},body:JSON.stringify({sessionId:'360e80',runId:'pre-fix',hypothesisId:'H2',location:'MiddleColumn.jsx:handleCrush:resp',message:'decompose response',data:{noteId:note.id||'',axiomLen:axiom.length,methodLen:method.length,boundaryLen:boundary.length,hasMessage:!!resp.message},timestamp:Date.now()})}).catch(()=>{});
      // #endregion
      if (axiom || method || boundary) {
        try {
          await api.updateNote(note.id, { axiom, method, boundary });
        } catch (_) {}
        const notes = useStore.getState().notes;
        useStore.getState().setNotes(notes.map(n =>
          n.id === note.id ? { ...n, axiom, method, boundary } : n
        ));
        // #region agent log
        fetch('http://127.0.0.1:7911/ingest/d425475d-29d6-4d24-8a29-340d5c8049ce',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'360e80'},body:JSON.stringify({sessionId:'360e80',runId:'pre-fix',hypothesisId:'H2',location:'MiddleColumn.jsx:handleCrush:setNotes',message:'set atomic fields to store note',data:{noteId:note.id||'',storeAtomicCount:(useStore.getState().notes||[]).filter(x=>x.axiom||x.method||x.boundary).length},timestamp:Date.now()})}).catch(()=>{});
        // #endregion
      }
      if (!(axiom || method || boundary) && resp.message) {
        const notes = useStore.getState().notes;
        const typeMap = { '方法': 'method', '公式': 'formula', '定义': 'definition', '观点': 'idea', '数据': 'data', '其他': 'other' };
        const typeResp = await api.translateText(
          `请对以下学术文本片段进行知识类型分类，只返回一个词：方法/公式/定义/观点/数据/其他\n\n"${note.content.substring(0, 200)}"`,
          'zh'
        );
        const raw = typeResp.translation?.replace(/[\[\]Mock 翻译]/g, '').trim();
        const detectedType = typeMap[raw] || null;
        if (detectedType) {
          useStore.getState().setNotes(notes.map(n =>
            n.id === note.id ? { ...n, type: detectedType } : n
          ));
        }
      }
    } catch (e) {
      console.warn('粉碎/解构失败:', e);
    } finally {
      setActionLoading(null);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      className={clsx(
        'p-3 flex flex-col gap-2 group transition-all relative',
        isAtomicKnowledge
          ? 'bg-white border border-slate-200 rounded-xl shadow-[0_4px_14px_rgba(15,23,42,0.08)] hover:shadow-[0_6px_20px_rgba(15,23,42,0.12)] border-t-[3px] border-t-emerald-500'
          : 'bg-slate-100/95 border-l-4 border-slate-600 rounded-r-lg shadow-sm ring-1 ring-slate-200/80'
      )}
    >
      <div className={clsx('flex items-center justify-between pb-2', isAtomicKnowledge ? 'border-b border-slate-100' : 'border-b border-slate-300/40')}>
        <div className="flex items-center gap-1.5 flex-wrap">
          {isAtomicKnowledge ? (
            <>
              <span className="text-[9px] font-bold text-emerald-800 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">⚛️ 原子知识</span>
              {note.type && (
                <span className={clsx('px-2 py-0.5 text-[9px] uppercase font-bold border font-sans rounded', typeColor[note.type] ?? 'bg-slate-100 text-slate-800 border-slate-300')}>
                  {note.type}
                </span>
              )}
            </>
          ) : (
            <>
              <span className="text-[9px] font-semibold text-slate-600 tracking-wide">原文摘录</span>
              <span className={clsx('px-1.5 py-0.5 text-[9px] font-bold border-l-2 border-slate-400 pl-2 text-slate-700', typeColor[note.type] ?? 'bg-slate-200/80 text-slate-800')}>
                {note.type || 'note'}
              </span>
            </>
          )}
          {(note.content === '[截图高亮]' || (note.screenshot && !note.content?.trim())) && (
            <span className="px-1.5 py-0.5 text-[8px] font-sans text-amber-700 bg-amber-100 border border-amber-300 rounded" title="文字未识别，切页或解析完成后将自动补全">待识别</span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {note.page && (
            <button
              onClick={() => setActiveReference({ page: note.page, bbox: note.bbox ?? [0,0,0,0] })}
              className={clsx(
                'text-[9px] px-2 py-0.5 flex items-center gap-1 cursor-pointer font-mono transition-colors border rounded',
                isAtomicKnowledge
                  ? 'bg-slate-50 border-slate-300 hover:bg-slate-900 hover:text-white'
                  : 'bg-white/80 border-slate-400 hover:bg-slate-800 hover:text-white'
              )}
            >
              <BookOpen size={9} />p.{note.page}
            </button>
          )}
          {onDelete && (
            <button onClick={() => onDelete(note.id)} className="p-0.5 opacity-0 group-hover:opacity-100 hover:text-red-500 transition-all">
              <X size={12} />
            </button>
          )}
        </div>
      </div>

      <div
        className={clsx(
          'w-full h-28 relative overflow-hidden flex items-center justify-center rounded-md',
          isAtomicKnowledge
            ? 'bg-slate-50 border border-dashed border-slate-200'
            : 'bg-white/70 border border-slate-300/60 border-dashed'
        )}
      >
        {loading ? (
          <div className="flex flex-col items-center gap-2">
            <Loader2 size={16} className="animate-spin text-gray-400" />
            <span className="text-[9px] font-sans text-gray-400">RENDERING</span>
          </div>
        ) : imageSrc ? (
          <img src={imageSrc} alt="预览" className="w-full h-full object-contain p-1" />
        ) : note.screenshot ? (
          <div className="text-center opacity-50 text-[9px] font-sans text-gray-500">截图加载中</div>
        ) : (
          <div className="text-center text-gray-400 px-2 w-full">
            <FileText size={18} className="mx-auto mb-1 opacity-60" />
            <span className="text-[9px] font-sans block truncate">{isAtomicKnowledge ? '关联片段' : '原文摘录预览'}</span>
          </div>
        )}
      </div>

      {isAtomicKnowledge ? (
        <AtomicCardDetail note={note} />
      ) : (
        <blockquote className="text-[11px] text-slate-800 leading-relaxed whitespace-pre-wrap border-l-4 border-slate-400 pl-3 py-2 bg-white/50 rounded-r-md">
          {note.content || '（无内容）'}
        </blockquote>
      )}
      {note.translation && (
        <p className="text-xs text-gray-500 bg-gray-50 p-2 border-l-4 border-gray-300 italic leading-relaxed line-clamp-3">
          {note.translation}
        </p>
      )}
      {note.keywords?.length > 0 && (
        <div className="flex flex-wrap gap-1 pt-1 border-t border-gray-100">
          {note.keywords.slice(0, 4).map((k) => (
            <span key={k} className="text-[9px] bg-blue-50 text-blue-700 px-1.5 py-0.5 border border-blue-200 flex items-center gap-0.5">
              <Tag size={8} />{k}
            </span>
          ))}
        </div>
      )}

      {/* 操作工具栏 */}
      <div className="flex items-center gap-1 pt-2 border-t border-gray-100 justify-between">
        <div className="flex items-center gap-1">
          <button
            onClick={handleTranslate}
            disabled={actionLoading === 'translate'}
            className="text-[9px] px-2 py-1 rounded border flex items-center gap-1 bg-blue-50 border-blue-300 text-blue-700 hover:bg-blue-100 disabled:opacity-50"
            title="翻译"
          >
            {actionLoading === 'translate' ? <Loader2 size={12} className="animate-spin" /> : <Languages size={12} />} 译
          </button>
          <button
            onClick={handleHighlight}
            className="text-[9px] px-2 py-1 rounded border flex items-center gap-1 bg-yellow-50 border-yellow-300 text-yellow-700 hover:bg-yellow-100"
            title="高亮定位"
          >
            <Highlighter size={12} /> 亮
          </button>
          <button
            onClick={handleAnnotate}
            className="text-[9px] px-2 py-1 rounded border flex items-center gap-1 bg-green-50 border-green-300 text-green-700 hover:bg-green-100"
            title="添加批注"
          >
            <Tag size={12} /> 注
          </button>
        </div>
        <button
          onClick={handleCrush}
          disabled={actionLoading === 'crush'}
          className="text-[9px] px-2 py-1 rounded border flex items-center gap-1 bg-pink-50 border-pink-300 text-pink-600 font-bold hover:bg-pink-100 disabled:opacity-50"
          title="AI 分类"
        >
          {actionLoading === 'crush' ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />} 粉碎
        </button>
      </div>
    </motion.div>
  );
};

// ─── 辅助：将笔记分配到最匹配的章节 ─────────────────────────────────────────
const assignNotesToSections = (notes, sections) => {
  if (!sections?.length) return {};
  const maxPage = Math.max(...notes.map(n => n.page || 0), 1);
  const perSection = Math.ceil(maxPage / sections.length) || 1;
  const map = {}; // sectionIdx -> [note, ...]
  notes.forEach(n => {
    const pg = n.page || 1;
    // try text-match first
    let bestIdx = -1;
    for (let i = 0; i < sections.length; i++) {
      if (sections[i].content && n.content && sections[i].content.includes(n.content.substring(0, 40))) {
        bestIdx = i; break;
      }
    }
    if (bestIdx < 0) bestIdx = Math.min(Math.floor((pg - 1) / perSection), sections.length - 1);
    if (!map[bestIdx]) map[bestIdx] = [];
    map[bestIdx].push(n);
  });
  return map;
};

// ─── 轻量级树状脑图（Document → Section → Note），点击节点展示结构化原子卡片 ──
const TreeMapView = ({ notes, sections = [], docName = '', onSelectNote }) => {
  const [collapsed, setCollapsed] = useState({ doc: false });
  const secMap = React.useMemo(() => {
    const m = assignNotesToSections(notes, sections);
    if (!sections?.length && notes.length > 0) m[0] = notes;
    return m;
  }, [notes, sections]);
  const sectionList = sections?.length ? sections.map((s, idx) => ({ ...s, idx })) : [{ title: '未分章节', idx: 0 }];

  const toggle = (key) => setCollapsed((c) => ({ ...c, [key]: !c[key] }));

  return (
    <div className="flex-1 flex overflow-hidden min-h-0">
      <div className="flex-1 overflow-y-auto p-3 custom-scrollbar">
        <div className="space-y-0.5">
          <button
            onClick={() => toggle('doc')}
            className="w-full flex items-center gap-2 py-2 px-3 rounded-lg bg-blue-50 border border-blue-200 text-left font-sans text-xs text-blue-800"
          >
            <ChevronRight size={14} className={clsx('transition-transform', collapsed.doc && '-rotate-90')} />
            <FileText size={14} />
            {docName || '文档'}
          </button>
          {!collapsed.doc && (
            <div className="ml-4 mt-1 space-y-0.5 border-l-2 border-gray-200 pl-3">
              {sectionList.map((sec, idx) => {
                const secId = `sec_${idx}`;
                const isCollapsed = collapsed[secId];
                const secNotes = secMap[idx] || secMap[sec.idx] || [];
                return (
                  <div key={secId} className="space-y-0.5">
                    <button
                      onClick={() => toggle(secId)}
                      className="w-full flex items-center gap-2 py-1.5 px-2 rounded hover:bg-emerald-50 text-left text-[11px] text-gray-700"
                    >
                      <ChevronRight size={12} className={clsx('transition-transform', isCollapsed && '-rotate-90')} />
                      <ListTree size={12} className="text-emerald-600" />
                      {sec.title?.substring(0, 28) || '未命名'}
                      <span className="text-gray-400 ml-1">({secNotes.length})</span>
                    </button>
                    {!isCollapsed && (
                      <div className="ml-4 space-y-0.5">
                        {sec.summary && (
                          <p className="text-[9px] text-gray-400 italic line-clamp-2 mb-1">{sec.summary}</p>
                        )}
                        {secNotes.length === 0 && !sec.summary && (
                          <p className="text-[10px] text-gray-400 py-1">暂无笔记</p>
                        )}
                        {secNotes.map((n) => (
                          <button
                            key={n.id}
                            onClick={() => onSelectNote?.(n)}
                            className="w-full flex items-center gap-2 py-1.5 px-2 rounded hover:bg-amber-50 border-l-2 border-transparent hover:border-amber-400 text-left text-[11px] text-gray-600"
                          >
                            <Sparkles size={10} className="text-amber-500 shrink-0" />
                            <span className="truncate">{n.content?.substring(0, 36) || n.axiom?.substring(0, 36) || '无内容'}…</span>
                            {n.page && <span className="text-[9px] text-gray-400 shrink-0">p.{n.page}</span>}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
      {/* 右侧占位：由父组件通过 selectedNote 渲染详情 */}
    </div>
  );
};

// ─── 知识图谱视图（力导向：文档→章节→普通卡片→原子知识为下一层级）────────────
const LEVEL_COLORS = { document: '#3b82f6', section: '#10b981', method: '#06b6d4', formula: '#a855f7', idea: '#f59e0b', definition: '#22c55e', data: '#ef4444', other: '#6b7280', tag: '#c084fc', atomic_note: '#059669', atomic: '#059669' };

/** 与画布节点 type/level 对齐的中文图例（动态图例用 key 索引） */
const GRAPH_TYPE_LABELS = {
  document: '文献',
  section: '章节',
  note: '笔记',
  atomic_note: '原子知识',
  atomic: '原子知识',
  tag: '标签',
  entity: '概念实体',
  other: '其他',
  unknown: '未知',
};

const isAtomicNoteNode = (n) => !!(n.axiom || n.method || n.boundary);

/** 图谱节点是否视为「原子」类（兼容 API 的 atomic / atomic_note） */
const isGraphAtomicType = (n) => {
  const t = String(n?.type || n?.level || n?.category || '');
  return t === 'atomic' || t === 'atomic_note';
};

/** 从节点解析用于分组与统计的类型键（与后端 nodes[].type 一致） */
const graphNodeTypeKey = (n) => String(n?.type || n?.level || n?.category || 'unknown');

const GraphView = ({ scope = 'global', docId = '', docName = '' }) => {
  const { setActiveReference } = useStore();
  const containerRef = useRef(null);
  const [dims, setDims] = useState({ w: 500, h: 400 });
  const [graphData, setGraphData] = useState({ nodes: [], links: [] });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [meta, setMeta] = useState({ truncated: false, message: '' });

  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver(([e]) => {
      setDims({ w: e.contentRect.width, h: e.contentRect.height });
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    api.getOrganizeGraph(scope === 'current' ? (docId || '') : 'global', 200)
      .then((resp) => {
        if (cancelled) return;
        const nodes = Array.isArray(resp?.nodes) ? resp.nodes.map((n) => {
          const t = n.type;
          let level = 'other';
          if (t === 'document') level = 'document';
          else if (t === 'section') level = 'section';
          else if (t === 'note') level = 'note';
          else if (t === 'atomic_note' || t === 'atomic') level = 'atomic_note';
          else if (t === 'tag') level = 'tag';
          else if (t === 'entity') level = 'entity';
          const color = n.color || LEVEL_COLORS[level] || LEVEL_COLORS.other;
          const sz = n.size || (t === 'document' ? 12 : t === 'section' ? 9 : t === 'note' ? 7 : t === 'atomic_note' || t === 'atomic' ? 6 : t === 'tag' || t === 'entity' ? 5 : 5);
          return { ...n, level, color, sz };
        }) : [];
        const links = Array.isArray(resp?.edges) ? resp.edges.map((e) => {
          const rel = (e.relation || '').toLowerCase();
          let type = 'assoc';
          if (rel === 'contains') type = 'contains';
          else if (rel === 'tagged') type = 'tagged';
          else if (rel === 'mentions') type = 'mentions';
          return { source: e.source, target: e.target, type, relation: e.relation || '' };
        }) : [];
        setGraphData({ nodes, links });
        setMeta({
          truncated: !!resp?.truncated,
          message: resp?.message || '',
        });
      })
      .catch((e) => {
        if (!cancelled) setError(e?.message || '图谱加载失败');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [scope, docId]);

  /** 图例与统计完全来自当前画布 nodes，与节点颜色一致 */
  const graphLegendAndStats = useMemo(() => {
    const nodes = graphData.nodes;
    const keys = [...new Set(nodes.map(graphNodeTypeKey))].sort();
    const entries = keys.map((key) => {
      const sample = nodes.find((n) => graphNodeTypeKey(n) === key);
      const color = sample?.color || LEVEL_COLORS[key] || LEVEL_COLORS.other;
      const count = nodes.filter((n) => graphNodeTypeKey(n) === key).length;
      return { key, color, count, label: GRAPH_TYPE_LABELS[key] || key };
    });
    const atomicCount = nodes.filter(isGraphAtomicType).length;
    const noteCount = nodes.filter((n) => graphNodeTypeKey(n) === 'note').length;
    return {
      entries,
      atomicCount,
      noteCount,
      total: nodes.length,
    };
  }, [graphData.nodes]);

  const handleNodeClick = useCallback((node) => {
    if (node.page_num) setActiveReference({ page: node.page_num, bbox: node.bbox ?? [0, 0, 0, 0] });
  }, [setActiveReference]);

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-400 flex-col gap-2 p-6">
        <Loader2 size={20} className="animate-spin opacity-70" />
        <p className="text-xs">加载图谱中…</p>
      </div>
    );
  }
  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center text-rose-500 flex-col gap-2 p-6">
        <AlertCircle size={20} />
        <p className="text-xs">{error}</p>
      </div>
    );
  }
  if (graphData.nodes.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-400 flex-col gap-3">
        <Network size={32} className="opacity-30" />
        <p className="text-xs font-sans">暂无知识图谱数据</p>
        <p className="text-[10px] text-gray-400">上传 PDF 并解析后自动生成</p>
      </div>
    );
  }

  const linkTypeColor = {
    contains: 'rgba(99,102,241,0.55)',
    tagged: 'rgba(251,146,60,0.45)',
    mentions: 'rgba(168,85,247,0.4)',
    assoc: 'rgba(148,163,184,0.35)',
    references: 'rgba(251,191,36,0.4)',
    manual: 'rgba(34,197,94,0.7)',
  };

  return (
    <div ref={containerRef} className="flex-1 bg-gray-900 relative overflow-hidden">
      {meta.truncated && (
        <div className="absolute top-2 left-2 right-2 z-20 text-[10px] px-2 py-1 rounded bg-amber-100 text-amber-800 border border-amber-300">
          {meta.message || '全局图谱节点过多，已为您提取展示 Top-200 核心知识网络'}
        </div>
      )}
      <ForceGraph2D
        graphData={graphData}
        width={dims.w}
        height={dims.h}
        backgroundColor="#111827"
        nodeLabel="label"
        nodeColor={n => n.color}
        nodeRelSize={5}
        linkColor={l => linkTypeColor[l.type] || 'rgba(99,102,241,0.3)'}
        linkWidth={(l) => (l.type === 'contains' ? 1.8 : l.type === 'manual' ? 2 : l.type === 'tagged' ? 1.4 : 1)}
        linkLineDash={(l) => (l.type === 'references' ? [4, 2] : l.type === 'mentions' ? [2, 3] : null)}
        onNodeClick={handleNodeClick}
        nodeCanvasObject={(node, ctx, globalScale) => {
          const sz = node.sz || 6;
          ctx.beginPath();
          if (node.level === 'document') {
            ctx.moveTo(node.x, node.y - sz); ctx.lineTo(node.x + sz, node.y); ctx.lineTo(node.x, node.y + sz); ctx.lineTo(node.x - sz, node.y); ctx.closePath();
          } else if (node.level === 'section') {
            ctx.rect(node.x - sz / 2, node.y - sz / 2, sz, sz);
          } else if (node.level === 'note') {
            ctx.rect(node.x - sz / 2, node.y - sz / 2, sz, sz);
          } else if (node.level === 'tag') {
            ctx.moveTo(node.x, node.y - sz); ctx.lineTo(node.x + sz * 0.87, node.y + sz / 2); ctx.lineTo(node.x - sz * 0.87, node.y + sz / 2); ctx.closePath();
          } else if (node.level === 'entity') {
            ctx.moveTo(node.x, node.y - sz * 0.9); ctx.lineTo(node.x + sz * 0.75, node.y + sz * 0.45); ctx.lineTo(node.x - sz * 0.75, node.y + sz * 0.45); ctx.closePath();
          } else {
            ctx.arc(node.x, node.y, sz / 2, 0, 2 * Math.PI);
          }
          ctx.fillStyle = node.color;
          ctx.fill();
          ctx.strokeStyle = node.level === 'document' ? '#fff' : node.level === 'section' ? '#6ee7b7' : node.level === 'note' ? '#fcd34d' : node.level === 'tag' ? '#fdba74' : node.level === 'entity' ? '#c4b5fd' : node.level === 'atomic_note' ? '#34d399' : '#6366f1';
          ctx.lineWidth = node.level === 'document' ? 2 : node.level === 'atomic_note' ? 0.8 : 1.2;
          ctx.stroke();
          if (globalScale > 1.2 || ['document', 'section', 'note', 'atomic_note'].includes(node.level)) {
            const fontSize = node.level === 'document' ? 11 : node.level === 'section' ? 9 : node.level === 'note' ? 8 : node.level === 'atomic_note' ? 6 : 7;
            ctx.font = `${fontSize}px sans-serif`;
            ctx.textAlign = 'center';
            ctx.fillStyle = '#d1d5db';
            ctx.fillText(node.label?.substring(0, node.level === 'atomic_note' ? 14 : 22) || '', node.x, node.y + sz + 5);
          }
        }}
      />
      {/* 动态图例：类型集合来自 nodes，色块与 node.color / LEVEL_COLORS 一致 */}
      <div className={clsx('absolute left-2 z-10 font-sans text-[9px] text-white/90 pointer-events-none max-w-[min(100%,320px)] space-y-1.5', meta.truncated ? 'top-12' : 'top-2')}>
        <p className="text-white/70 font-semibold tracking-wide">
          KNOWLEDGE GRAPH · {scope === 'global' ? 'GLOBAL' : (docName || 'LOCAL')}
        </p>
        <div className="rounded-md bg-black/45 backdrop-blur-sm px-2 py-1.5 border border-white/10">
          <p className="text-[8px] text-white/85 leading-relaxed flex flex-wrap gap-x-2 gap-y-0.5">
            <span>全部 <strong className="text-white">{graphLegendAndStats.total}</strong></span>
            <span>·</span>
            <span>原子知识 <strong className="text-emerald-300">{graphLegendAndStats.atomicCount}</strong></span>
            <span>·</span>
            <span>笔记 <strong className="text-amber-200">{graphLegendAndStats.noteCount}</strong></span>
          </p>
          <p className="text-[7px] text-white/55 mt-1">统计来自当前渲染节点，非后端冗余字段</p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {graphLegendAndStats.entries.map(({ key, color, count, label }) => (
            <span
              key={key}
              className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 bg-black/35 border border-white/10"
              title={key}
            >
              <span className="inline-block w-2.5 h-2.5 rounded-sm shrink-0 border border-white/30" style={{ backgroundColor: color }} />
              <span className="text-white/90">{label}</span>
              <span className="text-white/50">({count})</span>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
};

// ─── GraphRAG 三元组列表（与图谱同源：文档→章节→笔记、标签、笔记间概念、手动连线）────
const GraphRAGTriplesView = ({ scope = 'global', docId = '', docName = '' }) => {
  const { setPdfUrl, setViewMode } = useStore();
  const [triples, setTriples] = useState([]);
  const [showSourceColumn, setShowSourceColumn] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    api.getOrganizeTriples(scope === 'current' ? (docId || '') : 'global', 200)
      .then((resp) => {
        if (cancelled) return;
        setTriples(Array.isArray(resp?.triples) ? resp.triples : []);
        setShowSourceColumn(!!resp?.show_source_column);
      })
      .catch((e) => {
        if (!cancelled) setError(e?.message || '三元组加载失败');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [scope, docId]);

  if (triples.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-400 flex-col gap-2 p-6">
        <Network size={28} className="opacity-40" />
        <p className="text-xs font-sans">{loading ? 'GraphRAG 三元组加载中…' : '暂无 GraphRAG 三元组'}</p>
        <p className="text-[10px]">{error || '解析文档并生成笔记后自动构建'}</p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
      <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-3">
        三元组 ({scope === 'global' ? '全局' : (docName || '当前文献')}) (主体 — 关系 — 客体)
      </div>
      <ul className="space-y-2">
        {triples.map((t, i) => (
          <li key={i} className="flex items-center gap-2 flex-wrap text-xs font-sans border-b border-slate-100 pb-2 last:border-0">
            <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-700 max-w-[140px] truncate" title={t.subject}>{t.subject}</span>
            <span className="text-amber-600 shrink-0">{t.predicate}</span>
            <span className="px-2 py-0.5 rounded bg-emerald-50 text-emerald-800 max-w-[140px] truncate" title={t.object}>{t.object}</span>
            {showSourceColumn && Array.isArray(t.source_documents) && t.source_documents.length > 0 && (
              <span className="flex items-center gap-1 ml-auto">
                <span className="text-[10px] text-slate-400">来源文献:</span>
                {t.source_documents.slice(0, 2).map((d, idx) => (
                  <button
                    key={`${d}-${idx}`}
                    type="button"
                    className="text-[10px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100"
                    onClick={() => {
                      const srcDocId = t.source_doc_ids?.[idx];
                      if (!srcDocId) return;
                      const url = srcDocId === 'global_demo_official' ? '/api/demo/pdf' : api.getDocumentFileUrl(srcDocId);
                      setPdfUrl(url, d, srcDocId);
                      setViewMode('read');
                    }}
                  >
                    {d}
                  </button>
                ))}
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
};

// ─── 结构图（XMind 风格脑图：中心主题 + 放射曲线分支）────────────────────────────────
const StructureMapView = ({ notes, sections = [], docName = '', onSelectNote }) => {
  const secMap = React.useMemo(() => {
    const m = assignNotesToSections(notes, sections);
    if (!sections?.length && notes.length > 0) m[0] = notes;
    return m;
  }, [notes, sections]);
  const sectionList = sections?.length ? sections.map((s, idx) => ({ ...s, idx })) : [{ title: '未分章节', idx: 0 }];

  const containerRef = useRef(null);
  const [dims, setDims] = useState({ w: 600, h: 400 });
  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver(([e]) => setDims({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  if (notes.length === 0 && !sections?.length) {
    return (
      <div className="flex-1 flex items-center justify-center text-slate-400 flex-col gap-2 p-6">
        <GitBranch size={32} className="opacity-40" />
        <p className="text-xs font-sans">暂无结构图数据</p>
        <p className="text-[10px]">解析文档并生成笔记后自动构建脑图</p>
      </div>
    );
  }

  const contentW = Math.max(dims.w, 580);
  const contentH = Math.max(dims.h, sectionList.length * 60 + 160);
  const cx = 140;
  const cy = contentH / 2;
  const branchStartX = 200;
  const branchGap = Math.max(60, (contentH - 120) / Math.max(1, sectionList.length));
  const sectionY = (i) => 80 + i * branchGap;
  const sectionX = 320;
  const noteX = 460;
  const noteGap = 28;

  return (
    <div ref={containerRef} className="flex-1 min-h-0 overflow-hidden relative bg-gradient-to-br from-slate-50 to-white flex items-center justify-center">
      <svg width="100%" height="100%" viewBox={`0 0 ${contentW} ${contentH}`} preserveAspectRatio="xMidYMid meet" className="block max-w-full max-h-full">
        <defs>
          <marker id="arrow-mind" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6 Z" fill="currentColor" opacity="0.4" /></marker>
          <filter id="shadow-mind"><feDropShadow dx="0" dy="1" stdDeviation="2" floodOpacity="0.15" /></filter>
        </defs>
        {/* 固定曲线连接：中心 → 各主分支（思维导图式明显线型） */}
        {sectionList.map((_, i) => {
          const sy = sectionY(i);
          const mx = (cx + branchStartX + sectionX) / 2;
          return (
            <path
              key={`line-${i}`}
              d={`M ${cx + 55} ${cy} C ${mx} ${cy}, ${branchStartX + 40} ${sy}, ${sectionX - 20} ${sy}`}
              fill="none"
              stroke="#94a3b8"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          );
        })}
        {/* 中心主题（圆角矩形） */}
        <g filter="url(#shadow-mind)">
          <rect x={cx} y={cy - 28} width={110} height={56} rx={12} ry={12} className="fill-blue-500 stroke-blue-600" strokeWidth="1.5" />
          <text x={cx + 55} y={cy + 5} textAnchor="middle" className="fill-white font-sans text-sm font-semibold" style={{ fontSize: 13 }}>{docName ? (docName.length > 10 ? docName.slice(0, 10) + '…' : docName) : '文档'}</text>
        </g>
        {/* 主分支节点（章节） */}
        {sectionList.map((sec, idx) => {
          const sy = sectionY(idx);
          const secNotes = secMap[idx] || secMap[sec.idx] || [];
          return (
            <g key={`sec-${idx}`}>
              <rect x={sectionX - 70} y={sy - 16} width={140} height={32} rx={8} ry={8} className="fill-emerald-500/90 stroke-emerald-600" strokeWidth="1" filter="url(#shadow-mind)" />
              <text x={sectionX} y={sy + 4} textAnchor="middle" className="fill-white font-sans font-medium" style={{ fontSize: 11 }}>{sec.title ? (sec.title.length > 14 ? sec.title.slice(0, 14) + '…' : sec.title) : '未命名'}</text>
              {/* 子分支线：章节 → 笔记 */}
              {secNotes.slice(0, 6).map((n, j) => {
                const ny = sy + 40 + j * noteGap;
                return (
                  <g key={n.id} onClick={() => onSelectNote?.(n)} style={{ cursor: 'pointer' }} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && onSelectNote?.(n)}>
                    <line x1={sectionX + 70} y1={sy} x2={noteX - 60} y2={ny} stroke="#94a3b8" strokeWidth="1.5" strokeLinecap="round" />
                    <rect x={noteX - 75} y={ny - 12} width={150} height={24} rx={6} ry={6} className="fill-amber-100 stroke-amber-300 hover:fill-amber-200" strokeWidth="1" />
                    <text x={noteX} y={ny + 4} textAnchor="middle" style={{ fontSize: 10 }} className="fill-amber-900 font-sans pointer-events-none">{ (n.content || n.axiom || '无内容').slice(0, 16) }{ (n.content || n.axiom || '').length > 16 ? '…' : '' }</text>
                  </g>
                );
              })}
              {secNotes.length > 6 && (
                <text x={noteX} y={sy + 40 + 6 * noteGap} textAnchor="middle" style={{ fontSize: 9 }} className="fill-slate-400">+{secNotes.length - 6}</text>
              )}
            </g>
          );
        })}
      </svg>
      {/* 可点击的笔记用 HTML 覆盖以支持 hover/点击（SVG 内已有点击） */}
    </div>
  );
};

// ─── ArXiv 检索面板 ────────────────────────────────────────────────────────────
const ArxivPanel = () => {
  const { arxivResults, setArxivResults, arxivQuery, setArxivQuery, setPdfFile, setPdfUrl, addToLibrary } = useStore();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const doSearch = async () => {
    if (!arxivQuery.trim()) return;
    setLoading(true);
    setError('');
    try {
      const data = await api.searchArxiv(arxivQuery, 8);
      setArxivResults(data.papers ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const handleDownload = (paper) => {
    const url = api.getArxivPdfUrl(paper.arxiv_id);
    addToLibrary({
       id: `arxiv_${paper.arxiv_id}`,
       name: paper.title,
       addedAt: new Date().toISOString(),
       source: 'arxiv',
       arxivId: paper.arxiv_id,
       noteCount: 0
    });
    setPdfUrl(url, paper.title);
  };

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* 搜索框 */}
      <div className="p-3 border-b border-gray-200 flex gap-2">
        <input
          value={arxivQuery}
          onChange={(e) => setArxivQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && doSearch()}
          placeholder="检索 ArXiv 论文..."
          className="flex-1 border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
        />
        <button
          onClick={doSearch}
          disabled={loading}
          className="px-3 py-1.5 bg-blue-600 text-white rounded text-sm hover:bg-blue-700 disabled:opacity-50 flex items-center gap-1"
        >
          {loading ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
          搜索
        </button>
      </div>

      {error && (
        <div className="mx-3 mt-2 p-2 bg-red-50 border border-red-200 rounded text-xs text-red-600 flex items-center gap-2">
          <AlertCircle size={12} />
          {error}
        </div>
      )}

      {/* 结果列表 */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3 custom-scrollbar">
        {arxivResults.length === 0 && !loading && (
          <div className="text-center text-gray-400 text-xs mt-10">
            <FileSearch size={28} className="mx-auto mb-2 opacity-30" />
            <p>输入关键词检索 ArXiv 论文</p>
          </div>
        )}
        {arxivResults.map((paper) => (
          <div key={paper.arxiv_id} className="bg-white border border-gray-200 rounded p-3 shadow-sm hover:shadow-md transition-shadow">
            <h3 className="text-sm font-bold text-gray-900 leading-tight mb-1 line-clamp-2">{paper.title}</h3>
            <p className="text-[10px] text-gray-500 mb-1">{paper.authors.slice(0, 3).join(', ')}{paper.authors.length > 3 ? ' et al.' : ''}</p>
            <p className="text-[11px] text-gray-400 mb-2">{paper.published} · {paper.categories.slice(0, 2).join(', ')}</p>
            <p className="text-xs text-gray-600 line-clamp-3 mb-2">{paper.abstract}</p>
            <div className="flex gap-2">
              <button
                onClick={() => handleDownload(paper)}
                className="flex items-center gap-1 text-[10px] bg-green-50 border border-green-300 text-green-700 px-2 py-1 rounded hover:bg-green-100"
              >
                <Download size={10} /> 阅览并加入库
              </button>
              <a
                href={`https://arxiv.org/abs/${paper.arxiv_id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-[10px] bg-gray-50 border border-gray-300 text-gray-600 px-2 py-1 rounded hover:bg-gray-100"
              >
                <ExternalLink size={10} /> ArXiv
              </a>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

/** 含中日韩等则视为需先英文化再查 arXiv */
const CJK_RE = /[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/;

/** 将中文关键词/目标译为英文，便于 arXiv API 命中 */
async function prepareSecretaryKeywords(keyword, researchGoal) {
  let kw = keyword.trim();
  let goal = (researchGoal || '').trim();
  let hint = '';
  if (!kw) return { kw, goal, hint };

  const tryTranslateLine = async (text, instruction) => {
    try {
      const resp = await api.translateText(`${instruction}\n\n${text}`, 'en');
      const raw = (resp.translation || '').replace(/\n/g, ' ').trim();
      const line = raw.split(/[。.;；\n]/)[0].replace(/^["'「」]|["'」]$/g, '').trim();
      return line.length >= 2 ? line : null;
    } catch {
      return null;
    }
  };

  if (CJK_RE.test(kw)) {
    const en = await tryTranslateLine(
      kw,
      '请只输出一行英文：用于 arXiv 检索的 3–10 个英文关键词或短语，用空格连接；不要引号、不要解释。'
    );
    if (en) {
      kw = en;
      hint = '已将中文关键词自动转为英文检索词';
    }
  }
  if (goal && CJK_RE.test(goal)) {
    const enG = await tryTranslateLine(
      goal,
      '将下列研究目标译为英文（一段学术英文，用于摘要相关性过滤）：'
    );
    if (enG) goal = enG;
  }
  return { kw, goal, hint };
}

// ─── ArXiv 学术秘书 · 收件箱（LLM 预读过滤后的推荐）────────────────────────────
const SecretaryInboxPanel = () => {
  const { setNotes, setNotification } = useStore();
  const [keyword, setKeyword] = useState('');
  const [researchGoal, setResearchGoal] = useState('');
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(null);
  const [error, setError] = useState('');

  const loadInbox = async () => {
    try {
      const data = await api.secretaryInbox();
      setItems(Array.isArray(data.items) ? data.items : []);
      return data;
    } catch (e) {
      console.warn('加载收件箱失败', e);
      return null;
    }
  };

  useEffect(() => {
    (async () => {
      const data = await loadInbox();
      if (data?.last_keyword) setKeyword((k) => k || data.last_keyword);
      if (data?.last_research_goal) setResearchGoal((g) => g || data.last_research_goal);
    })();
  }, []);

  const runFetch = async () => {
    const k = keyword.trim();
    if (!k) return;
    setLoading(true);
    setError('');
    try {
      const { kw, goal, hint } = await prepareSecretaryKeywords(k, researchGoal);
      if (hint) setNotification(hint, 'info');
      await api.secretaryFetch(kw, goal);
      await loadInbox();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const importOne = async (itemId) => {
    setImporting(itemId);
    setError('');
    try {
      const data = await api.secretaryImport(itemId);
      const note = data?.note;
      if (note?.id) {
        const prev = useStore.getState().notes || [];
        setNotes([note, ...prev]);
      }
      await loadInbox();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setImporting(null);
    }
  };

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="p-3 border-b border-gray-200 space-y-2 bg-slate-50/80">
        <p className="text-[10px] font-semibold text-slate-600 uppercase tracking-wide">追踪关键词</p>
        <input
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          placeholder="研究方向关键词（支持中文，将自动译成英文检索）..."
          className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300"
        />
        <p className="text-[10px] font-semibold text-slate-600 uppercase tracking-wide">研究课题 / 过滤目标</p>
        <textarea
          value={researchGoal}
          onChange={(e) => setResearchGoal(e.target.value)}
          placeholder="描述你当前的研究目标，秘书将据此过滤摘要相关性…"
          rows={2}
          className="w-full border border-gray-300 rounded px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-violet-300 resize-none"
        />
        <button
          type="button"
          onClick={runFetch}
          disabled={loading || !keyword.trim()}
          className="w-full flex items-center justify-center gap-2 py-2 rounded-lg bg-violet-600 text-white text-sm font-medium hover:bg-violet-700 disabled:opacity-50"
        >
          {loading ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
          拉取最新 arXiv 并 AI 预读
        </button>
        <p className="text-[9px] text-slate-500 leading-relaxed">
          每次拉取最多 5 篇按提交时间排序的最新论文，经 LLM 过滤后写入本收件箱；可一键纳入本地原子笔记。
        </p>
      </div>
      {error && (
        <div className="mx-3 mt-2 p-2 bg-red-50 border border-red-200 rounded text-xs text-red-600 flex items-center gap-2">
          <AlertCircle size={12} />
          {error}
        </div>
      )}
      <div className="flex-1 overflow-y-auto p-3 space-y-3 custom-scrollbar">
        {items.length === 0 && !loading && (
          <div className="text-center text-gray-400 text-xs mt-10">
            <Inbox size={28} className="mx-auto mb-2 opacity-30" />
            <p>暂无推荐。设置关键词后点击上方拉取。</p>
          </div>
        )}
        {items.map((it) => (
          <div
            key={it.id || it.arxiv_id}
            className="bg-white border border-violet-200 rounded-lg p-3 shadow-sm space-y-2"
          >
            <div className="flex items-start justify-between gap-2">
              <h3 className="text-sm font-bold text-slate-900 leading-snug line-clamp-3">{it.title}</h3>
              <span className="text-[9px] shrink-0 px-1.5 py-0.5 rounded bg-violet-100 text-violet-800 border border-violet-200">
                {it.type === 'arxiv_recommendation' ? '秘书推荐' : '推荐'}
              </span>
            </div>
            <p className="text-[10px] text-slate-500">{it.published} · {it.arxiv_id}</p>
            <div className="text-[11px] space-y-1">
              <p>
                <span className="font-semibold text-blue-800">Method：</span>
                <span className="text-slate-700">{it.method || '—'}</span>
              </p>
              <p>
                <span className="font-semibold text-emerald-800">Boundary：</span>
                <span className="text-slate-700">{it.boundary || '—'}</span>
              </p>
            </div>
            <div className="flex flex-wrap gap-2 pt-1">
              <a
                href={it.abs_url || `https://arxiv.org/abs/${it.arxiv_id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-[10px] bg-slate-100 border border-slate-300 text-slate-700 px-2 py-1 rounded hover:bg-slate-200"
              >
                <ExternalLink size={10} /> 原文 arXiv
              </a>
              <button
                type="button"
                disabled={importing === it.id}
                onClick={() => importOne(it.id)}
                className="inline-flex items-center gap-1 text-[10px] bg-emerald-600 text-white px-2 py-1 rounded hover:bg-emerald-700 disabled:opacity-50"
              >
                {importing === it.id ? <Loader2 size={10} className="animate-spin" /> : <Plus size={10} />}
                纳入我的知识库
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

const _normalizeBbox = (bbox) => {
  if (Array.isArray(bbox) && bbox.length === 4) return bbox;
  if (bbox && typeof bbox === 'object') {
    const arr = [bbox.x, bbox.y, bbox.width, bbox.height];
    if (arr.every((v) => Number.isFinite(v))) return arr;
  }
  return [0, 0, 0, 0];
};

const jumpToKnowledgeSource = async (src, nav) => {
  if (!src) return;
  const isExternal = src.source === 'arxiv' || src.source === 'semantic_scholar';
  if (isExternal && src.url) {
    window.open(src.url, '_blank', 'noopener');
    return;
  }

  const page = Math.max(1, Number(src.page_num || src.page || 1));
  const bbox = _normalizeBbox(src.bbox);
  const nextDocId = (src.doc_id || '').trim();

  nav.setViewMode?.('read');

  if (nextDocId && nextDocId !== (nav.activeDocId || '')) {
    const title = src.doc_title || nextDocId;
    nav.setPdfUrl?.(api.getDocumentFileUrl(nextDocId), title, nextDocId);
  }

  nav.setCurrentPage?.(page);
  nav.setActiveReference?.({ page, bbox });
};

const renderInlineHighlight = (text, query) => {
  const q = (query || '').trim();
  if (!q) return text;
  const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const parts = String(text || '').split(new RegExp(`(${escaped})`, 'ig'));
  return parts.map((p, idx) => (
    idx % 2 === 1
      ? <mark key={`${p}-${idx}`} className="bg-yellow-200 px-0.5 rounded">{p}</mark>
      : <span key={`${p}-${idx}`}>{p}</span>
  ));
};

// ─── 聊天消息 ──────────────────────────────────────────────────────────────────

// 将内容中的 [1] [2] 等引用替换为可点击按钮，其余用 Markdown+Math 渲染
const renderCitedContent = (content, sources, onJumpSource) => {
  if (!content) return null;
  const normalized = String(content).replace(/【\s*(\d+)\s*】/g, '[$1]');
  const parts = normalized.split(/(\[\d+\])/g);
  return parts.map((part, i) => {
    const m = part.match(/^\[(\d+)\]$/);
    if (m) {
      const idx = parseInt(m[1], 10) - 1;
      const src = sources?.[idx];
      if (!src) return <sup key={i} className="text-blue-500">{part}</sup>;
      const isExternal = src.source === 'arxiv' || src.source === 'semantic_scholar';
      return (
        <sup
          key={i}
          onClick={() => onJumpSource?.(src)}
          className="inline-flex items-center justify-center min-w-[16px] h-4 px-1 mx-0.5 text-[9px] font-bold bg-blue-100 text-blue-700 rounded cursor-pointer hover:bg-blue-200 transition-colors"
          title={src.concept || src.summary?.substring(0, 60)}
        >
          {part}
        </sup>
      );
    }
    if (!part.trim()) return <span key={i}>{part}</span>;
    /* 使用块级容器，避免 <p> 包裹 table / 列表等非法嵌套导致表格不显示 */
    return (
      <div key={i} className="cited-md-part [&_.katex]:text-sm [&_.katex-display]:my-2">
        <MarkdownRenderer>{part}</MarkdownRenderer>
      </div>
    );
  });
};

const ChatMessage = ({ msg }) => {
  const isUser = msg.role === 'user';
  const { setActiveReference, setViewMode, setPdfUrl, setCurrentPage, activeDocId } = useStore();
  const [feedback, setFeedback] = useState(0);
  const [feedbackLoading, setFeedbackLoading] = useState(false);
  const agentMeta = {
    router:     { label: 'ROUTER', color: 'bg-indigo-100 text-indigo-800', icon: <Waypoints size={16} /> },
    seeker:     { label: 'SEEKER', color: 'bg-cyan-100 text-cyan-800', icon: <Search size={16} /> },
    reviewer:   { label: 'REVIEWER', color: 'bg-rose-100 text-rose-800', icon: <Bot size={16} /> },
    synthesizer:{ label: 'SYNTHESIZER', color: 'bg-purple-100 text-purple-800', icon: <Brain size={16} /> },
    writer:     { label: 'WRITER', color: 'bg-amber-100 text-amber-900', icon: <FileText size={16} /> },
    system:     { label: 'SYSTEM', color: 'bg-gray-200 text-gray-700', icon: <Sparkles size={16} /> },
  };
  const meta = agentMeta[msg.agentType] ?? agentMeta.system;

  const submitFeedback = async (rating) => {
    if (isUser || feedbackLoading) return;
    let comment = '';
    if (rating < 0) {
      const v = window.prompt('可选：简单描述问题（如 幻觉/啰嗦/不相关）', '');
      if (v == null) return;
      comment = v.trim();
    }
    setFeedbackLoading(true);
    try {
      await api.submitChatFeedback({
        message_id: String(msg.id),
        session_id: SESSION_ID,
        rating,
        user_comment: comment,
        answer_text: typeof msg.content === 'string' ? msg.content : '',
        retrieved_contexts: Array.isArray(msg.relatedNotes) ? msg.relatedNotes : [],
      });
      setFeedback(rating);
    } catch (e) {
      console.warn('反馈提交失败:', e);
    } finally {
      setFeedbackLoading(false);
    }
  };

  const onJumpSource = useCallback((src) => {
    jumpToKnowledgeSource(src, {
      setViewMode,
      setPdfUrl,
      setCurrentPage,
      setActiveReference,
      activeDocId,
    });
  }, [setViewMode, setPdfUrl, setCurrentPage, setActiveReference, activeDocId]);

  return (
    <div className={clsx('flex gap-2 mb-4 w-full', isUser ? 'flex-row-reverse' : 'flex-row')}>
      <div className={clsx('w-9 h-9 flex shrink-0 items-center justify-center border-2 border-black shadow-[2px_2px_0px_#000] bg-white overflow-hidden',
        isUser ? 'bg-gray-900 text-white' : meta.color)}>
        {isUser ? <User size={16} /> : meta.icon}
      </div>
      <div className={clsx('relative p-3 max-w-[85%] text-xs border-2 border-black shadow-[3px_3px_0px_rgba(0,0,0,0.1)]',
        isUser
          ? 'bg-gray-900 text-white rounded-tr-none rounded-bl-xl rounded-tl-xl rounded-br-xl'
          : 'bg-white text-gray-800 rounded-tl-none rounded-tr-xl rounded-br-xl rounded-bl-xl',
        !isUser && msg.projectReminder && 'ring-2 ring-red-500/80 bg-rose-50/90')}>
        {!isUser && (
          <div className="text-[9px] font-sans mb-1.5 opacity-70 uppercase tracking-wider border-b border-current pb-1 inline-block">
            {meta.label}_BOT
          </div>
        )}
        {msg.agentTrace && <AgentTraceThoughtChain agentTrace={msg.agentTrace} />}
        {!isUser ? (
          <div className="leading-relaxed break-words text-gray-800 chat-synth-md">
            {renderCitedContent(
              typeof msg.content === 'string' ? msg.content : String(msg.content ?? ''),
              msg.relatedNotes || [],
              onJumpSource
            )}
          </div>
        ) : (
          <p className="leading-relaxed whitespace-pre-wrap">{msg.content}</p>
        )}
        {/* 参考文献卡片（synthesizer 消息末尾） */}
        {msg.agentType === 'synthesizer' && msg.relatedNotes?.length > 0 && (
          <div className="mt-3 pt-2 border-t border-gray-200">
            <p className="text-[9px] font-sans text-gray-500 mb-1.5 uppercase">参考来源</p>
            <div className="space-y-1.5">
              {msg.relatedNotes.map((n, idx) => {
                const isExternal = n.source === 'arxiv' || n.source === 'semantic_scholar';
                const hasPage = n.page_num && n.page_num > 0;
                return (
                  <div
                    key={n.note_id ?? idx}
                    onClick={() => {
                      if (!isExternal && !hasPage) return;
                      onJumpSource(n);
                    }}
                    className={clsx(
                      'flex items-start gap-2 p-2 rounded border cursor-pointer transition-colors',
                      isExternal ? 'bg-blue-50/50 border-blue-200 hover:bg-blue-100' : 'bg-gray-50 border-gray-200 hover:bg-gray-100'
                    )}
                  >
                    <span className="text-[9px] font-bold text-blue-600 shrink-0 mt-0.5">[{idx + 1}]</span>
                    <div className="min-w-0">
                      <p className="text-[10px] font-semibold text-gray-800 line-clamp-1">{n.concept || n.doc_title || '未知来源'}</p>
                      <p className="text-[9px] text-gray-500 line-clamp-1 mt-0.5">{n.summary?.substring(0, 80)}</p>
                      <span className="text-[8px] text-gray-400">
                        {isExternal ? `${n.source} ↗` : (hasPage ? `p.${n.page_num}` : '')}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
        {/* 非 synthesizer 的简单引用按钮 */}
        {msg.agentType !== 'synthesizer' && msg.relatedNotes?.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5 pt-1.5 border-t border-dashed border-gray-300">
            {msg.relatedNotes.map((n) => {
              const isExternal = n.source === 'arxiv' || n.source === 'semantic_scholar';
              const hasPage = n.page_num && n.page_num > 0;
              return (
                <button
                  key={n.note_id ?? n}
                  onClick={() => {
                    if (!isExternal && !hasPage) return;
                    onJumpSource(n);
                  }}
                  className={clsx(
                    'text-[9px] border px-1.5 py-0.5 flex items-center gap-1 cursor-pointer',
                    isExternal
                      ? 'bg-blue-50 border-blue-300 text-blue-700 hover:bg-blue-100'
                      : 'bg-yellow-50 border-yellow-300 text-yellow-800 hover:bg-yellow-100'
                  )}
                  title={isExternal ? n.url : (hasPage ? `跳转到 p.${n.page_num}` : n.summary?.substring(0, 60))}
                >
                  <BookOpen size={8} />
                  {n.concept ?? n}
                  {isExternal ? ' ↗' : (hasPage ? ` · p.${n.page_num}` : '')}
                </button>
              );
            })}
          </div>
        )}
        {!isUser && (
          <div className="mt-2 pt-1.5 border-t border-dashed border-gray-200 flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => submitFeedback(1)}
              disabled={feedbackLoading}
              className={clsx(
                'h-8 min-w-8 px-2 rounded border text-[10px] flex items-center gap-1',
                feedback === 1 ? 'bg-emerald-50 border-emerald-300 text-emerald-700' : 'bg-white border-gray-200 text-gray-500 hover:bg-gray-50'
              )}
              title="赞同"
            >
              <ThumbsUp size={12} /> 赞同
            </button>
            <button
              type="button"
              onClick={() => submitFeedback(-1)}
              disabled={feedbackLoading}
              className={clsx(
                'h-8 min-w-8 px-2 rounded border text-[10px] flex items-center gap-1',
                feedback === -1 ? 'bg-rose-50 border-rose-300 text-rose-700' : 'bg-white border-gray-200 text-gray-500 hover:bg-gray-50'
              )}
              title="踩（幻觉/啰嗦）"
            >
              <ThumbsDown size={12} /> 踩
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

// ─── 聊天面板 ──────────────────────────────────────────────────────────────────
const ChatPanel = () => {
  const { messages, addMessage, updateLastMessage, isAgentThinking, setAgentThinking, notes, clearMessages, pendingChatQuestion, setPendingChatQuestion } = useStore();
  const [input, setInput] = useState('');
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isAgentThinking]);

  useEffect(() => {
    if (pendingChatQuestion) {
      setInput(pendingChatQuestion);
      setPendingChatQuestion(null);
    }
  }, [pendingChatQuestion, setPendingChatQuestion]);

  const sendMessage = async () => {
    const text = input.trim();
    if (!text || isAgentThinking) return;
    setInput('');

    addMessage({ id: Date.now(), role: 'user', content: text });
    setAgentThinking(true);

    // 用于 synthesizer 流式拼接
    let synthId = null;
    let synthContent = '';

    try {
      await api.chatStream(text, ({ type, data }) => {
        if (type === 'step') {
          if (data.streaming) {
            // synthesizer 开始流式输出，先创建空消息
            synthId = Date.now() + Math.random() * 100000;
            synthContent = '';
            addMessage({
              id: synthId,
              role: 'agent',
              agentType: data.agent || 'synthesizer',
              content: '',
              relatedNotes: [],
            });
          } else {
            addMessage({
              id: Date.now() + Math.random() * 100000,
              role: 'agent',
              agentType: data.agent || 'system',
              content: data.score != null
                ? `${data.content}\n📊 评分: ${data.score}/10`
                : data.content,
              relatedNotes: data.related_notes?.slice(0, 8) ?? [],
            });
          }
        } else if (type === 'delta' && synthId != null) {
          synthContent += data.token || '';
          updateLastMessage({ content: synthContent });
        } else if (type === 'done') {
          const sources = data.sources ?? [];
          const patch = {
            agentTrace: {
              traces: data.agent_traces ?? [],
              retrievedCards: data.retrieved_cards ?? [],
              elapsedMs: data.elapsed_ms ?? null,
            },
          };
          if (sources.length > 0) {
            patch.relatedNotes = sources.slice(0, 10);
          }
          updateLastMessage(patch);
        }
      });
    } catch (e) {
      // 降级：直接调用搜索接口
      try {
        addMessage({ id: Date.now() + 1, role: 'agent', agentType: 'seeker', content: `正在检索知识库中与「${text}」相关的原子卡片…` });

        const data = await api.searchNotes(text, 5);
        const results = data.results ?? [];

        const seekerReply = results.length > 0 && !data.is_mock
          ? `发现 ${results.length} 个相关知识原子：\n${results.map((r, i) => `${i + 1}. [${r.concept}] (p.${r.page_num}) — ${r.summary?.substring(0, 80)}`).join('\n')}`
          : '知识库当前为空或尚未建立。请先上传 PDF → 选中文字 → CRUSH IT 生成原子卡片。';

        addMessage({
          id: Date.now() + 2,
          role: 'agent',
          agentType: 'seeker',
          content: seekerReply,
          relatedNotes: results.slice(0, 3),
        });
      } catch (e2) {
        addMessage({
          id: Date.now() + 4,
          role: 'agent',
          agentType: 'system',
          content: `⚠️ 检索遇到问题: ${e2 instanceof Error ? e2.message : String(e2)}`,
        });
      }
    } finally {
      setAgentThinking(false);
    }
  };

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* 迷你知识树/图谱（chat 模式下顶部显示） */}
      {notes.length > 0 && (
        <div className="border-b border-gray-200 bg-gray-50 max-h-[120px] overflow-y-auto p-2">
          <div className="flex items-center gap-1 mb-1">
            <Network size={10} className="text-purple-500" />
            <span className="text-[9px] font-sans text-purple-600">知识库 · {notes.length} 卡片</span>
          </div>
          <div className="flex flex-wrap gap-1">
            {notes.slice(0, 12).map(n => (
              <span key={n.id} className="text-[9px] px-1.5 py-0.5 bg-white border border-gray-200 rounded text-gray-600 truncate max-w-[120px]">
                [{n.type}] {n.content?.substring(0, 20)}
              </span>
            ))}
            {notes.length > 12 && <span className="text-[9px] text-gray-400">+{notes.length - 12} more</span>}
          </div>
        </div>
      )}
      <div className="flex-1 overflow-y-auto p-4 custom-scrollbar min-h-0">
        {messages.map((msg) => <ChatMessage key={msg.id} msg={msg} />)}
        {isAgentThinking && (
          <div className="flex gap-2 mb-4">
            <div className="w-9 h-9 bg-blue-100 border-2 border-black flex items-center justify-center">
              <Loader2 size={16} className="animate-spin text-blue-600" />
            </div>
            <div className="bg-white border-2 border-black p-3 rounded-tr-xl rounded-br-xl rounded-bl-xl shadow-[3px_3px_0px_rgba(0,0,0,0.1)]">
              <div className="flex gap-1">
                {[0, 1, 2].map((i) => (
                  <span key={i} className="w-2 h-2 bg-blue-400 rounded-full animate-bounce" style={{ animationDelay: `${i * 0.15}s` }} />
                ))}
              </div>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="p-3 border-t border-gray-200 flex gap-2 shrink-0"><button onClick={clearMessages} title="清空对话" className="px-2 py-2 bg-gray-100 text-gray-500 rounded hover:bg-red-50 hover:text-red-500 flex items-center justify-center transition-colors"><Trash2 size={16} /></button>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && sendMessage()}
          placeholder="向知识库提问（支持 AgenticRAG 检索 + 自我评估）..."
          className="flex-1 border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
          disabled={isAgentThinking}
        />
        <button
          onClick={sendMessage}
          disabled={isAgentThinking || !input.trim()}
          className="px-3 py-2 bg-gray-900 text-white rounded hover:bg-gray-700 disabled:opacity-50 flex items-center gap-1 text-sm"
        >
          <Send size={14} />
        </button>
      </div>
    </div>
  );
};

// ─── 知识树组件（文档 → 章节 → 笔记 + 类型分组）──────────────────────────────
const KnowledgeTree = ({ notes, sections = [], docName = '' }) => {
  const { setActiveReference } = useStore();
  const [collapsed, setCollapsed] = useState({});
  const toggle = (key) => setCollapsed(p => ({ ...p, [key]: !p[key] }));

  const typeLabels = { method: '方法', formula: '公式', idea: '观点', definition: '定义', data: '数据', other: '其他' };
  const typeColors = { method: 'text-cyan-600', formula: 'text-purple-600', idea: 'text-amber-600', definition: 'text-green-600', data: 'text-rose-600', other: 'text-gray-500' };

  const secMap = React.useMemo(() => assignNotesToSections(notes, sections), [notes, sections]);

  if (notes.length === 0 && sections.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-400 flex-col gap-2 p-4">
        <Layers size={24} className="opacity-30" />
        <p className="text-[10px] font-sans">知识树为空</p>
        <p className="text-[10px] text-gray-400">上传 PDF 解析后自动构建章节树</p>
      </div>
    );
  }

  const renderNote = (note) => (
    <div
      key={note.id}
      onClick={() => note.page && setActiveReference({ page: note.page, bbox: note.bbox || [0,0,0,0] })}
      className="flex items-start gap-2 py-1 px-2 rounded hover:bg-blue-50 cursor-pointer group transition-colors"
    >
      <span className={`text-[9px] font-bold shrink-0 mt-0.5 ${typeColors[note.type] || 'text-gray-500'}`}>
        [{typeLabels[note.type] || note.type || '?'}]
      </span>
      <div className="min-w-0">
        <p className="text-gray-700 line-clamp-2 group-hover:text-blue-700 transition-colors text-[11px]">{note.content?.substring(0, 60)}{note.content?.length > 60 ? '…' : ''}</p>
        {note.page && <span className="text-[9px] text-gray-400">p.{note.page}</span>}
      </div>
    </div>
  );

  return (
    <div className="flex-1 overflow-y-auto p-3 text-xs custom-scrollbar">
      {/* 文档根节点 */}
      <div className="flex items-center gap-2 mb-3 pb-2 border-b border-gray-200">
        <BookOpen size={14} className="text-blue-600" />
        <span className="font-bold text-gray-800 truncate">{docName || '未命名文档'}</span>
        <span className="text-gray-400 ml-auto">{notes.length} 卡片 · {sections.length} 章节</span>
      </div>

      {sections.length > 0 ? (
        /* ── 章节层级 ─────────────────────────────────────────── */
        sections.map((sec, idx) => {
          const key = `sec_${idx}`;
          const secNotes = secMap[idx] || [];
          const isOpen = !collapsed[key];
          return (
            <div key={key} className="mb-2">
              <div
                onClick={() => toggle(key)}
                className="flex items-center gap-1.5 cursor-pointer hover:bg-green-50 rounded px-1 py-1 transition-colors"
              >
                <span className={`text-[10px] transition-transform ${isOpen ? 'rotate-90' : ''}`}>▶</span>
                <div className="w-2 h-2 bg-emerald-500 rounded-sm shrink-0" />
                <span className="font-bold text-[10px] text-emerald-700 truncate">{sec.title}</span>
                <span className="text-[9px] text-gray-400 ml-auto shrink-0">{secNotes.length}</span>
              </div>
              {isOpen && (
                <div className="ml-5 border-l border-emerald-200 pl-3 mt-1 space-y-1">
                  {sec.summary && (
                    <p className="text-[9px] text-gray-400 italic line-clamp-2 mb-1">{sec.summary}</p>
                  )}
                  {secNotes.length > 0 ? secNotes.map(renderNote) : (
                    <p className="text-[9px] text-gray-300 py-1">暂无笔记</p>
                  )}
                </div>
              )}
            </div>
          );
        })
      ) : (
        /* ── 无章节：按类型分组（回退） ───────────────────────── */
        (() => {
          const typeGroups = {};
          notes.forEach(n => { const t = n.type || 'other'; (typeGroups[t] ??= []).push(n); });
          return Object.entries(typeGroups).map(([type, groupNotes]) => (
            <div key={type} className="mb-3">
              <div className="flex items-center gap-1.5 mb-1.5">
                <div className={`w-2 h-2 rounded-full ${typeColors[type]?.replace('text-', 'bg-') || 'bg-gray-400'}`} />
                <span className={`font-bold uppercase text-[10px] ${typeColors[type] || 'text-gray-500'}`}>
                  {typeLabels[type] || type} ({groupNotes.length})
                </span>
              </div>
              <div className="ml-4 border-l border-gray-200 pl-3 space-y-1.5">
                {groupNotes.map(renderNote)}
              </div>
            </div>
          ));
        })()
      )}
    </div>
  );
};

// ─── 自动推荐卡片 ──────────────────────────────────────────────────────────────
const RecommendedCards = ({ notes }) => {
  const { markdownContent } = useStore();

  // 基于编辑器内容简单匹配推荐
  const recommended = React.useMemo(() => {
    if (!markdownContent || notes.length === 0) return notes.slice(0, 3);
    const words = markdownContent.toLowerCase().split(/\s+/).filter(w => w.length > 2);
    const scored = notes.map(n => {
      const content = (n.content || '').toLowerCase();
      const score = words.filter(w => content.includes(w)).length;
      return { ...n, _score: score };
    });
    scored.sort((a, b) => b._score - a._score);
    return scored.slice(0, 5);
  }, [notes, markdownContent]);

  if (recommended.length === 0) return null;

  return (
    <div className="p-3 border-t border-gray-200 bg-amber-50/50">
      <p className="text-[10px] font-sans text-amber-700 mb-2 flex items-center gap-1">
        <Sparkles size={10} /> 推荐原子卡片
      </p>
      <div className="space-y-2">
        {recommended.map(n => (
          <div key={n.id} className="bg-white border border-amber-200 rounded p-2 text-[11px] text-gray-600 line-clamp-2 hover:border-amber-400 transition-colors cursor-pointer"
            onClick={() => useStore.getState().setActiveReference({ page: n.page ?? 1, bbox: n.bbox ?? [0,0,0,0] })}>
            <span className="text-[9px] font-bold text-amber-700 uppercase mr-1">[{n.type}]</span>
            {n.content?.substring(0, 80)}
          </div>
        ))}
      </div>
    </div>
  );
};

const NEXUS_ORGANIZE_TAB_IDS = ['deck', 'atomic', 'tree', 'graph', 'graphrag', 'map', 'inbox', 'arxiv'];

// ─── 原子卡片面板（带 API 查询） ────────────────────────────────────────────────
const NexusPanel = () => {
  const DEMO_DOC_ID = 'global_demo_official';
  const {
    notes, removeNote, setNotes,
    searchQuery, setSearchQuery,
    searchStatus, setSearchStatus,
    searchResults, setSearchResults,
    parsedSections, pdfFileName,
    activeDocId,
    noteLinks,
    setParsedSections, setParsedMarkdown, setNotification,
    setViewMode, setStartDemoLoad,
    setPdfUrl, setCurrentPage, setActiveReference,
    pendingOrganizeTab, setPendingOrganizeTab,
  } = useStore();
  const [demoLoading, setDemoLoading] = useState(false);
  const [searchPanelOpen, setSearchPanelOpen] = useState(false);
  const searchDebounceRef = useRef(null);
  const searchFlowTimerRef = useRef([]);

  const [activeTab, setActiveTab] = useState('deck'); // 'deck' | 'tree' | 'map' | 'graph' | 'arxiv' | 'chat'
  const [graphScope, setGraphScope] = useState('global'); // global | current
  const [selectedNote, setSelectedNote] = useState(null); // 脑图/树点击的笔记，用于展示公理/方法/边界
  const [showDistillModal, setShowDistillModal] = useState(false);
  const [distillText, setDistillText] = useState('');
  const [distilling, setDistilling] = useState(false);

  useEffect(() => {
    if (!pendingOrganizeTab) return;
    if (NEXUS_ORGANIZE_TAB_IDS.includes(pendingOrganizeTab)) {
      setActiveTab(pendingOrganizeTab);
    }
    setPendingOrganizeTab(null);
  }, [pendingOrganizeTab, setPendingOrganizeTab]);

  // 进入整理视图时以服务端为准同步笔记，避免旧会话/幽灵卡片残留
  useEffect(() => {
    api.getNotes()
      .then((data) => {
        const list = Array.isArray(data.notes) ? data.notes : [];
        // #region agent log
        fetch('http://127.0.0.1:7911/ingest/d425475d-29d6-4d24-8a29-340d5c8049ce', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '1d3683' },
          body: JSON.stringify({
            sessionId: '1d3683',
            runId: 'post-fix',
            hypothesisId: 'H3',
            location: 'MiddleColumn.jsx:getNotes',
            message: 'notes list loaded for organize tab',
            data: {
              total: list.length,
              withScreenshot: list.filter((n) => !!n?.screenshot).length,
              withBboxArray: list.filter((n) => Array.isArray(n?.bbox) && n.bbox.length === 4).length,
              withBboxObject: list.filter((n) => n?.bbox && typeof n.bbox === 'object' && !Array.isArray(n.bbox)).length,
            },
            timestamp: Date.now(),
          }),
        }).catch(() => {});
        // #endregion
        setNotes(list);
      })
      .catch(() => {});
  }, [setNotes]);

  const clearSearchFlowTimers = useCallback(() => {
    searchFlowTimerRef.current.forEach((t) => clearTimeout(t));
    searchFlowTimerRef.current = [];
  }, []);

  const runSearch = useCallback(async (rawQ) => {
    const q = (rawQ || '').trim();
    if (!q) {
      setSearchResults([]);
      setSearchStatus('idle');
      return;
    }
    clearSearchFlowTimers();
    setSearchStatus('tokenizing');
    searchFlowTimerRef.current.push(setTimeout(() => setSearchStatus('vector'), 220));
    searchFlowTimerRef.current.push(setTimeout(() => setSearchStatus('fusion'), 520));

    try {
      const data = await api.searchNotes(q, 12);
      setSearchResults(data.results ?? []);
      setSearchStatus('done');
    } catch {
      const localResults = notes.filter((n) =>
        n.content?.toLowerCase().includes(q.toLowerCase())
      );
      setSearchResults(localResults.map((n) => ({ ...n, note_id: n.id, summary: n.content, concept: n.type, page_num: n.page })));
      setSearchStatus('done');
    }
    searchFlowTimerRef.current.push(setTimeout(() => setSearchStatus('idle'), 1800));
  }, [notes, setSearchResults, setSearchStatus, clearSearchFlowTimers]);

  useEffect(() => {
    const q = (searchQuery || '').trim();
    if (!q) {
      setSearchPanelOpen(false);
      setSearchResults([]);
      setSearchStatus('idle');
      clearSearchFlowTimers();
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
      return;
    }
    setSearchPanelOpen(true);
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = setTimeout(() => runSearch(q), 500);
    return () => {
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    };
  }, [searchQuery, runSearch, setSearchResults, setSearchStatus, clearSearchFlowTimers]);

  const handleSearchKeyDown = (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    runSearch(searchQuery);
  };

  const handleResultJump = async (item) => {
    await jumpToKnowledgeSource(item, {
      setViewMode,
      setPdfUrl,
      setCurrentPage,
      setActiveReference,
      activeDocId,
    });
    setSearchPanelOpen(false);
  };

  const handleDelete = async (id) => {
    try { await api.deleteNote(id); } catch {}
    removeNote(id);
  };

  const handleDistillUGC = async () => {
    const input = (distillText || '').trim();
    if (!input || distilling) return;
    setDistilling(true);
    try {
      const resp = await api.distillNote(input, activeDocId || '', 'ugc');
      const newNote = resp?.note;
      if (newNote?.id) {
        setNotes([newNote, ...(notes || [])]);
      }
      setShowDistillModal(false);
      setDistillText('');
      setNotification(resp?.is_mock ? '已创建碎片（当前为降级蒸馏）' : '已蒸馏并写入个人知识库');
      setActiveTab('atomic');
    } catch (e) {
      setNotification(e?.message || '蒸馏失败', 'error');
    } finally {
      setDistilling(false);
    }
  };

  const displayNotes = searchStatus === 'done' && searchResults.length > 0
    ? searchResults.map((r) => notes.find((n) => n.id === r.note_id) ?? { id: r.note_id, content: r.summary, type: 'idea', page: r.page_num, keywords: r.keywords })
    : notes;

  const scopedNotes = React.useMemo(() => {
    // 仅在 Demo 文档激活时展示 Demo 种子卡片；离开 Demo 自动隐藏该批卡片
    if ((activeDocId || '') === DEMO_DOC_ID) {
      return displayNotes.filter((n) => (n.doc_id || '') === DEMO_DOC_ID || n.source === 'demo_seed');
    }
    return displayNotes.filter((n) => (n.doc_id || '') !== DEMO_DOC_ID && n.source !== 'demo_seed');
  }, [displayNotes, activeDocId]);

  // 仅当存在公理/方法/边界三层解构时为「原子知识」；其余（含高亮、截图、未粉碎）均在原始卡片
  const isAtomicNote = (n) => !!(n.axiom || n.method || n.boundary);
  const rawDisplayNotes = scopedNotes.filter((n) => !isAtomicNote(n));
  const atomicDisplayNotes = scopedNotes.filter(isAtomicNote);

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* 搜索框 */}
      <div className="p-3 border-b border-gray-200">
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onFocus={() => setSearchPanelOpen(!!searchQuery.trim())}
            onKeyDown={handleSearchKeyDown}
            placeholder="语义检索知识库 (Enter)..."
            className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
          />
          {searchPanelOpen && searchQuery.trim() && (
            <div className="absolute left-0 right-0 top-full mt-1 z-30 bg-white border border-slate-200 rounded-lg shadow-lg max-h-80 overflow-y-auto">
              {searchResults.length === 0 ? (
                <div className="px-3 py-4 text-xs text-slate-500">未命中相关片段，试试换个关键词。</div>
              ) : (
                <div className="p-2 space-y-1.5">
                  {searchResults.map((r, idx) => {
                    const snippet = (r.summary || '').slice(0, 140) || '（无摘要）';
                    const channels = Array.isArray(r.sources) ? r.sources : [r.source].filter(Boolean);
                    const hasGraph = channels.includes('graph_1hop') || r.source === 'graph_1hop';
                    const hasVector = channels.includes('doc_vector') || channels.includes('note_vector') || r.source === 'document';
                    const hasBM25 = channels.includes('doc_bm25') || channels.includes('note_bm25') || r.source === 'doc_bm25' || r.source === 'note_bm25';
                    return (
                      <button
                        key={`${r.note_id || 'r'}-${idx}`}
                        type="button"
                        onClick={() => handleResultJump(r)}
                        className="w-full text-left p-2.5 rounded-md border border-slate-200 hover:border-blue-300 hover:bg-blue-50/40 transition-colors"
                      >
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-700">
                            {r.doc_title || r.doc_id || '未命名文档'}
                          </span>
                          {Number(r.page_num) > 0 && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200">
                              p.{r.page_num}
                            </span>
                          )}
                          {hasVector && <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200">向量命中</span>}
                          {hasGraph && <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-50 text-purple-700 border border-purple-200">图谱拓展</span>}
                          {hasBM25 && <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200">关键词命中</span>}
                        </div>
                        <div className="text-xs text-slate-700 leading-relaxed max-h-32 overflow-y-auto max-w-none chat-snippet-md">
                          <MarkdownRenderer>{r.summary || '（无摘要）'}</MarkdownRenderer>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <AnimatePresence>
        {searchStatus !== 'idle' && (
          <div className="px-3 pt-3">
            <SearchVisualizer status={searchStatus} query={searchQuery} />
          </div>
        )}
      </AnimatePresence>

      {/* 多视图：卡片 | 原子知识 | 知识树 | 图谱 | GraphRAG | 结构图 | ArXiv */}
      <div className="flex border-b border-slate-200 px-3 pt-2 gap-1 overflow-x-auto">
        {[
          { id: 'deck', label: `卡片 (${scopedNotes.length})`, icon: Layers },
          { id: 'atomic', label: `原子知识 (${atomicDisplayNotes.length})`, icon: Sparkles },
          { id: 'tree', label: '知识树', icon: ListTree },
          { id: 'graph', label: '图谱', icon: Network },
          { id: 'graphrag', label: 'GraphRAG', icon: Tag },
          { id: 'map', label: '结构图', icon: GitBranch },
          { id: 'inbox', label: '📥 发现', icon: Inbox },
          { id: 'arxiv', label: 'ArXiv', icon: FileSearch },
        ].map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setActiveTab(id)}
            className={clsx(
              'pb-2 px-2 text-xs font-medium border-b-2 transition-colors flex items-center gap-1 shrink-0',
              activeTab === id ? 'border-blue-600 text-blue-700' : 'border-transparent text-slate-500 hover:text-slate-700'
            )}
          >
            <Icon size={12} /> {label}
          </button>
        ))}
      </div>

      {/* 内容区 */}
      <div className="flex-1 overflow-hidden flex flex-col">
        {(activeTab === 'graph' || activeTab === 'graphrag') && (
          <div className="px-3 py-2 border-b border-slate-200 bg-white flex items-center gap-2 text-[11px]">
            <span className="text-slate-500">视角:</span>
            <button
              type="button"
              onClick={() => setGraphScope('global')}
              className={clsx(
                'px-2 py-1 rounded border',
                graphScope === 'global' ? 'bg-blue-50 text-blue-700 border-blue-300' : 'bg-slate-50 text-slate-600 border-slate-200'
              )}
            >
              🌐 全局知识库视角 (默认)
            </button>
            <button
              type="button"
              onClick={() => setGraphScope('current')}
              className={clsx(
                'px-2 py-1 rounded border',
                graphScope === 'current' ? 'bg-blue-50 text-blue-700 border-blue-300' : 'bg-slate-50 text-slate-600 border-slate-200'
              )}
            >
              📄 当前文献视角
            </button>
            {graphScope === 'current' && !activeDocId && (
              <span className="text-amber-600 ml-2">当前未锁定文献，将显示空结果。</span>
            )}
          </div>
        )}
        {activeTab === 'deck' && (
          <div className="flex-1 overflow-y-auto p-3 space-y-4 custom-scrollbar">
            {displayNotes.length === 0 && (
              <div className="text-center text-gray-400 mt-10 flex flex-col items-center gap-3">
                <Sparkles size={28} className="opacity-30" />
                <p className="text-xs font-sans">原子知识库为空</p>
                <p className="text-[10px] text-gray-400 max-w-[200px] leading-relaxed">
                  在 PDF 中选中文字后点击「CRUSH IT」创建原子卡片，或点击下方加载 Demo
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setDemoLoading(true);
                    Promise.resolve()
                      .then(() => {
                        setViewMode('read');
                        setStartDemoLoad(true);
                        setNotification('正在加载白皮书…');
                      })
                      .catch((e) => setNotification(e?.message || '加载失败', 'error'))
                      .finally(() => setDemoLoading(false));
                  }}
                  disabled={demoLoading}
                  className="text-[10px] font-mono px-3 py-1.5 rounded border border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100 disabled:opacity-50"
                >
                  {demoLoading ? '加载中…' : '加载 Demo'}
                </button>
              </div>
            )}
            {rawDisplayNotes.length > 0 && (
              <div>
                <h3 className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                  <Layers size={12} /> 原始卡片 <span className="text-slate-400 font-normal">({rawDisplayNotes.length})</span>
                </h3>
                <div className="space-y-3">
                  <AnimatePresence>
                    {rawDisplayNotes.map((note) => (
                      <NoteCard key={note.id} note={note} onDelete={handleDelete} />
                    ))}
                  </AnimatePresence>
                </div>
              </div>
            )}
            {atomicDisplayNotes.length > 0 && (
              <div>
                <h3 className="text-[10px] font-semibold text-emerald-600 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                  <Sparkles size={12} /> 原子知识卡片 <span className="text-emerald-500 font-normal">({atomicDisplayNotes.length})</span>
                </h3>
                <div className="space-y-3">
                  <AnimatePresence>
                    {atomicDisplayNotes.map((note) => (
                      <NoteCard key={note.id} note={note} onDelete={handleDelete} />
                    ))}
                  </AnimatePresence>
                </div>
              </div>
            )}
          </div>
        )}
        {/* 原子知识：仅展示粉碎后的原子卡片（公理/方法/边界） */}
        {activeTab === 'atomic' && (
          <div className="flex-1 overflow-y-auto p-3 space-y-4 custom-scrollbar">
            {atomicDisplayNotes.length === 0 ? (
              <div className="text-center text-gray-400 mt-10 flex flex-col items-center gap-3">
                <Sparkles size={28} className="opacity-30" />
                <p className="text-xs font-sans">暂无原子知识卡片</p>
                <p className="text-[10px] text-gray-400 max-w-[220px] leading-relaxed">
                  在「卡片」里选中一条笔记，点击「粉碎」即可解构为公理/方法/边界，原子卡片会出现在本 Tab 与图谱下一层级
                </p>
              </div>
            ) : (
              <div>
                <h3 className="text-[10px] font-semibold text-emerald-600 uppercase tracking-wider mb-3 flex items-center gap-1.5">
                  <Sparkles size={12} /> 全部原子知识 <span className="text-emerald-500 font-normal">({atomicDisplayNotes.length})</span>
                </h3>
                <div className="space-y-3">
                  <AnimatePresence>
                    {atomicDisplayNotes.map((note) => (
                      <NoteCard key={note.id} note={note} onDelete={handleDelete} />
                    ))}
                  </AnimatePresence>
                </div>
              </div>
            )}
          </div>
        )}
        {/* 知识树 = 树形脑图（文档→章节→笔记） */}
        {activeTab === 'tree' && (
          <div className="flex-1 flex flex-col overflow-hidden min-h-0">
            <div className="px-3 py-2 border-b border-gray-200 bg-white flex items-center justify-end">
              <button
                type="button"
                onClick={() => setShowDistillModal(true)}
                className="text-[11px] px-2.5 py-1.5 rounded border border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 transition-colors"
              >
                + 新建独立原子碎片
              </button>
            </div>
            {showDistillModal && (
              <div className="p-3 border-b border-gray-200 bg-slate-50">
                <p className="text-xs text-slate-700 mb-2">粘贴微信聊天记录、网页摘录或口语化想法，秘书 Agent 将自动蒸馏为原子知识。</p>
                <textarea
                  value={distillText}
                  onChange={(e) => setDistillText(e.target.value)}
                  placeholder="例如：我们讨论后觉得这个方法在小样本上更稳，但高噪声场景会失效..."
                  className="w-full min-h-[96px] text-xs border border-slate-300 rounded px-2 py-2 focus:outline-none focus:ring-2 focus:ring-emerald-300"
                />
                <div className="mt-2 flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => { if (!distilling) { setShowDistillModal(false); setDistillText(''); } }}
                    className="text-[11px] px-2.5 py-1.5 rounded border border-slate-300 text-slate-600 hover:bg-slate-100"
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    onClick={handleDistillUGC}
                    disabled={distilling || !distillText.trim()}
                    className="text-[11px] px-2.5 py-1.5 rounded border border-emerald-500 bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-60"
                  >
                    {distilling ? '蒸馏中...' : '蒸馏并入库'}
                  </button>
                </div>
              </div>
            )}
            <div className="flex-1 flex overflow-hidden min-h-0">
            <div className={clsx('flex-1 min-w-0', selectedNote ? 'max-w-[55%]' : '')}>
              <TreeMapView notes={scopedNotes} sections={parsedSections} docName={pdfFileName} onSelectNote={setSelectedNote} />
            </div>
            {selectedNote && (
              <div className="w-[45%] min-w-[200px] border-l border-gray-200 bg-white overflow-y-auto p-3 flex flex-col gap-2">
                <div className="flex items-center justify-between border-b border-gray-100 pb-2">
                  <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">原子卡片</span>
                  <button type="button" onClick={() => setSelectedNote(null)} className="p-1 hover:bg-gray-100 rounded"><X size={14} /></button>
                </div>
                <AtomicCardDetail note={selectedNote} />
              </div>
            )}
            </div>
          </div>
        )}
        {activeTab === 'graph' && (
          <GraphView
            scope={graphScope}
            docId={graphScope === 'current' ? (activeDocId || '') : ''}
            docName={pdfFileName}
          />
        )}
        {activeTab === 'graphrag' && (
          <GraphRAGTriplesView
            scope={graphScope}
            docId={graphScope === 'current' ? (activeDocId || '') : ''}
            docName={pdfFileName}
          />
        )}
        {/* 结构图：脑图风格（中心+分支），与知识树、图谱区分 */}
        {activeTab === 'map' && (
          <div className="flex-1 flex overflow-hidden min-h-0">
            <div className={clsx('flex-1 min-w-0', selectedNote ? 'max-w-[55%]' : '')}>
              <StructureMapView notes={scopedNotes} sections={parsedSections} docName={pdfFileName} onSelectNote={setSelectedNote} />
            </div>
            {selectedNote && (
              <div className="w-[45%] min-w-[200px] border-l border-gray-200 bg-white overflow-y-auto p-3 flex flex-col gap-2">
                <div className="flex items-center justify-between border-b border-gray-100 pb-2">
                  <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">原子卡片</span>
                  <button type="button" onClick={() => setSelectedNote(null)} className="p-1 hover:bg-gray-100 rounded"><X size={14} /></button>
                </div>
                <AtomicCardDetail note={selectedNote} />
                <NoteLinkPanel note={selectedNote} otherNotes={scopedNotes.filter((n) => n.id !== selectedNote.id)} />
              </div>
            )}
          </div>
        )}
        {activeTab === 'inbox' && <SecretaryInboxPanel />}
        {activeTab === 'arxiv' && <ArxivPanel />}
      </div>
    </div>
  );
};

// ─── Read 模式：章节树 + 笔记流（无 Tab，专注阅读侧边栏）────────────────────────
const ReadSidebar = () => {
  const { notes, parsedSections, pdfFileName } = useStore();
  const sections = parsedSections?.length
    ? parsedSections.map((s, idx) => ({ ...s, level: 2, title: s.title, summary: s.summary, content: s.content, idx }))
    : [];
  return (
    <div className="h-full flex flex-col overflow-hidden min-h-0 bg-white border-l border-gray-200">
      <div className="px-3 py-2 border-b border-gray-200 shrink-0">
        <h2 className="text-xs font-sans text-gray-600 uppercase tracking-wider">章节与笔记</h2>
      </div>
      <KnowledgeTree notes={notes} sections={sections} docName={pdfFileName} />
    </div>
  );
};

// ─── Write 模式：参考面板（PDF 与阅读区同款样式 + 知识卡片 + 大纲）──────────────────
const ReferencePanel = () => {
  const {
    viewMode,
    notes,
    parsedSections,
    pdfUrl,
    pdfFile,
    pdfNumPages,
    currentPage,
    setCurrentPage,
    setPdfRuntime,
    resetPdfRuntime,
    setActiveReference,
    pdfFileName,
    markdownContent,
    setPendingInsert,
    setContextAttachment,
    setCopilotOpen,
    writeRefTab,
    setWriteRefTab,
  } = useStore();
  const writeTabsOnly = viewMode === 'write';
  const [refTab, setRefTab] = useState(writeTabsOnly ? (writeRefTab || 'notes') : 'outline');
  useEffect(() => {
    if (writeTabsOnly && !['notes', 'atomic', 'graph'].includes(refTab)) setRefTab('notes');
  }, [writeTabsOnly, refTab]);
  useEffect(() => {
    if (writeTabsOnly) {
      setRefTab(writeRefTab || 'notes');
    }
  }, [writeTabsOnly, writeRefTab]);
  const tabs = viewMode === 'write'
    ? [
      { id: 'notes', label: '📝 基础卡片', icon: Tag },
      { id: 'atomic', label: '⚛️ 原子知识', icon: Sparkles },
      { id: 'graph', label: '🕸️ 知识树', icon: GitBranch },
    ]
    : [{ id: 'outline', label: '文献大纲', icon: ListTree }, { id: 'md-outline', label: '写作大纲', icon: FileText }, { id: 'cards', label: '卡片', icon: Tag }, { id: 'pdf', label: 'PDF', icon: BookOpen }];
  const [pdfLoading, setPdfLoading] = useState(true);
  const [pdfError, setPdfError] = useState(null);
  const [objectUrl, setObjectUrl] = useState(null);
  const [writeSearch, setWriteSearch] = useState('');
  const [selectedGraphNote, setSelectedGraphNote] = useState(null);
  useEffect(() => {
    if (pdfFile && typeof pdfFile === 'object' && pdfFile instanceof File) {
      const url = URL.createObjectURL(pdfFile);
      setObjectUrl(url);
      return () => URL.revokeObjectURL(url);
    }
    setObjectUrl(null);
  }, [pdfFile]);

  const outline = (parsedSections || []).map((s, idx) => ({
    level: 2,
    title: s.title,
    summary: s.summary,
    content: s.content,
    idx,
  }));

  // 写作正文的 Markdown 大纲（# ## ###）
  const mdOutline = React.useMemo(() => {
    if (!markdownContent?.trim()) return [];
    const lines = markdownContent.split('\n');
    const list = [];
    let offset = 0;
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(/^(#{1,6})\s+(.+)$/);
      if (m) list.push({ level: m[1].length, title: m[2].trim(), lineIndex: i, offset });
      offset += lines[i].length + 1;
    }
    return list;
  }, [markdownContent]);

  const pdfSrc = objectUrl || pdfUrl;
  const PDF_VIEW_WIDTH = 280;
  const onPdfLoadSuccess = useCallback((pdf) => {
    setPdfRuntime(pdf, pdf?.numPages ?? null);
    if (currentPage > (pdf?.numPages || 1)) {
      setCurrentPage(1);
    }
    setPdfLoading(false);
    setPdfError(null);
  }, [setPdfRuntime, currentPage, setCurrentPage]);
  const onPdfLoadError = useCallback((e) => {
    resetPdfRuntime();
    setPdfLoading(false);
    setPdfError(e?.message || 'PDF 加载失败');
  }, [resetPdfRuntime]);
  useEffect(() => {
    if (pdfSrc) {
      setPdfLoading(true);
      setPdfError(null);
    }
  }, [pdfSrc]);

  const isAtomic = useCallback((n) => !!(n?.axiom || n?.method || n?.boundary), []);
  const queryLower = (writeSearch || '').trim().toLowerCase();
  const matchesQuery = useCallback((n) => {
    if (!queryLower) return true;
    const text = [
      n?.content,
      n?.axiom,
      n?.method,
      n?.boundary,
      n?.type,
      n?.source_name,
      ...(Array.isArray(n?.tags) ? n.tags : []),
      ...(Array.isArray(n?.keywords) ? n.keywords : []),
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    return text.includes(queryLower);
  }, [queryLower]);
  const baseNotes = useMemo(
    () => (notes || []).filter((n) => !isAtomic(n) && matchesQuery(n)),
    [notes, isAtomic, matchesQuery]
  );
  const atomicNotes = useMemo(
    () => (notes || []).filter((n) => isAtomic(n) && matchesQuery(n)),
    [notes, isAtomic, matchesQuery]
  );
  const graphNotes = useMemo(
    () => (notes || []).filter((n) => matchesQuery(n)),
    [notes, matchesQuery]
  );
  const buildInjectText = useCallback((n) => {
    const blocks = [];
    if (n?.axiom) blocks.push(`**Axiom**: ${n.axiom}`);
    if (n?.method) blocks.push(`**Method**: ${n.method}`);
    if (n?.boundary) blocks.push(`**Boundary**: ${n.boundary}`);
    if (blocks.length === 0) blocks.push((n?.content || '').trim() || `[${n?.type || 'note'}]`);
    const noteId = String(n?.id || n?.note_id || 'note');
    const shortId = noteId.slice(0, 8) || 'note';
    const anchor = `[@card-${shortId}](card://${noteId} "${n?.type || 'note'}")`;
    return `${blocks.join('\n\n')}\n\n${anchor}\n`;
  }, []);

  return (
    <div className="h-full flex flex-col overflow-hidden min-h-0 bg-white border-l border-slate-200">
      <div className="shrink-0 bg-white border-b border-slate-200">
        {writeTabsOnly && (
          <div className="sticky top-0 z-10 px-3 pt-3 pb-2 border-b border-slate-100 bg-white">
            <div className="relative">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                value={writeSearch}
                onChange={(e) => setWriteSearch(e.target.value)}
                placeholder="在当前视图中检索..."
                className="w-full pl-8 pr-3 py-2 text-xs border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-emerald-300"
              />
            </div>
          </div>
        )}
        <div className="flex">
          {tabs.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => {
                setRefTab(id);
                if (writeTabsOnly) setWriteRefTab(id);
              }}
              className={clsx(
                'flex-1 flex items-center justify-center gap-1 py-2 text-xs font-medium border-b-2 transition-colors',
                refTab === id ? 'border-emerald-600 text-emerald-700 bg-emerald-50/50' : 'border-transparent text-slate-500 hover:bg-slate-50'
              )}
            >
              {typeof Icon === 'function' ? <Icon size={12} /> : null}
              {' '}
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-3 custom-scrollbar">
        {refTab === 'outline' && (
          <div className="space-y-1.5">
            {outline.length === 0 ? (
              <p className="text-[10px] text-gray-400">暂无大纲，请先解析 PDF。</p>
            ) : (
              outline.map((item, idx) => (
                <button
                  key={idx}
                  onClick={() => {
                    setCurrentPage(Math.max(1, Math.round(((idx + 1) / outline.length) * 50)));
                    setActiveReference({ page: currentPage, bbox: [0, 0, 0, 0] });
                  }}
                  className="w-full text-left py-1.5 px-2 rounded hover:bg-emerald-50 text-[11px] text-gray-700 border-l-2 border-transparent hover:border-emerald-400"
                >
                  <span className="font-medium">{item.title}</span>
                  {item.summary && <p className="text-[9px] text-gray-400 mt-0.5 line-clamp-1">{item.summary}</p>}
                </button>
              ))
            )}
          </div>
        )}
        {refTab === 'md-outline' && (
          <div className="space-y-1">
            {mdOutline.length === 0 ? (
              <p className="text-[10px] text-gray-400">当前文档无标题，使用 # ## ### 可生成大纲。</p>
            ) : (
              mdOutline.map((item, idx) => (
                <div
                  key={idx}
                  className="py-1 px-2 rounded hover:bg-slate-50 text-left text-[11px] text-slate-700 border-l-2 border-transparent hover:border-slate-300"
                  style={{ paddingLeft: 8 + (item.level - 1) * 10 }}
                >
                  <span className="font-medium">{item.title}</span>
                </div>
              ))
            )}
          </div>
        )}
        {refTab === 'cards' && (
          <div className="space-y-2">
            {notes.length === 0 ? (
              <p className="text-[10px] text-gray-400">暂无原子卡片。</p>
            ) : (
              notes.slice(0, 30).map((n) => {
                const snippet = (n.content || n.axiom || '').trim().substring(0, 60);
                const insertText = (n.content || n.axiom || '').trim() || `[${n.type}] p.${n.page ?? ''}`;
                return (
                  <div
                    key={n.id}
                    className="group relative p-2 rounded border border-gray-100 hover:border-emerald-200 hover:bg-emerald-50/50 text-[11px] text-gray-600"
                  >
                    <div
                      onClick={() => n.page != null && (setCurrentPage(n.page), setActiveReference({ page: n.page, bbox: n.bbox ?? [0,0,0,0] }))}
                      className="cursor-pointer pr-16"
                    >
                      <span className="text-[9px] font-bold text-emerald-600">[{n.type}]</span> {snippet}{snippet.length >= 60 ? '…' : ''}
                    </div>
                    <div className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); setPendingInsert(insertText + '\n\n'); }}
                        className="px-1.5 py-0.5 rounded bg-emerald-100 hover:bg-emerald-200 text-emerald-800 text-[10px] font-medium"
                        title="插入到编辑器光标处"
                      >
                        [+] 插入
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setContextAttachment({
                            text: insertText,
                            page: n.page,
                            docName: pdfFileName,
                            noteId: n.id,
                          });
                          setCopilotOpen(true);
                        }}
                        className="px-1.5 py-0.5 rounded bg-amber-100 hover:bg-amber-200 text-amber-800 text-[10px] font-medium"
                        title="作为上下文问 AI"
                      >
                        [&gt;] 问AI
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}
        {writeTabsOnly && refTab === 'notes' && (
          <div className="space-y-2">
            {baseNotes.length === 0 ? (
              <p className="text-[10px] text-slate-400">当前关键词下无基础卡片。</p>
            ) : (
              baseNotes.slice(0, 80).map((n) => {
                const summary = (n.content || '').trim();
                const injectText = buildInjectText(n);
                return (
                  <div
                    key={`note_${n.id}`}
                    className="p-2.5 rounded-r-lg border-l-4 border-slate-500 bg-slate-100/95 border border-slate-200/90 shadow-sm text-[11px] text-slate-800 hover:bg-slate-100 transition-colors"
                  >
                    <p className="text-[9px] font-semibold text-slate-500 mb-1 tracking-wide">原文摘录</p>
                    <div
                      className="cursor-pointer"
                      onClick={() => {
                        if (n.page != null) {
                          setCurrentPage(n.page);
                          setActiveReference({ page: n.page, bbox: n.bbox ?? [0, 0, 0, 0] });
                        }
                      }}
                    >
                      <p className="line-clamp-3 whitespace-pre-wrap">{summary || '[空卡片]'}</p>
                      <p className="text-[9px] text-slate-500 mt-1">#{n.type || 'note'}{n.page ? ` · p.${n.page}` : ''}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setPendingInsert(injectText)}
                      className="mt-2 w-full py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white text-[10px] font-semibold"
                      title="插入正文（含引文来源锚点）"
                    >
                      [+ 插入正文]
                    </button>
                  </div>
                );
              })
            )}
          </div>
        )}
        {writeTabsOnly && refTab === 'atomic' && (
          <div className="space-y-2">
            {atomicNotes.length === 0 ? (
              <p className="text-[10px] text-slate-400">当前关键词下无原子知识卡片。</p>
            ) : (
              atomicNotes.slice(0, 80).map((n) => {
                const injectText = buildInjectText(n);
                return (
                  <div
                    key={`atomic_${n.id}`}
                    className="p-2.5 rounded-xl bg-white border border-slate-200 shadow-[0_4px_14px_rgba(15,23,42,0.07)] border-t-[3px] border-t-emerald-500"
                  >
                    <p className="text-[9px] font-bold text-emerald-800 mb-2">⚛️ 原子知识</p>
                    <AtomicCardDetail note={n} compact />
                    <div className="mt-2 flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setPendingInsert(injectText)}
                        className="flex-1 py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white text-[10px] font-semibold"
                      >
                        [+ 插入正文]
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setContextAttachment({
                            text: (n.axiom || n.content || '').trim(),
                            page: n.page,
                            docName: pdfFileName,
                            noteId: n.id,
                          });
                          setCopilotOpen(true);
                        }}
                        className="px-2 py-1.5 rounded-md bg-amber-100 hover:bg-amber-200 text-amber-800 text-[10px] font-semibold"
                        title="以该原子知识为上下文问 AI"
                      >
                        问AI
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}
        {writeTabsOnly && refTab === 'graph' && (
          <div className="h-full min-h-[520px] flex flex-col gap-2">
            <div className="h-[360px] min-h-[300px] border border-slate-200 rounded-lg overflow-hidden">
              <StructureMapView
                notes={graphNotes}
                sections={parsedSections}
                docName={pdfFileName}
                onSelectNote={setSelectedGraphNote}
              />
            </div>
            <p className="text-[10px] text-slate-500">可滚轮缩放页面与拖动滚动区域；点击脑图节点可在下方查看详情并一键注入正文。</p>
            <div className="border border-slate-200 rounded-lg p-2 bg-white min-h-[140px]">
              {selectedGraphNote ? (
                <>
                  <AtomicCardDetail note={selectedGraphNote} compact />
                  <button
                    type="button"
                    onClick={() => setPendingInsert(buildInjectText(selectedGraphNote))}
                    className="mt-2 w-full py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white text-[10px] font-semibold"
                  >
                    [+ 插入正文]
                  </button>
                </>
              ) : (
                <p className="text-[10px] text-slate-400">点击上方知识树节点查看详情。</p>
              )}
            </div>
          </div>
        )}
        {refTab === 'pdf' && pdfSrc && (
          <div className="flex flex-col items-center gap-2">
            <div className="relative bg-white border border-slate-200 rounded-lg shadow-sm overflow-hidden flex justify-center min-h-[360px]">
              {pdfLoading && (
                <div className="absolute inset-0 flex items-center justify-center text-slate-400 text-sm bg-white/90">Loading PDF…</div>
              )}
              {pdfError && (
                <div className="p-3 text-amber-600 text-xs">{pdfError}</div>
              )}
              <Document
                key={pdfSrc}
                file={pdfSrc}
                onLoadSuccess={onPdfLoadSuccess}
                onLoadError={onPdfLoadError}
                loading=""
              >
                {!pdfLoading && !pdfError && (
                  <Page
                    pageNumber={Math.max(1, currentPage)}
                    width={PDF_VIEW_WIDTH}
                    renderTextLayer={false}
                    renderAnnotationLayer={false}
                  />
                )}
              </Document>
            </div>
            {!pdfLoading && !pdfError && (
              <div className="flex items-center gap-2 text-xs text-slate-600">
                <button onClick={() => setCurrentPage((p) => Math.max(1, p - 1))} className="px-2 py-1 rounded border border-slate-200 hover:bg-slate-50">上一页</button>
                <span>p.{currentPage}{pdfNumPages != null ? ` / ${pdfNumPages}` : ''}</span>
                <button onClick={() => setCurrentPage((p) => Math.min(pdfNumPages || 999, p + 1))} className="px-2 py-1 rounded border border-slate-200 hover:bg-slate-50">下一页</button>
              </div>
            )}
          </div>
        )}
        {refTab === 'pdf' && !pdfSrc && (
          <p className="text-[10px] text-slate-400">当前无 PDF，请在 Read 中打开文献。</p>
        )}
        {!writeTabsOnly && refTab === 'ai' && (
          <div className="h-full min-h-[420px] -m-3">
            <AssistantSidebar embedded />
          </div>
        )}
      </div>
    </div>
  );
};

// ─── 主组件 ────────────────────────────────────────────────────────────────────
export const MiddleColumn = () => {
  const { viewMode } = useStore();

  return (
    <div className="h-full flex flex-col bg-slate-50 overflow-hidden min-h-0">
      {viewMode === 'read' ? (
        <ReadSidebar />
      ) : viewMode === 'write' ? (
        <ErrorBoundary context="Write / ReferencePanel">
          <ReferencePanel />
        </ErrorBoundary>
      ) : viewMode === 'organize' ? (
        <NexusPanel />
      ) : (
        <NexusPanel />
      )}
    </div>
  );
};

export { ChatMessage, ReferencePanel };
