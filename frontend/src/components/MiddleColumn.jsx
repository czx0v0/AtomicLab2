import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useStore } from '../store/useStore';
import { useScreenshot } from '../hooks/useScreenshot';
import clsx from 'clsx';
import {
  Search, Brain, Layers, MessageSquare, User, Bot, Sparkles, BookOpen,
  ArrowRight, MousePointer2, Download, ExternalLink, Loader2, AlertCircle,
  Network, FileSearch, Send, X, Plus, GitBranch, Tag, Trash2, Languages, Highlighter, ListTree, ChevronRight, FileText, Link2
} from 'lucide-react';
import { Document, Page } from 'react-pdf';
import { motion, AnimatePresence } from 'framer-motion';
import ForceGraph2D from 'react-force-graph-2d';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import rehypeHighlight from 'rehype-highlight';
import * as api from '../api/client';

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

// ─── 结构化原子卡片（公理 / 方法 / 边界，含 KaTeX 公式 + 带颜色 Tag）────────────
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
      <div className="flex flex-wrap gap-1 mb-1">
        {note.axiom && (
          <span className="px-1.5 py-0.5 text-[9px] font-sans font-bold uppercase tracking-wider rounded bg-cyan-100 text-cyan-800 border border-cyan-300">
            核心公理
          </span>
        )}
        {note.method && (
          <span className="px-1.5 py-0.5 text-[9px] font-sans font-bold uppercase tracking-wider rounded bg-purple-100 text-purple-800 border border-purple-300">
            方法公式
          </span>
        )}
        {note.boundary && (
          <span className="px-1.5 py-0.5 text-[9px] font-sans font-bold uppercase tracking-wider rounded bg-amber-100 text-amber-800 border border-amber-300">
            场景边界
          </span>
        )}
      </div>
      {note.axiom && (
        <div>
          <p className="text-[9px] font-sans text-cyan-700 uppercase tracking-wider mb-0.5">公理 (Axiom)</p>
          <p className={clsx('text-gray-800', blockCls)}>{note.axiom}</p>
        </div>
      )}
      {note.method && (
        <div>
          <p className="text-[9px] font-sans text-purple-700 uppercase tracking-wider mb-0.5">方法 (Method)</p>
          <div className={clsx('bg-slate-50 border border-slate-200 rounded-md px-2 py-1.5 overflow-x-auto [&_.katex]:text-sm', blockCls)}>
            <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex, rehypeHighlight]}>
              {note.method}
            </ReactMarkdown>
          </div>
        </div>
      )}
      {note.boundary && (
        <div>
          <p className="text-[9px] font-sans text-amber-700 uppercase tracking-wider mb-0.5">边界 (Boundary)</p>
          <p className={clsx('text-gray-700', blockCls)}>{note.boundary}</p>
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

// ─── 原子笔记卡片 ──────────────────────────────────────────────────────────────
const NoteCard = ({ note, onDelete }) => {
  const { pdfFile, setActiveReference, addHighlight } = useStore();
  const { imageSrc: hookSrc, loading: hookLoading } = useScreenshot(
    note.screenshot ? null : pdfFile, note.page, note.bbox
  );
  const imageSrc = note.screenshot || hookSrc;
  const loading = !note.screenshot && hookLoading;
  const [actionLoading, setActionLoading] = useState(null);

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
    setActionLoading('crush');
    try {
      const resp = await api.decomposeNote(note.content, note.id, useStore.getState().activeDocId || '');
      const axiom = resp.axiom ?? '';
      const method = resp.method ?? '';
      const boundary = resp.boundary ?? '';
      if (axiom || method || boundary) {
        try {
          await api.updateNote(note.id, { axiom, method, boundary });
        } catch (_) {}
        const notes = useStore.getState().notes;
        useStore.getState().setNotes(notes.map(n =>
          n.id === note.id ? { ...n, axiom, method, boundary } : n
        ));
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
      className="bg-white border-2 border-black shadow-[4px_4px_0px_#000] p-3 flex flex-col gap-2 group hover:-translate-y-0.5 hover:shadow-[6px_6px_0px_#000] transition-all relative"
    >
      <div className="flex items-center justify-between border-b border-gray-100 pb-2">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className={clsx('px-2 py-0.5 text-[9px] uppercase font-bold border-2 font-sans', typeColor[note.type] ?? 'bg-gray-100 text-gray-900 border-gray-800')}>
            {note.type}
          </span>
          {(note.content === '[截图高亮]' || (note.screenshot && !note.content?.trim())) && (
            <span className="px-1.5 py-0.5 text-[8px] font-sans text-amber-700 bg-amber-100 border border-amber-300 rounded" title="文字未识别，切页或解析完成后将自动补全">待识别</span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {note.page && (
            <button
              onClick={() => setActiveReference({ page: note.page, bbox: note.bbox ?? [0,0,0,0] })}
              className="text-[9px] bg-gray-50 border border-gray-300 px-2 py-0.5 hover:bg-black hover:text-white flex items-center gap-1 cursor-pointer font-mono transition-colors"
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

      {/* 截图卡片显示预览图；文字卡片显示文字占位（与截图区分） */}
      <div className="w-full h-28 bg-gray-50 border border-dashed border-gray-200 relative overflow-hidden flex items-center justify-center">
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
            <span className="text-[9px] font-sans block truncate">文字片段</span>
          </div>
        )}
      </div>

      {/* 内容：优先结构化公理/方法/边界，否则原文 */}
      <AtomicCardDetail note={note} />
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
const LEVEL_COLORS = { document: '#3b82f6', section: '#10b981', method: '#06b6d4', formula: '#a855f7', idea: '#f59e0b', definition: '#22c55e', data: '#ef4444', other: '#6b7280', tag: '#c084fc', atomic_note: '#059669' };

const isAtomicNoteNode = (n) => !!(n.axiom || n.method || n.boundary);

const GraphView = ({ notes, sections = [], docName = '' }) => {
  const { setActiveReference, noteLinks } = useStore();
  const containerRef = useRef(null);
  const [dims, setDims] = useState({ w: 500, h: 400 });

  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver(([e]) => {
      setDims({ w: e.contentRect.width, h: e.contentRect.height });
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  const graphData = React.useMemo(() => {
    const nodes = [];
    const links = [];
    const nodesById = {};

    // ── 文档根节点 ────────────────────────────────────────────────────────
    const docId = 'doc_root';
    const docNode = { id: docId, label: docName || '文档', level: 'document', color: LEVEL_COLORS.document, sz: 14 };
    nodes.push(docNode);
    nodesById[docId] = docNode;

    // ── 章节节点 ──────────────────────────────────────────────────────────
    const secMap = assignNotesToSections(notes, sections);
    const sectionNodes = [];
    sections.forEach((sec, idx) => {
      const secId = `sec_${idx}`;
      const secNode = { id: secId, label: sec.title?.substring(0, 24), level: 'section', color: LEVEL_COLORS.section, sz: 10 };
      nodes.push(secNode);
      nodesById[secId] = secNode;
      sectionNodes.push(secNode);
      links.push({ source: docNode, target: secNode, type: 'contains' });
    });

    // ── 笔记节点：普通卡片一层，粉碎后的原子知识为下一层级（更小、绿色）────
    const tagSet = {};
    notes.forEach(n => {
      const isAtomic = isAtomicNoteNode(n);
      const level = isAtomic ? 'atomic_note' : (n.type || 'other');
      const color = isAtomic ? LEVEL_COLORS.atomic_note : (LEVEL_COLORS[n.type] || LEVEL_COLORS.other);
      const sz = isAtomic ? 4 : 6;
      const label = (n.axiom || n.content || n.id)?.toString().substring(0, 18) + '…';
      const noteNode = { id: n.id, label, level, page: n.page, bbox: n.bbox, color, sz, isAtomic };
      nodes.push(noteNode);
      nodesById[n.id] = noteNode;

      if (sections.length > 0) {
        let linked = false;
        for (let idx = 0; idx < sections.length; idx++) {
          const list = secMap[idx] || [];
          if (list.some((nn) => nn.id === n.id)) {
            const secNode = sectionNodes[idx];
            if (secNode) { links.push({ source: secNode, target: noteNode, type: 'contains' }); linked = true; }
            break;
          }
        }
        if (!linked && sectionNodes[0]) links.push({ source: sectionNodes[0], target: noteNode, type: 'contains' });
      } else {
        links.push({ source: docNode, target: noteNode, type: 'contains' });
      }

      (n.keywords || []).forEach(kw => {
        const tagId = `tag_${kw}`;
        if (!tagSet[kw]) {
          tagSet[kw] = true;
          const tagNode = { id: tagId, label: `#${kw}`, level: 'tag', color: LEVEL_COLORS.tag, sz: 4 };
          nodes.push(tagNode);
          nodesById[tagId] = tagNode;
        }
        links.push({ source: noteNode, target: nodesById[tagId], type: 'tagged_with' });
      });
    });

    const kwMap = {};
    notes.forEach(n => { (n.keywords || []).forEach(kw => { (kwMap[kw] ??= []).push(n.id); }); });
    Object.values(kwMap).forEach(ids => {
      for (let i = 0; i < ids.length - 1; i++) {
        const a = nodesById[ids[i]];
        const b = nodesById[ids[i + 1]];
        if (a && b) links.push({ source: a, target: b, type: 'references' });
      }
    });

    (noteLinks || []).forEach((l) => {
      const a = nodesById[l.sourceId];
      const b = nodesById[l.targetId];
      if (a && b) links.push({ source: a, target: b, type: 'manual' });
    });

    return { nodes, links };
  }, [notes, sections, docName, noteLinks]);

  const totalNodes = graphData.nodes.length;

  const handleNodeClick = useCallback((node) => {
    if (node.page) setActiveReference({ page: node.page, bbox: node.bbox ?? [0, 0, 0, 0] });
  }, [setActiveReference]);

  if (notes.length === 0 && sections.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-400 flex-col gap-3">
        <Network size={32} className="opacity-30" />
        <p className="text-xs font-sans">暂无知识图谱数据</p>
        <p className="text-[10px] text-gray-400">上传 PDF 并解析后自动生成</p>
      </div>
    );
  }

  const linkTypeColor = { contains: 'rgba(99,102,241,0.5)', tagged_with: 'rgba(192,132,252,0.35)', references: 'rgba(251,191,36,0.4)', manual: 'rgba(34,197,94,0.7)' };

  return (
    <div ref={containerRef} className="flex-1 bg-gray-900 relative overflow-hidden">
      <ForceGraph2D
        graphData={graphData}
        width={dims.w}
        height={dims.h}
        backgroundColor="#111827"
        nodeLabel="label"
        nodeColor={n => n.color}
        nodeRelSize={5}
        linkColor={l => linkTypeColor[l.type] || 'rgba(99,102,241,0.3)'}
        linkWidth={l => l.type === 'contains' ? 1.8 : l.type === 'manual' ? 2 : 1}
        linkLineDash={l => l.type === 'references' ? [4, 2] : null}
        onNodeClick={handleNodeClick}
        nodeCanvasObject={(node, ctx, globalScale) => {
          const sz = node.sz || 6;
          ctx.beginPath();
          if (node.level === 'document') {
            ctx.moveTo(node.x, node.y - sz); ctx.lineTo(node.x + sz, node.y); ctx.lineTo(node.x, node.y + sz); ctx.lineTo(node.x - sz, node.y); ctx.closePath();
          } else if (node.level === 'section') {
            ctx.rect(node.x - sz / 2, node.y - sz / 2, sz, sz);
          } else if (node.level === 'tag') {
            ctx.moveTo(node.x, node.y - sz); ctx.lineTo(node.x + sz * 0.87, node.y + sz / 2); ctx.lineTo(node.x - sz * 0.87, node.y + sz / 2); ctx.closePath();
          } else {
            ctx.arc(node.x, node.y, sz / 2, 0, 2 * Math.PI);
          }
          ctx.fillStyle = node.color;
          ctx.fill();
          ctx.strokeStyle = node.level === 'document' ? '#fff' : node.level === 'section' ? '#6ee7b7' : node.level === 'tag' ? '#c4b5fd' : node.level === 'atomic_note' ? '#34d399' : '#6366f1';
          ctx.lineWidth = node.level === 'document' ? 2 : node.level === 'atomic_note' ? 0.8 : 1.2;
          ctx.stroke();
          if (globalScale > 1.2 || node.level === 'document' || node.level === 'section' || node.level === 'atomic_note') {
            const fontSize = node.level === 'document' ? 11 : node.level === 'section' ? 9 : node.level === 'atomic_note' ? 6 : 7;
            ctx.font = `${fontSize}px sans-serif`;
            ctx.textAlign = 'center';
            ctx.fillStyle = '#d1d5db';
            ctx.fillText(node.label?.substring(0, node.level === 'atomic_note' ? 14 : 22) || '', node.x, node.y + sz + 5);
          }
        }}
      />
      {/* 图例：文档 / 章节 / 普通卡片 / 原子知识(下一层级) / 标签 */}
      <div className="absolute top-2 left-2 font-sans text-[8px] text-white/50 pointer-events-none space-y-0.5">
        <p>KNOWLEDGE GRAPH · {totalNodes} NODES</p>
        <p><span className="inline-block w-2 h-2 bg-blue-500 mr-1" />DOC <span className="inline-block w-2 h-2 bg-emerald-500 mx-1" />SEC <span className="inline-block w-2 h-2 rounded-full bg-cyan-500 mx-1" />NOTE <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400 mx-1" />原子 <span className="inline-block w-0 h-0 border-l-[3px] border-r-[3px] border-b-[5px] border-transparent border-b-purple-400 mx-1" />TAG</p>
      </div>
    </div>
  );
};

// ─── GraphRAG 三元组列表（与图谱同源：文档→章节→笔记、标签、笔记间概念、手动连线）────
const GraphRAGTriplesView = ({ notes, sections = [], docName = '', noteLinks = [] }) => {
  const triples = React.useMemo(() => {
    const out = [];
    const docId = docName || '文档';
    const noteById = Object.fromEntries((notes || []).map((n) => [n.id, n]));
    const labelOf = (n) => (n?.content || n?.axiom || n?.id || '').toString().substring(0, 24) || n?.id;
    const secMap = assignNotesToSections(notes, sections);
    if (sections?.length) {
      sections.forEach((sec, idx) => {
        out.push({ subject: docId, predicate: 'Contains', object: sec.title?.substring(0, 32) || `章节${idx + 1}` });
        (secMap[idx] || []).forEach((n) => {
          const label = n.content?.substring(0, 20) || n.axiom?.substring(0, 20) || n.id;
          out.push({ subject: sec.title?.substring(0, 24) || `章节${idx}`, predicate: 'Contains', object: label });
        });
      });
    } else if (notes.length > 0) {
      out.push({ subject: docId, predicate: 'Contains', object: '未分章节' });
      notes.forEach((n) => {
        const label = n.content?.substring(0, 20) || n.axiom?.substring(0, 20) || n.id;
        out.push({ subject: '未分章节', predicate: 'Contains', object: label });
      });
    }
    notes.forEach((n) => {
      (n.keywords || []).forEach((kw) => {
        out.push({ subject: n.content?.substring(0, 18) || n.id, predicate: 'TaggedWith', object: `#${kw}` });
      });
    });
    const kwMap = {};
    notes.forEach((n) => { (n.keywords || []).forEach((kw) => { (kwMap[kw] ??= []).push(n); }); });
    Object.entries(kwMap).forEach(([kw, list]) => {
      for (let i = 0; i < list.length - 1; i++) {
        const a = list[i].content?.substring(0, 14) || list[i].id;
        const b = list[i + 1].content?.substring(0, 14) || list[i + 1].id;
        out.push({ subject: a, predicate: 'Shares_Concept', object: b });
      }
    });
    (noteLinks || []).forEach((link) => {
      const src = noteById[link.sourceId];
      const tgt = noteById[link.targetId];
      const subj = src ? labelOf(src) : link.sourceId;
      const obj = tgt ? labelOf(tgt) : link.targetId;
      out.push({ subject: subj, predicate: '手动关联', object: obj });
    });
    return out;
  }, [notes, sections, docName, noteLinks]);

  if (triples.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-400 flex-col gap-2 p-6">
        <Network size={28} className="opacity-40" />
        <p className="text-xs font-sans">暂无 GraphRAG 三元组</p>
        <p className="text-[10px]">解析文档并生成笔记后自动构建</p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
      <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-3">三元组 (主体 — 关系 — 客体)</div>
      <ul className="space-y-2">
        {triples.map((t, i) => (
          <li key={i} className="flex items-center gap-2 flex-wrap text-xs font-sans border-b border-slate-100 pb-2 last:border-0">
            <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-700 max-w-[140px] truncate" title={t.subject}>{t.subject}</span>
            <span className="text-amber-600 shrink-0">{t.predicate}</span>
            <span className="px-2 py-0.5 rounded bg-emerald-50 text-emerald-800 max-w-[140px] truncate" title={t.object}>{t.object}</span>
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

// ─── 聊天消息 ──────────────────────────────────────────────────────────────────

// 将内容中的 [1] [2] 等引用替换为可点击按钮，其余用 Markdown+Math 渲染
const renderCitedContent = (content, sources, setActiveReference) => {
  if (!content) return null;
  const parts = content.split(/(\[\d+\])/g);
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
          onClick={() => {
            if (isExternal && src.url) {
              window.open(src.url, '_blank', 'noopener');
            } else if (src.page_num > 0) {
              setActiveReference({ page: src.page_num, bbox: src.bbox?.length === 4 ? src.bbox : [0,0,0,0] });
            }
          }}
          className="inline-flex items-center justify-center min-w-[16px] h-4 px-1 mx-0.5 text-[9px] font-bold bg-blue-100 text-blue-700 rounded cursor-pointer hover:bg-blue-200 transition-colors"
          title={src.concept || src.summary?.substring(0, 60)}
        >
          {part}
        </sup>
      );
    }
    if (!part.trim()) return <span key={i}>{part}</span>;
    return (
      <span key={i} className="inline [&_.katex]:text-sm [&_p]:inline [&_p]:after:content-['\00a0']">
        <ReactMarkdown
          remarkPlugins={[remarkGfm, remarkMath]}
          rehypePlugins={[rehypeKatex, rehypeHighlight]}
          components={{ p: ({ children }) => <span>{children}</span> }}
        >
          {part}
        </ReactMarkdown>
      </span>
    );
  });
};

const ChatMessage = ({ msg }) => {
  const isUser = msg.role === 'user';
  const { setActiveReference, setViewMode } = useStore();
  const agentMeta = {
    seeker:     { label: 'SEEKER', color: 'bg-cyan-100 text-cyan-800', icon: <Search size={16} /> },
    reviewer:   { label: 'REVIEWER', color: 'bg-rose-100 text-rose-800', icon: <Bot size={16} /> },
    synthesizer:{ label: 'SYNTHESIZER', color: 'bg-purple-100 text-purple-800', icon: <Brain size={16} /> },
    system:     { label: 'SYSTEM', color: 'bg-gray-200 text-gray-700', icon: <Sparkles size={16} /> },
  };
  const meta = agentMeta[msg.agentType] ?? agentMeta.system;

  return (
    <div className={clsx('flex gap-2 mb-4 w-full', isUser ? 'flex-row-reverse' : 'flex-row')}>
      <div className={clsx('w-9 h-9 flex shrink-0 items-center justify-center border-2 border-black shadow-[2px_2px_0px_#000] bg-white overflow-hidden',
        isUser ? 'bg-gray-900 text-white' : meta.color)}>
        {isUser ? <User size={16} /> : meta.icon}
      </div>
      <div className={clsx('relative p-3 max-w-[85%] text-xs border-2 border-black shadow-[3px_3px_0px_rgba(0,0,0,0.1)]',
        isUser
          ? 'bg-gray-900 text-white rounded-tr-none rounded-bl-xl rounded-tl-xl rounded-br-xl'
          : 'bg-white text-gray-800 rounded-tl-none rounded-tr-xl rounded-br-xl rounded-bl-xl')}>
        {!isUser && (
          <div className="text-[9px] font-sans mb-1.5 opacity-70 uppercase tracking-wider border-b border-current pb-1 inline-block">
            {meta.label}_BOT
          </div>
        )}
        <p className="leading-relaxed whitespace-pre-wrap">
          {msg.agentType === 'synthesizer'
            ? renderCitedContent(msg.content, msg.relatedNotes, setActiveReference)
            : msg.content}
        </p>
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
                      if (isExternal && n.url) window.open(n.url, '_blank', 'noopener');
                      else if (hasPage) {
                        setViewMode('read');
                        setActiveReference({ page: n.page_num, bbox: n.bbox?.length === 4 ? n.bbox : [0,0,0,0] });
                      }
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
                    if (isExternal && n.url) {
                      window.open(n.url, '_blank', 'noopener');
                    } else if (hasPage) {
                      setViewMode('read');
                      setActiveReference({ page: n.page_num, bbox: n.bbox && n.bbox.length === 4 ? n.bbox : [0, 0, 0, 0] });
                    }
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
              relatedNotes: data.related_notes?.slice(0, 3) ?? [],
            });
          }
        } else if (type === 'delta' && synthId != null) {
          synthContent += data.token || '';
          updateLastMessage({ content: synthContent });
        } else if (type === 'done') {
          // 将 sources 附加到 synthesizer 消息
          const sources = data.sources ?? [];
          if (synthId != null && sources.length > 0) {
            updateLastMessage({ relatedNotes: sources.slice(0, 3) });
          }
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

// ─── 原子卡片面板（带 API 查询） ────────────────────────────────────────────────
const NexusPanel = () => {
  const {
    notes, removeNote, setNotes,
    searchQuery, setSearchQuery,
    searchStatus, setSearchStatus,
    searchResults, setSearchResults,
    parsedSections, pdfFileName,
    noteLinks,
    setParsedSections, setParsedMarkdown, setNotification,
    setViewMode, setStartDemoLoad,
  } = useStore();
  const [demoLoading, setDemoLoading] = useState(false);

  const [activeTab, setActiveTab] = useState('deck'); // 'deck' | 'tree' | 'map' | 'graph' | 'arxiv' | 'chat'
  const [selectedNote, setSelectedNote] = useState(null); // 脑图/树点击的笔记，用于展示公理/方法/边界

  // 进入整理视图时以服务端为准同步笔记，避免旧会话/幽灵卡片残留
  useEffect(() => {
    api.getNotes()
      .then((data) => {
        const list = Array.isArray(data.notes) ? data.notes : [];
        setNotes(list);
      })
      .catch(() => {});
  }, [setNotes]);

  const handleSearch = async (e) => {
    if (e.key !== 'Enter' || !searchQuery.trim()) return;
    setSearchStatus('tokenizing');
    setTimeout(() => setSearchStatus('vector'), 600);
    setTimeout(() => setSearchStatus('fusion'), 1300);

    try {
      const data = await api.searchNotes(searchQuery);
      setSearchResults(data.results ?? []);
      setSearchStatus('done');
    } catch {
      const localResults = notes.filter((n) =>
        n.content?.toLowerCase().includes(searchQuery.toLowerCase())
      );
      setSearchResults(localResults.map((n) => ({ ...n, note_id: n.id, summary: n.content, concept: n.type, page_num: n.page })));
      setSearchStatus('done');
    }
    setTimeout(() => setSearchStatus('idle'), 3000);
  };

  const handleDelete = async (id) => {
    try { await api.deleteNote(id); } catch {}
    removeNote(id);
  };

  const displayNotes = searchStatus === 'done' && searchResults.length > 0
    ? searchResults.map((r) => notes.find((n) => n.id === r.note_id) ?? { id: r.note_id, content: r.summary, type: 'idea', page: r.page_num, keywords: r.keywords })
    : notes;

  // 仅当存在公理/方法/边界三层解构时为「原子知识」；其余（含高亮、截图、未粉碎）均在原始卡片
  const isAtomicNote = (n) => !!(n.axiom || n.method || n.boundary);
  const rawDisplayNotes = displayNotes.filter((n) => !isAtomicNote(n));
  const atomicDisplayNotes = displayNotes.filter(isAtomicNote);

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* 搜索框 */}
      <div className="p-3 border-b border-gray-200">
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={handleSearch}
            placeholder="语义检索知识库 (Enter)..."
            className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
          />
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
          { id: 'deck', label: `卡片 (${displayNotes.length})`, icon: Layers },
          { id: 'atomic', label: `原子知识 (${atomicDisplayNotes.length})`, icon: Sparkles },
          { id: 'tree', label: '知识树', icon: ListTree },
          { id: 'graph', label: '图谱', icon: Network },
          { id: 'graphrag', label: 'GraphRAG', icon: Tag },
          { id: 'map', label: '结构图', icon: GitBranch },
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
                    api.resetSession()
                      .then(() => api.loadDemo())
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
          <div className="flex-1 flex overflow-hidden min-h-0">
            <div className={clsx('flex-1 min-w-0', selectedNote ? 'max-w-[55%]' : '')}>
              <TreeMapView notes={notes} sections={parsedSections} docName={pdfFileName} onSelectNote={setSelectedNote} />
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
        )}
        {activeTab === 'graph' && <GraphView notes={notes} sections={parsedSections} docName={pdfFileName} />}
        {activeTab === 'graphrag' && <GraphRAGTriplesView notes={notes} sections={parsedSections} docName={pdfFileName} noteLinks={noteLinks || []} />}
        {/* 结构图：脑图风格（中心+分支），与知识树、图谱区分 */}
        {activeTab === 'map' && (
          <div className="flex-1 flex overflow-hidden min-h-0">
            <div className={clsx('flex-1 min-w-0', selectedNote ? 'max-w-[55%]' : '')}>
              <StructureMapView notes={notes} sections={parsedSections} docName={pdfFileName} onSelectNote={setSelectedNote} />
            </div>
            {selectedNote && (
              <div className="w-[45%] min-w-[200px] border-l border-gray-200 bg-white overflow-y-auto p-3 flex flex-col gap-2">
                <div className="flex items-center justify-between border-b border-gray-100 pb-2">
                  <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">原子卡片</span>
                  <button type="button" onClick={() => setSelectedNote(null)} className="p-1 hover:bg-gray-100 rounded"><X size={14} /></button>
                </div>
                <AtomicCardDetail note={selectedNote} />
                <NoteLinkPanel note={selectedNote} otherNotes={notes.filter((n) => n.id !== selectedNote.id)} />
              </div>
            )}
          </div>
        )}
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
    currentPage,
    setCurrentPage,
    setActiveReference,
    pdfFileName,
    markdownContent,
    setPendingInsert,
    setContextAttachment,
    setCopilotOpen,
  } = useStore();
  const writeTabsOnly = viewMode === 'write';
  const [refTab, setRefTab] = useState(writeTabsOnly ? 'cards' : 'outline');
  useEffect(() => {
    if (writeTabsOnly && refTab !== 'cards' && refTab !== 'pdf') setRefTab('cards');
  }, [writeTabsOnly, refTab]);
  const tabs = viewMode === 'write'
    ? [{ id: 'cards', label: '卡片', icon: Tag }, { id: 'pdf', label: 'PDF', icon: BookOpen }]
    : [{ id: 'outline', label: '文献大纲', icon: ListTree }, { id: 'md-outline', label: '写作大纲', icon: FileText }, { id: 'cards', label: '卡片', icon: Tag }, { id: 'pdf', label: 'PDF', icon: BookOpen }];
  const [numPages, setNumPages] = useState(null);
  const [pdfLoading, setPdfLoading] = useState(true);
  const [pdfError, setPdfError] = useState(null);
  const [objectUrl, setObjectUrl] = useState(null);
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
  const onPdfLoadSuccess = useCallback(({ numPages: n }) => {
    setNumPages(n);
    setPdfLoading(false);
    setPdfError(null);
  }, []);
  const onPdfLoadError = useCallback((e) => {
    setPdfLoading(false);
    setPdfError(e?.message || 'PDF 加载失败');
  }, []);
  useEffect(() => {
    if (pdfSrc) {
      setPdfLoading(true);
      setPdfError(null);
    }
  }, [pdfSrc]);

  return (
    <div className="h-full flex flex-col overflow-hidden min-h-0 bg-white border-l border-slate-200">
      <div className="flex border-b border-slate-200 shrink-0">
        {tabs.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setRefTab(id)}
            className={clsx(
              'flex-1 flex items-center justify-center gap-1 py-2 text-xs font-medium border-b-2 transition-colors',
              refTab === id ? 'border-emerald-600 text-emerald-700 bg-emerald-50/50' : 'border-transparent text-slate-500 hover:bg-slate-50'
            )}
          >
            <Icon size={12} /> {label}
          </button>
        ))}
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
                <span>p.{currentPage}{numPages != null ? ` / ${numPages}` : ''}</span>
                <button onClick={() => setCurrentPage((p) => Math.min(numPages || 999, p + 1))} className="px-2 py-1 rounded border border-slate-200 hover:bg-slate-50">下一页</button>
              </div>
            )}
          </div>
        )}
        {refTab === 'pdf' && !pdfSrc && (
          <p className="text-[10px] text-slate-400">当前无 PDF，请在 Read 中打开文献。</p>
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
        <ReferencePanel />
      ) : viewMode === 'organize' ? (
        <NexusPanel />
      ) : (
        <NexusPanel />
      )}
    </div>
  );
};

export { ChatMessage, ReferencePanel };
