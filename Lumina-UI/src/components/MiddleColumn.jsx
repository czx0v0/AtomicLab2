import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useStore } from '../store/useStore';
import { useScreenshot } from '../hooks/useScreenshot';
import clsx from 'clsx';
import {
  Search, Brain, Layers, MessageSquare, User, Bot, Sparkles, BookOpen,
  ArrowRight, MousePointer2, Download, ExternalLink, Loader2, AlertCircle,
  Network, FileSearch, Send, X, Plus, GitBranch, Tag
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import ForceGraph2D from 'react-force-graph-2d';
import * as api from '../api/client';

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
    <div className="w-full bg-blue-50 border-2 border-black p-3 font-pixel mb-3 shadow-[4px_4px_0px_#000]">
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
  const { pdfFile, setActiveReference } = useStore();
  const { imageSrc: hookSrc, loading: hookLoading } = useScreenshot(
    note.screenshot ? null : pdfFile, note.page, note.bbox
  );
  const imageSrc = note.screenshot || hookSrc;
  const loading = !note.screenshot && hookLoading;

  const typeColor = {
    method:     'bg-cyan-100 text-cyan-900 border-cyan-800',
    formula:    'bg-purple-100 text-purple-900 border-purple-800',
    idea:       'bg-amber-100 text-amber-900 border-amber-800',
    definition: 'bg-green-100 text-green-900 border-green-800',
    data:       'bg-rose-100 text-rose-900 border-rose-800',
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      className="bg-white border-2 border-black shadow-[4px_4px_0px_#000] p-3 flex flex-col gap-2 group hover:-translate-y-0.5 hover:shadow-[6px_6px_0px_#000] transition-all relative"
    >
      <div className="flex items-center justify-between border-b border-gray-100 pb-2">
        <span className={clsx('px-2 py-0.5 text-[9px] uppercase font-bold border-2 font-pixel', typeColor[note.type] ?? 'bg-gray-100 text-gray-900 border-gray-800')}>
          {note.type}
        </span>
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

      {/* 截图预览 */}
      <div className="w-full h-28 bg-gray-50 border border-dashed border-gray-200 relative overflow-hidden flex items-center justify-center">
        {loading ? (
          <div className="flex flex-col items-center gap-2">
            <Loader2 size={16} className="animate-spin text-gray-400" />
            <span className="text-[9px] font-pixel text-gray-400">RENDERING</span>
          </div>
        ) : imageSrc ? (
          <img src={imageSrc} alt="预览" className="w-full h-full object-contain p-1" />
        ) : (
          <div className="text-center opacity-40">
            <Sparkles size={18} className="mx-auto mb-1" />
            <span className="text-[9px] font-pixel">NO SIGNAL</span>
          </div>
        )}
      </div>

      {/* 内容 */}
      <p className="text-xs text-gray-900 leading-relaxed font-sans line-clamp-4">{note.content}</p>
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
    </motion.div>
  );
};

// ─── 知识图谱视图 ──────────────────────────────────────────────────────────────
const GraphView = ({ notes }) => {
  const { setActiveReference } = useStore();
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

  // 构建图谱数据：以 type 为群组节点，notes 为叶节点
  const graphData = React.useMemo(() => {
    const typeNodes = [...new Set(notes.map((n) => n.type))].map((t) => ({
      id: `type_${t}`,
      label: t,
      isType: true,
      color: { method: '#06b6d4', formula: '#a855f7', idea: '#f59e0b', definition: '#10b981', data: '#ef4444' }[t] ?? '#6b7280',
    }));
    const noteNodes = notes.map((n) => ({
      id: n.id,
      label: n.content?.substring(0, 20) + '…',
      page: n.page,
      bbox: n.bbox,
      isType: false,
      color: '#fff',
    }));
    const links = notes.map((n) => ({
      source: `type_${n.type}`,
      target: n.id,
    }));
    // 关键词相连
    const kwMap = {};
    notes.forEach((n) => {
      (n.keywords || []).forEach((kw) => {
        if (!kwMap[kw]) kwMap[kw] = [];
        kwMap[kw].push(n.id);
      });
    });
    Object.values(kwMap).forEach((ids) => {
      for (let i = 0; i < ids.length - 1; i++) {
        links.push({ source: ids[i], target: ids[i + 1], isKw: true });
      }
    });
    return { nodes: [...typeNodes, ...noteNodes], links };
  }, [notes]);

  const handleNodeClick = useCallback((node) => {
    if (!node.isType && node.page) {
      setActiveReference({ page: node.page, bbox: node.bbox ?? [0, 0, 0, 0] });
    }
  }, [setActiveReference]);

  if (notes.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-400 flex-col gap-3">
        <Network size={32} className="opacity-30" />
        <p className="text-xs font-pixel">暂无知识图谱数据</p>
        <p className="text-[10px] text-gray-400">上传 PDF 并解析后自动生成</p>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="flex-1 bg-gray-900 relative overflow-hidden">
      <ForceGraph2D
        graphData={graphData}
        width={dims.w}
        height={dims.h}
        backgroundColor="#111827"
        nodeLabel="label"
        nodeColor={(n) => n.color}
        nodeRelSize={5}
        linkColor={(l) => l.isKw ? 'rgba(251,191,36,0.4)' : 'rgba(99,102,241,0.4)'}
        linkWidth={(l) => l.isKw ? 1 : 1.5}
        onNodeClick={handleNodeClick}
        nodeCanvasObject={(node, ctx, globalScale) => {
          const label = node.label;
          const sz = node.isType ? 10 : 6;
          ctx.beginPath();
          if (node.isType) {
            ctx.rect(node.x - sz / 2, node.y - sz / 2, sz, sz);
          } else {
            ctx.arc(node.x, node.y, sz / 2, 0, 2 * Math.PI);
          }
          ctx.fillStyle = node.color;
          ctx.fill();
          ctx.strokeStyle = node.isType ? '#fff' : '#6366f1';
          ctx.lineWidth = 1.5;
          ctx.stroke();
          if (globalScale > 1.5 || node.isType) {
            ctx.font = `${node.isType ? 10 : 8}px sans-serif`;
            ctx.textAlign = 'center';
            ctx.fillStyle = '#d1d5db';
            ctx.fillText(label?.substring(0, 20), node.x, node.y + sz + 4);
          }
        }}
      />
      <div className="absolute top-2 left-2 font-pixel text-[9px] text-white/40 pointer-events-none">
        KNOWLEDGE GRAPH · {notes.length} NODES
      </div>
    </div>
  );
};

// ─── ArXiv 检索面板 ────────────────────────────────────────────────────────────
const ArxivPanel = () => {
  const { arxivResults, setArxivResults, arxivQuery, setArxivQuery, setPdfFile } = useStore();
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
    window.open(url, '_blank');
  };

  return (
    <div className="flex flex-col h-full">
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
                <Download size={10} /> 下载 PDF
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
const ChatMessage = ({ msg }) => {
  const isUser = msg.role === 'user';
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
          <div className="text-[9px] font-pixel mb-1.5 opacity-70 uppercase tracking-wider border-b border-current pb-1 inline-block">
            {meta.label}_BOT
          </div>
        )}
        <p className="leading-relaxed whitespace-pre-wrap">{msg.content}</p>
        {msg.relatedNotes?.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5 pt-1.5 border-t border-dashed border-gray-300">
            {msg.relatedNotes.map((n) => (
              <span key={n.note_id ?? n} className="text-[9px] bg-yellow-50 border border-yellow-300 px-1.5 py-0.5 text-yellow-800 flex items-center gap-1 cursor-pointer hover:bg-yellow-100">
                <BookOpen size={8} />
                {n.concept ?? n}
                {n.page_num ? ` · p.${n.page_num}` : ''}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

// ─── 聊天面板 ──────────────────────────────────────────────────────────────────
const ChatPanel = () => {
  const { messages, addMessage, isAgentThinking, setAgentThinking } = useStore();
  const [input, setInput] = useState('');
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isAgentThinking]);

  const sendMessage = async () => {
    const text = input.trim();
    if (!text || isAgentThinking) return;
    setInput('');

    addMessage({ id: Date.now(), role: 'user', content: text });
    setAgentThinking(true);

    try {
      // Seeker 步骤
      addMessage({ id: Date.now() + 1, role: 'agent', agentType: 'seeker', content: `正在检索知识库中与「${text}」相关的原子卡片…` });

      const data = await api.searchNotes(text, 3);
      const results = data.results ?? [];

      const seekerReply = results.length > 0
        ? `发现 ${results.length} 个相关知识原子：\n${results.map((r, i) => `${i + 1}. [${r.concept}] (p.${r.page_num}) — ${r.summary?.substring(0, 60)}…`).join('\n')}`
        : '知识库当前为空，建议先上传并解析 PDF 文献。';

      addMessage({
        id: Date.now() + 2,
        role: 'agent',
        agentType: 'seeker',
        content: seekerReply,
        relatedNotes: results.slice(0, 3),
      });

      // Synthesizer 步骤：通过后端翻译接口生成摘要
      if (results.length > 0) {
        const context = results.map((r, i) => `${i + 1}. [${r.concept}] ${r.summary}`).join('\n');
        try {
          const synthData = await api.translateText(
            `请用学术语言综合分析以下知识原子，回答问题「${text}」：\n${context}`,
            'zh'
          );
          addMessage({
            id: Date.now() + 3,
            role: 'agent',
            agentType: 'synthesizer',
            content: synthData.translation ?? `已从 ${results.length} 个知识原子完成信息聚合，建议进一步阅读原文。`,
          });
        } catch {
          addMessage({
            id: Date.now() + 3,
            role: 'agent',
            agentType: 'synthesizer',
            content: `已从 ${results.length} 个知识原子完成信息聚合，建议查看上方引用的相关卡片。`,
          });
        }
      }
    } catch (e) {
      addMessage({
        id: Date.now() + 4,
        role: 'agent',
        agentType: 'system',
        content: `⚠️ 检索遇到问题: ${e instanceof Error ? e.message : String(e)}`,
      });
    } finally {
      setAgentThinking(false);
    }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
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

      <div className="p-3 border-t border-gray-200 flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && sendMessage()}
          placeholder="向 Seeker 提问，或 Enter 发送..."
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

// ─── 原子卡片面板（带 API 查询） ────────────────────────────────────────────────
const NexusPanel = () => {
  const {
    notes, addNote, removeNote, setNotes,
    searchQuery, setSearchQuery,
    searchStatus, setSearchStatus,
    searchResults, setSearchResults,
    pdfFile,
  } = useStore();

  const [activeTab, setActiveTab] = useState('deck'); // 'deck' | 'graph'
  const [loadingDelete, setLoadingDelete] = useState(null);

  // 从后端同步笔记
  useEffect(() => {
    api.getNotes()
      .then((data) => {
        if (data.notes?.length > 0) setNotes(data.notes);
      })
      .catch(() => {}); // 后端未启动时静默处理
  }, []);

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
      // 降级：本地过滤
      const localResults = notes.filter((n) =>
        n.content?.toLowerCase().includes(searchQuery.toLowerCase())
      );
      setSearchResults(localResults.map((n) => ({ ...n, note_id: n.id, summary: n.content, concept: n.type, page_num: n.page })));
      setSearchStatus('done');
    }
    setTimeout(() => setSearchStatus('idle'), 3000);
  };

  const handleDelete = async (id) => {
    setLoadingDelete(id);
    try {
      await api.deleteNote(id);
    } catch {}
    removeNote(id);
    setLoadingDelete(null);
  };

  const displayNotes = searchStatus === 'done' && searchResults.length > 0
    ? searchResults.map((r) => notes.find((n) => n.id === r.note_id) ?? { id: r.note_id, content: r.summary, type: 'idea', page: r.page_num, keywords: r.keywords })
    : notes;

  return (
    <div className="flex flex-col h-full">
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

      {/* 搜索可视化 */}
      <AnimatePresence>
        {searchStatus !== 'idle' && (
          <div className="px-3 pt-3">
            <SearchVisualizer status={searchStatus} query={searchQuery} />
          </div>
        )}
      </AnimatePresence>

      {/* 标签页切换 */}
      <div className="flex border-b border-gray-200 px-3 pt-2 gap-3">
        <button
          onClick={() => setActiveTab('deck')}
          className={clsx('pb-2 text-xs font-bold border-b-2 transition-colors flex items-center gap-1',
            activeTab === 'deck' ? 'border-blue-600 text-blue-700' : 'border-transparent text-gray-500 hover:text-gray-700')}
        >
          <Layers size={12} /> 原子卡片 ({displayNotes.length})
        </button>
        <button
          onClick={() => setActiveTab('graph')}
          className={clsx('pb-2 text-xs font-bold border-b-2 transition-colors flex items-center gap-1',
            activeTab === 'graph' ? 'border-purple-600 text-purple-700' : 'border-transparent text-gray-500 hover:text-gray-700')}
        >
          <Network size={12} /> 知识图谱
        </button>
      </div>

      {/* 内容区 */}
      <div className="flex-1 overflow-y-auto custom-scrollbar">
        {activeTab === 'deck' && (
          <div className="p-3 space-y-3">
            {displayNotes.length === 0 && (
              <div className="text-center text-gray-400 mt-10 flex flex-col items-center gap-3">
                <Sparkles size={28} className="opacity-30" />
                <p className="text-xs font-pixel">原子知识库为空</p>
                <p className="text-[10px] text-gray-400 max-w-[200px] leading-relaxed">
                  在 PDF 中选中文字后点击「CRUSH IT」创建原子卡片
                </p>
              </div>
            )}
            <AnimatePresence>
              {displayNotes.map((note) => (
                <NoteCard key={note.id} note={note} onDelete={handleDelete} />
              ))}
            </AnimatePresence>
          </div>
        )}
        {activeTab === 'graph' && (
          <GraphView notes={notes} />
        )}
      </div>
    </div>
  );
};

// ─── 主组件 ────────────────────────────────────────────────────────────────────
export const MiddleColumn = () => {
  const { viewMode } = useStore();

  return (
    <div className="h-full flex flex-col bg-gray-50/50 overflow-hidden">
      {/* 根据 viewMode 显示不同面板 */}
      {viewMode === 'chat' ? (
        <ChatPanel />
      ) : viewMode === 'arxiv' ? (
        <ArxivPanel />
      ) : (
        <NexusPanel />
      )}
    </div>
  );
};
