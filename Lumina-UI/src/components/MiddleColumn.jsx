import React from 'react';
import { Network, Sparkles, MessageCircle } from 'lucide-react';
import { useStore } from '../store/useStore';

export const MiddleColumn = () => {
  const { setActiveReference } = useStore();

  const handlePageLinkClick = () => {
    setActiveReference({ 
        page: 3, 
        bbox: [100, 200, 300, 50] // Mock coordinates
    });
  };

  return (
    <div className="flex flex-col h-full bg-gray-50 border-l border-gray-200 shadow-inner relative overflow-hidden">
      {/* Top: Graph Canvas Placeholder */}
      <div className="flex-1 bg-white relative p-4 bg-[url('/grid-pattern.svg')]">
        <div className="absolute inset-0 flex items-center justify-center opacity-10 pointer-events-none">
          <Network size={120} />
        </div>
        <div className="absolute top-4 left-4 bg-white/80 backdrop-blur px-3 py-1 rounded-full border border-gray-200 text-xs font-mono text-gray-500 shadow-sm flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
            GraphRAG Active
        </div>
        {/* Placeholder Nodes */}
        <div className="absolute top-1/3 left-1/4 w-12 h-12 bg-blue-100 rounded-full border-2 border-blue-500 flex items-center justify-center shadow-lg transform hover:scale-110 transition-transform cursor-pointer">
            <span className="text-xs font-bold text-blue-700">RAG</span>
        </div>
        <div className="absolute top-1/2 right-1/3 w-10 h-10 bg-purple-100 rounded-full border-2 border-purple-500 flex items-center justify-center shadow-md transform hover:scale-110 transition-transform cursor-pointer">
            <span className="text-xs font-bold text-purple-700">LLM</span>
        </div>
        {/* Connection Line (SVG) */}
        <svg className="absolute inset-0 pointer-events-none w-full h-full">
            <line x1="25%" y1="33%" x2="66%" y2="50%" stroke="#CBD5E1" strokeWidth="2" strokeDasharray="4" />
        </svg>
      </div>

      {/* Bottom: RPG Agent Chat */}
      <div className="h-1/3 border-t border-gray-200 bg-white flex flex-col">
        <div className="flex-1 p-4 overflow-y-auto space-y-3">
            {/* AI Message */}
            <div className="flex gap-3">
                <div className="w-8 h-8 bg-indigo-100 rounded-lg border border-indigo-200 flex items-center justify-center shrink-0">
                    <Sparkles size={16} className="text-indigo-600" />
                </div>
                <div className="bg-gray-100 rounded-2xl rounded-tl-none px-4 py-2 text-sm text-gray-700 shadow-sm max-w-[90%]">
                    Found 3 related papers on <span className="font-semibold text-gray-900">Transformer Architecture</span>. Check <button onClick={handlePageLinkClick} className="inline-flex items-center px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 text-xs font-medium hover:bg-blue-200 transition-colors mx-1">[Page 3]</button> for details.
                </div>
            </div>
            
             {/* User Message */}
             <div className="flex gap-3 flex-row-reverse">
                <div className="w-8 h-8 bg-gray-200 rounded-lg flex items-center justify-center shrink-0">
                    <span className="text-xs font-bold text-gray-600">ME</span>
                </div>
                <div className="bg-blue-600 text-white rounded-2xl rounded-tr-none px-4 py-2 text-sm shadow-md max-w-[90%]">
                    Can you explain the attention mechanism?
                </div>
            </div>
        </div>
        
        {/* Input Area */}
        <div className="p-3 border-t border-gray-100 bg-gray-50 flex gap-2">
            <input 
                type="text" 
                placeholder="Ask your AI research assistant..." 
                className="flex-1 bg-white border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
            />
            <button className="p-2 bg-black text-white rounded-lg hover:bg-gray-800 transition-colors shadow-sm">
                <MessageCircle size={18} />
            </button>
        </div>
      </div>
    </div>
  );
};

