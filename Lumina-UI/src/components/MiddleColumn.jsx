import React, { useState, useRef, useEffect } from 'react';
import ForceGraph2D from 'react-force-graph-2d';
import { Share2, MessageSquare, Search, Award, FileText, User } from 'lucide-react';
import { useStore } from '../store/useStore';
import clsx from 'clsx';
import { motion } from 'framer-motion';

// --- Constant Data (Mock) ---

const TREE_DATA = {
  nodes: [
    { id: 'doc1', group: 'document', label: 'Attention Is All You Need', val: 20 },
    { id: 'sec1', group: 'section', label: '引言 (Introduction)', val: 10 },
    { id: 'sec2', group: 'section', label: '模型架构 (Architecture)', val: 10 },
    { id: 'note1', group: 'note', label: '自注意力机制', val: 5 },
    { id: 'note2', group: 'note', label: '多头注意力', val: 5 },
    { id: 'note3', group: 'note', label: '位置编码', val: 5 },
  ],
  links: [
    { source: 'doc1', target: 'sec1' },
    { source: 'doc1', target: 'sec2' },
    { source: 'sec2', target: 'note1' },
    { source: 'sec2', target: 'note2' },
    { source: 'sec2', target: 'note3' },
  ]
};

const NETWORK_DATA = {
  nodes: [
    { id: 'doc1', group: 'document', label: 'Transformer (2017)', val: 20 },
    { id: 'doc2', group: 'document', label: 'BERT (2018)', val: 15 },
    { id: 'doc3', group: 'document', label: 'GPT-3 (2020)', val: 15 },
    { id: 'note1', group: 'note', label: '自注意力', val: 8 },
    { id: 'note4', group: 'note', label: '掩码语言模型', val: 8 },
  ],
  links: [
    { source: 'doc2', target: 'doc1', label: '引用' },
    { source: 'doc3', target: 'doc1', label: '引用' },
    { source: 'doc1', target: 'note1', label: '包含' },
    { source: 'doc2', target: 'note4', label: '包含' },
    { source: 'note1', target: 'note4', label: '概念关联' },
  ]
};

const CHAT_HISTORY = [
  {
    id: 1,
    role: 'user',
    content: "RNN 和 Transformer 在处理序列数据时的核心区别是什么？",
    timestamp: "10:42 AM"
  },
  {
    id: 2,
    role: 'agent',
    agentType: 'search', // 'search' | 'reviewer'
    name: '检索助手',
    content: "正在扫描向量数据库... 发现 2 条关于 'seq-to-seq' 和 '递归' 的原子笔记。",
    citations: [
      { id: 'c1', title: '循环神经网络 (RNN)', page: 2, bbox: [100, 200, 300, 50] },
      { id: 'c2', title: 'Transformer 并行化', page: 6, bbox: [150, 400, 350, 60] }
    ],
    timestamp: "10:42 AM"
  },
  {
    id: 3,
    role: 'agent',
    agentType: 'reviewer',
    name: '学术评审',
    content: "根本性的转变是从序列递归到并行注意力。RNN 必须按步骤处理 token，阻碍了并行化。Transformer 使用自注意力机制来建模依赖关系，无论距离多远。",
    citations: [
      { id: 'c3', title: '注意力机制', page: 3, bbox: [100, 300, 400, 100] }
    ],
    timestamp: "10:43 AM"
  }
];

// --- Components ---

const PixelAvatar = ({ type }) => {
  const isSearch = type === 'search';
  return (
    <div className={clsx(
      "w-8 h-8 flex items-center justify-center border-2 border-black bg-white shadow-[2px_2px_0px_#000] shrink-0",
      isSearch ? "text-blue-600" : "text-purple-600"
    )}>
      {isSearch ? <Search size={16} /> : <Award size={16} />}
    </div>
  );
};

export const MiddleColumn = () => {
  const { setActiveReference } = useStore();
  const [graphMode, setGraphMode] = useState('tree'); // 'tree' | 'network'
  const [messages] = useState(CHAT_HISTORY);
  const containerRef = useRef(null);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });

  // Update Graph Dimensions
  useEffect(() => {
    if (!containerRef.current) return;
    const updateSize = () => {
        setDimensions({
            width: containerRef.current.offsetWidth,
            height: containerRef.current.offsetHeight
        });
    };
    
    const observer = new ResizeObserver(updateSize);
    observer.observe(containerRef.current);
    updateSize(); // Initial
    
    return () => observer.disconnect();
  }, []);

  const handleCitationClick = (cite) => {
    setActiveReference({
      page: cite.page,
      bbox: cite.bbox
    });
  };

  return (
    <div className="flex flex-col h-full bg-gray-50 border-r border-gray-200">
      
      {/* 1. Top Half: Knowledge Graph (50%) */}
      <div className="h-1/2 flex flex-col border-b-2 border-gray-200 bg-white relative overflow-hidden">
        {/* Toggle Bar */}
        <div className="absolute top-4 left-4 z-10 flex gap-2">
           <button 
             onClick={() => setGraphMode('tree')}
             className={clsx(
               "px-3 py-1.5 text-xs font-bold border-2 border-black shadow-[2px_2px_0px_0px_#000] transition-all active:translate-y-0.5 active:shadow-none flex items-center gap-2",
               graphMode === 'tree' ? "bg-amber-100" : "bg-white hover:bg-gray-50"
             )}
           >
             <FileText size={12} />
             文档树 (Doc Tree)
           </button>
           <button 
             onClick={() => setGraphMode('network')}
             className={clsx(
               "px-3 py-1.5 text-xs font-bold border-2 border-black shadow-[2px_2px_0px_0px_#000] transition-all active:translate-y-0.5 active:shadow-none flex items-center gap-2",
               graphMode === 'network' ? "bg-emerald-100" : "bg-white hover:bg-gray-50"
             )}
           >
             <Share2 size={12} />
             引文网络 (Citation Net)
           </button>
        </div>

        {/* Graph Canvas */}
        <div ref={containerRef} className="flex-1 w-full bg-[radial-gradient(#e5e7eb_1px,transparent_1px)] [background-size:16px_16px]">
          {dimensions.width > 0 && (
              <ForceGraph2D
                width={dimensions.width}
                height={dimensions.height}
                graphData={graphMode === 'tree' ? TREE_DATA : NETWORK_DATA}
                nodeLabel="label"
                nodeColor={node => {
                  if (node.group === 'document') return '#93c5fd'; // blue-300
                  if (node.group === 'section') return '#fcd34d'; // amber-300
                  return '#86efac'; // green-300
                }}
                nodeRelSize={6}
                linkColor={() => '#9ca3af'}
                linkDirectionalArrowLength={3.5}
                linkDirectionalArrowRelPos={1}
                cooldownTicks={100}
                enableNodeDrag={true}
                enableZoomInteraction={true}
              />
          )}
        </div>
      </div>

      {/* 2. Bottom Half: Retro Chat (50%) */}
      <div className="h-1/2 flex flex-col bg-[#f0f4f8] relative">
        <div className="flex-1 overflow-y-auto p-4 space-y-6">
          {messages.map((msg, idx) => (
            <motion.div 
                key={msg.id} 
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: idx * 0.1 }}
                className={clsx("flex gap-3", msg.role === 'user' ? "flex-row-reverse" : "flex-row")}
            >
              
              {/* Avatar */}
              {msg.role === 'user' ? (
                <div className="w-8 h-8 flex items-center justify-center border-2 border-black bg-gray-900 text-white shrink-0 shadow-[2px_2px_0px_#000]">
                  <User size={16} />
                </div>
              ) : (
                <PixelAvatar type={msg.agentType} />
              )}

              {/* Message Bubble */}
              <div className={clsx(
                "max-w-[85%] flex flex-col",
                msg.role === 'user' ? "items-end text-right" : "items-start"
              )}>
                {/* Agent Name Tag */}
                {msg.role !== 'user' && (
                  <span className="text-[10px] font-black uppercase tracking-widest text-gray-500 mb-1 ml-1">
                    {msg.name}
                  </span>
                )}

                {/* Content Card */}
                <div className={clsx(
                  "text-sm leading-relaxed p-3 border-2 border-black shadow-[4px_4px_0px_#000]",
                   msg.role === 'user' ? "bg-white" : "bg-white"
                )}>
                  <p className="text-gray-800 font-medium">{msg.content}</p>
                  
                  {/* Citations / Action Buttons */}
                  {msg.citations && msg.citations.length > 0 && (
                    <div className="mt-3 pt-2 border-t-2 border-dotted border-gray-300 flex flex-wrap gap-2">
                      {msg.citations.map((cite) => (
                        <button
                          key={cite.id}
                          onClick={() => handleCitationClick(cite)}
                          className="flex items-center gap-1 px-2 py-1 bg-blue-50 hover:bg-blue-100 border border-blue-200 hover:border-blue-400 text-blue-700 text-xs font-bold font-mono rounded-sm transition-colors group uppercase"
                        >
                          <span className="w-1.5 h-1.5 bg-blue-500 rounded-full group-hover:scale-125 transition-transform" />
                          [Page {cite.page}]
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          ))}
        </div>

        {/* Input Area */}
        <div className="p-4 bg-white border-t-2 border-black">
          <div className="flex gap-2 relative">
            <input 
              type="text" 
              placeholder="Ask the research swarm..." 
              className="flex-1 bg-gray-50 border-2 border-gray-300 px-4 py-2.5 text-sm focus:outline-none focus:border-black focus:shadow-[2px_2px_0px_#000] transition-all font-medium placeholder:text-gray-400"
            />
            <button className="px-5 py-2.5 bg-black text-white font-bold text-sm hover:bg-gray-800 border-2 border-black active:translate-y-0.5 active:shadow-none shadow-[2px_2px_0px_#4b5563] transition-all flex items-center gap-2">
              <span>SEND</span>
              <MessageSquare size={14} className="animate-pulse" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
