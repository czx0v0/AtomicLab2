import React, { useState, useEffect } from 'react';
import { useStore } from '../store/useStore';
import { useScreenshot } from '../hooks/useScreenshot';
import clsx from 'clsx';
import { Search, Brain, Layers, MessageSquare, User, Bot, Sparkles, BookOpen, ExternalLink, ArrowRight, MousePointer2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

// --- Components ---

const SearchVisualizer = ({ status, query }) => {
  const steps = [
    { id: 'tokenizing', label: '分词匹配', icon: Layers },
    { id: 'vector', label: '向量检索', icon: Brain },
    { id: 'fusion', label: 'RRF 重排', icon: Sparkles },
    { id: 'done', label: '完成', icon: ArrowRight },
  ];

  const getStepStatus = (stepId) => {
    const order = ['idle', 'tokenizing', 'vector', 'fusion', 'done'];
    const currentIdx = order.indexOf(status);
    const stepIdx = order.indexOf(stepId);
    if (currentIdx > stepIdx) return 'completed';
    if (currentIdx === stepIdx) return 'active';
    return 'pending';
  };

  if (status === 'idle') return null;

  return (
    <div className="w-full bg-blue-50 border-2 border-black p-4 font-pixel mb-4 animate-in slide-in-from-top-2 shadow-[4px_4px_0px_#000]">
      <div className="flex items-center justify-between mb-4 pb-2 border-b border-blue-200">
         <span className="text-[10px] text-blue-600 uppercase flex items-center gap-2">
            <span className="animate-pulse">●</span> SYS_STATUS: PROCESSING_QUERY
         </span>
         <span className="text-[10px] text-gray-500 truncate max-w-[150px]">"{query}"</span>
      </div>
      <div className="flex items-center justify-between gap-1">
        {steps.map((step) => {
           const st = getStepStatus(step.id);
           return (
             <div key={step.id} className={clsx(
                "flex-1 flex flex-col items-center gap-2 transition-all duration-300",
                st === 'active' && "scale-110",
                st === 'pending' && "opacity-40 grayscale"
             )}>
                <div className={clsx(
                    "w-8 h-8 flex items-center justify-center border-2 border-black bg-white shadow-[2px_2px_0px_#000] transition-colors rounded-none",
                    st === 'completed' && "bg-green-100 border-green-800",
                    st === 'active' && "bg-yellow-100 border-yellow-600 animate-bounce"
                )}>
                    <step.icon size={14} className={clsx(
                        st === 'completed' ? "text-green-800" : "text-gray-800"
                    )} />
                </div>
                <span className={clsx("text-[8px] uppercase tracking-tighter font-bold", st === 'active' ? "text-blue-600" : "text-gray-500")}>
                    {step.label}
                </span>
             </div>
           );
        })}
      </div>
    </div>
  );
};

const NoteCard = ({ note }) => {
  const { pdfFile, setActiveReference } = useStore();
  
  const { imageSrc: hookSrc, loading: hookLoading } = useScreenshot(
    note.screenshot ? null : pdfFile, 
    note.page, 
    note.bbox
  );
  
  const imageSrc = note.screenshot || hookSrc;
  const loading = !note.screenshot && hookLoading;
  
  const getTypeColor = (type) => {
      switch(type) {
          case 'method': return 'bg-cyan-100 text-cyan-900 border-cyan-800';
          case 'formula': return 'bg-purple-100 text-purple-900 border-purple-800';
          case 'idea': return 'bg-amber-100 text-amber-900 border-amber-800';
          default: return 'bg-gray-100 text-gray-900 border-gray-800';
      }
  };

  return (
    <motion.div 
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-white border-2 border-black shadow-[4px_4px_0px_#000] p-3 flex flex-col gap-3 group hover:-translate-y-1 hover:shadow-[6px_6px_0px_#000] transition-all duration-200 relative"
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-gray-100 pb-2">
          <span className={clsx("px-2 py-1 text-[10px] uppercase font-bold border-2 font-pixel", getTypeColor(note.type))}>
              {note.type}
          </span>
          <button 
             onClick={(e) => {
                 e.stopPropagation();
                 setActiveReference({ page: note.page, bbox: note.bbox });
             }}
             className="text-[10px] bg-gray-50 border border-gray-300 px-2 py-1 hover:bg-black hover:text-white flex items-center gap-1 cursor-pointer font-mono transition-colors rounded-sm"
          >
             <BookOpen size={10} />
             Page {note.page}
          </button>
      </div>

      {/* Content */}
      <div className="space-y-3">
         {/* Screenshot Preview */}
         <div className="w-full h-32 bg-gray-50 border-2 border-dashed border-gray-200 relative overflow-hidden flex items-center justify-center group-hover:border-blue-200 transition-colors">
             {loading ? (
                 <div className="flex flex-col items-center gap-2">
                    <div className="animate-spin w-4 h-4 border-2 border-black border-t-transparent rounded-full"/>
                    <span className="text-[10px] font-pixel text-gray-400">RENDERING...</span>
                 </div>
             ) : imageSrc ? (
                 <img src={imageSrc} alt="Preview" className="w-full h-full object-contain p-1" />
             ) : (
                 <div className="text-center p-4 opacity-50">
                    <Sparkles size={20} className="mx-auto mb-1" />
                    <span className="text-[10px] font-pixel">NO SIGNAL</span>
                 </div>
             )}
             
             {/* Bbox Indicator Overlay */}
             <div className="absolute inset-0 bg-blue-500/10 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none flex items-center justify-center">
                 <MousePointer2 className="text-blue-600 animate-bounce" size={24} />
             </div>
         </div>
         
         {/* Text */}
         <div className="space-y-1">
            <p className="text-xs font-bold text-gray-900 leading-relaxed font-sans">{note.content}</p>
            {note.translation && (
                <div className="text-xs text-gray-600 bg-gray-50 p-2 border-l-4 border-gray-300 italic font-serif">
                    {note.translation}
                </div>
            )}
         </div>
      </div>
    </motion.div>
  );
};

const ChatMessage = ({ msg }) => {
    const isUser = msg.role === 'user';
    return (
        <div className={clsx("flex gap-3 mb-6 w-full animate-in slide-in-from-bottom-2 duration-300", isUser ? "flex-row-reverse" : "flex-row")}>
            {/* Avatar */}
            <div className={clsx(
                "w-10 h-10 flex shrink-0 items-center justify-center border-2 border-black bg-white shadow-[3px_3px_0px_#000] overflow-hidden",
                isUser ? "bg-gray-900 text-white" : msg.agentType === 'critic' ? "bg-rose-100 text-rose-800" : "bg-cyan-100 text-cyan-800"
            )}>
                {isUser ? <User size={20} /> : msg.agentType === 'critic' ? <Bot size={20} /> : <Sparkles size={20} />}
            </div>

            {/* Bubble */}
            <div className={clsx(
                "relative p-3 max-w-[85%] text-sm border-2 border-black shadow-[4px_4px_0px_rgba(0,0,0,0.1)]",
                isUser ? "bg-black text-white rounded-tr-none rounded-bl-xl rounded-tl-xl rounded-br-xl" : "bg-white text-gray-800 rounded-tl-none rounded-tr-xl rounded-br-xl rounded-bl-xl"
            )}>
                {msg.agentType && (
                    <div className="text-[10px] font-pixel mb-1 opacity-70 uppercase tracking-wider border-b border-current pb-1 mb-2 inline-block">
                        {msg.agentType === 'critic' ? 'CRITICAL_REVIEWER_BOT' : 'RETRIEVAL_COMPANION_V2'}
                    </div>
                )}
                <p className="leading-relaxed whitespace-pre-wrap font-sans">{msg.content}</p>
                
                {/* Citations if any */}
                {msg.relatedNotes && msg.relatedNotes.length > 0 && (
                    <div className="mt-3 flex gap-2 flex-wrap pt-2 border-t border-dashed border-gray-300">
                        {msg.relatedNotes.map(nid => (
                            <span key={nid} className="text-[10px] bg-yellow-100 border border-yellow-300 px-1 py-0.5 text-yellow-800 flex items-center gap-1 cursor-pointer hover:bg-yellow-200">
                                <BookOpen size={8} /> Ref: {nid}
                            </span>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
};

export const MiddleColumn = () => {
  const { viewMode, notes, searchQuery, setSearchQuery, searchStatus, setSearchStatus, messages, addMessage } = useStore();
  const [inputText, setInputText] = useState('');

  const isChat = viewMode === 'chat';
  
  // Mock Search Simulation
  const handleSearch = (e) => {
    if (e.key === 'Enter' && searchQuery.trim()) {
        setSearchStatus('tokenizing');
        setTimeout(() => setSearchStatus('vector'), 800);
        setTimeout(() => setSearchStatus('fusion'), 1600);
        setTimeout(() => setSearchStatus('done'), 2400);
    }
  };

  const handleSendMessage = () => {
      if(!inputText.trim()) return;
      addMessage({
          id: Date.now(),
          role: 'user',
          content: inputText
      });
      setInputText('');
      // Simulate reply
      setTimeout(() => {
          addMessage({
              id: Date.now() + 1,
              role: 'agent',
              agentType: 'search',
              content: 'Acknowledgement received. Parsing query terms...'
          });
      }, 1000);
  };

  return (
    <div className="h-full flex flex-col bg-[#f8fafc] relative overflow-hidden">
        {/* Toggle / Header Area */}
        <div className="h-12 border-b border-gray-200 bg-white flex items-center justify-between px-4 shrink-0 shadow-sm z-10">
             <div className="flex items-center gap-2 text-sm font-bold text-gray-900 font-pixel uppercase tracking-tight">
                 {isChat ? <MessageSquare size={16} className="text-blue-600" /> : <Layers size={16} className="text-purple-600" />}
                 <span>{isChat ? "RPG Nexus Terminal" : "Atomic Deck"}</span>
             </div>
             
             {!isChat && (
                 <div className="text-[10px] text-gray-400 font-mono">
                     {notes.length} ATOMS LOADED
                 </div>
             )}
        </div>

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto p-4 relative custom-scrollbar">
            {isChat ? (
                // Chat Mode
                <div className="max-w-3xl mx-auto flex flex-col justify-end min-h-full pb-0">
                    <div className="flex-1 space-y-4">
                        {messages.map(msg => <ChatMessage key={msg.id} msg={msg} />)}
                    </div>
                </div>
            ) : (
                // Organize Mode (Kanban Stream)
                <div className="max-w-xl mx-auto space-y-6 pb-20">
                     {/* Search Visualizer */}
                     <div className="sticky top-0 z-20 bg-[#f8fafc] pb-2 pt-2">
                        <LinkInput 
                            value={searchQuery} 
                            onChange={setSearchQuery} 
                            onEnter={handleSearch}
                            placeholder="Type keyword to retrieve atomic notes..."
                        />
                     </div>
                     
                     <AnimatePresence>
                        {searchStatus !== 'idle' && (
                            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}>
                                <SearchVisualizer status={searchStatus} query={searchQuery} />
                            </motion.div>
                        )}
                     </AnimatePresence>
                     
                     {/* Card Stream */}
                     <div className="space-y-6">
                        {notes.map(note => (
                            <NoteCard key={note.id} note={note} />
                        ))}
                     </div>
                </div>
            )}
        </div>
        
        {/* Chat Input (Only in Chat Mode) */}
        {isChat && (
             <div className="p-4 bg-white border-t border-gray-300 shadow-lg z-20">
                 <div className="flex gap-2 max-w-3xl mx-auto">
                     <div className="relative flex-1">
                        <input 
                            value={inputText}
                            onChange={(e) => setInputText(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
                            className="w-full border-2 border-black p-3 pr-10 font-mono text-sm focus:outline-none focus:bg-blue-50 shadow-[4px_4px_0px_#000] placeholder:text-gray-400"
                            placeholder="Input command to Council..."
                        />
                        <div className="absolute right-2 top-3 animate-pulse text-green-500 font-pixel text-[10px]">
                            _
                        </div>
                     </div>
                     <button 
                        onClick={handleSendMessage}
                        className="px-6 bg-black text-white font-pixel text-xs border-2 border-transparent hover:bg-gray-800 shadow-[4px_4px_0px_#999] active:translate-y-1 active:shadow-none transition-all"
                     >
                         SEND
                     </button>
                 </div>
             </div>
        )}
    </div>
  );
};

const LinkInput = ({ value, onChange, onEnter, placeholder }) => (
    <div className="relative group">
        <div className="absolute inset-y-0 left-3 flex items-center pointer-events-none">
            <Search size={14} className="text-gray-400 group-focus-within:text-blue-500" />
        </div>
        <input 
            type="text"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={onEnter}
            placeholder={placeholder}
            className="w-full pl-9 pr-4 py-3 bg-white border-2 border-black focus:border-blue-600 focus:ring-0 text-sm focus:outline-none transition-colors font-mono placeholder:text-gray-300 shadow-[4px_4px_0px_#000] focus:translate-x-[1px] focus:translate-y-[1px] focus:shadow-[2px_2px_0px_#000]"
        />
        <div className="absolute right-3 top-3 text-[10px] bg-gray-100 px-1 border border-gray-300 text-gray-500 font-pixel">
            RET/
        </div>
    </div>
);
