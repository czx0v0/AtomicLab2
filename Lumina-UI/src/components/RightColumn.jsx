import React, { useEffect, useState, useRef } from 'react';
import { Bold, Italic, List, Quote, Code, BookOpen, ExternalLink, ChevronLeft, ChevronRight, Sparkles, FileText, Minimize2, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { useStore } from '../store/useStore';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import clsx from 'clsx';
import { motion, AnimatePresence } from 'framer-motion';

const RecommendationDrawer = ({ isOpen, setIsOpen }) => {
  const { notes, setActiveReference, markdownContent } = useStore();
  
  // Mock logic: Show notes related to current content (simple contains)
  const relatedNotes = notes.filter(n => 
      markdownContent.toLowerCase().includes(n.content.substring(0, 10).toLowerCase()) || 
      markdownContent.includes(`Note ${n.id}`)
  );
  
  // Or just show all if none matched
  const displayNotes = relatedNotes.length > 0 ? relatedNotes : notes.slice(0, 2);

  return (
    <motion.div 
       initial={{ width: 0 }}
       animate={{ width: isOpen ? 250 : 0 }}
       className="h-full border-r border-gray-200 bg-yellow-50 overflow-hidden flex flex-col shrink-0 relative z-20"
    >
       <div className="p-3 border-b border-yellow-200 flex items-center justify-between bg-yellow-100 min-w-[250px]">
           <span className="text-xs font-bold text-yellow-800 flex items-center gap-2 font-pixel">
               <Sparkles size={12} />
               BRAINSTORM
           </span>
           <button onClick={() => setIsOpen(false)} className="hover:bg-yellow-200 p-1 rounded">
               <ChevronLeft size={14} className="text-yellow-700" />
           </button>
       </div>
       
       <div className="flex-1 overflow-y-auto p-3 space-y-3 min-w-[250px]">
           {displayNotes.map(note => (
               <div 
                  key={note.id}
                  className="bg-white border border-yellow-300 p-2 shadow-sm rounded text-xs cursor-pointer hover:shadow-md transition-shadow group"
                  onClick={() => alert(`Insert: [@Note-${note.id}]`)}
                  draggable
               >
                   <div className="flex justify-between mb-1">
                       <span className="font-bold text-gray-700">#{note.type}</span>
                       <span className="bg-gray-100 px-1 rounded text-[10px] group-hover:bg-blue-100 group-hover:text-blue-600"
                             onClick={(e) => {
                                 e.stopPropagation();
                                 setActiveReference({ page: note.page, bbox: note.bbox });
                             }}
                       >
                           Pg.{note.page}
                       </span>
                   </div>
                   <p className="line-clamp-3 text-gray-600">{note.content}</p>
               </div>
           ))}
           {displayNotes.length === 0 && (
               <div className="text-center text-gray-400 text-xs mt-10 italic">
                   No relevant sparks found...
               </div>
           )}
       </div>
    </motion.div>
  );
};

export const RightColumn = () => {
  const { markdownContent, setMarkdownContent, citations, isZenMode, setActiveReference } = useStore();
  const [showPreview, setShowPreview] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const textAreaRef = useRef(null);
  
  // Auto-open drawer in Zen Mode
  useEffect(() => {
      if(isZenMode) setDrawerOpen(true);
  }, [isZenMode]);

  // Insert tool
  const insertText = (str) => {
      if(!textAreaRef.current) return;
      const start = textAreaRef.current.selectionStart;
      const end = textAreaRef.current.selectionEnd;
      const val = markdownContent;
      const newVal = val.substring(0, start) + str + val.substring(end);
      setMarkdownContent(newVal);
      // restore focus?
  };

  // Custom link renderer to handle [Page X] clicks
  const components = {
      a: ({ node, ...props }) => {
          // Check if link is our special type?
          // For now, react-markdown renders standard links.
          // If we write [Page 3](#), we can intercept.
          if (props.href && props.href.startsWith('#page-')) {
              const page = parseInt(props.href.replace('#page-', ''));
              return <span 
                        className="text-blue-600 bg-blue-50 px-1 rounded cursor-pointer hover:underline inline-flex items-center gap-0.5"
                        onClick={(e) => {
                            e.preventDefault(); 
                            setActiveReference({ page, bbox: [0,0,0,0] }); // Just jump page
                        }}
                     >
                        <BookOpen size={10} />
                        {props.children}
                     </span>
          }
          return <a {...props} className="text-blue-500 hover:underline" target="_blank" rel="noopener noreferrer" />
      }
  };

  return (
    <div className="flex h-full bg-white relative">
      {/* Sidebar Drawer (Zen Mode Recommendation) */}
      <RecommendationDrawer isOpen={drawerOpen} setIsOpen={setDrawerOpen} />

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0">
          {/* Toolbar */}
          <div className="flex items-center justify-between p-2 border-b border-gray-200 bg-gray-50 h-10 shrink-0">
            <div className="flex items-center gap-1">
                {!drawerOpen && (
                    <button onClick={() => setDrawerOpen(true)} className="mr-2 text-gray-400 hover:text-gray-600" title="Open Brainstorm">
                        <PanelLeftOpen size={16} />
                    </button>
                )}
                <button onClick={() => insertText('**Bold**')} className="p-1 hover:bg-gray-200 rounded text-gray-600"><Bold size={14} /></button>
                <button onClick={() => insertText('*Italic*')} className="p-1 hover:bg-gray-200 rounded text-gray-600"><Italic size={14} /></button>
                <div className="w-px h-4 bg-gray-300 mx-1" />
                <button onClick={() => insertText('> Quote')} className="p-1 hover:bg-gray-200 rounded text-gray-600"><Quote size={14} /></button>
                <button onClick={() => insertText('`Code`')} className="p-1 hover:bg-gray-200 rounded text-gray-600"><Code size={14} /></button>
                <button onClick={() => insertText('[Page 1](#page-1)')} className="p-1 hover:bg-gray-200 rounded text-gray-600 flex gap-1 items-center px-2 text-xs border border-gray-300 bg-white">
                    <BookOpen size={10} /> Ref
                </button>
            </div>
            
            <div className="flex items-center gap-2">
                <button 
                    onClick={() => setShowPreview(!showPreview)} 
                    className={clsx("text-xs font-bold px-3 py-1 rounded transition-colors border", showPreview ? "bg-blue-100 text-blue-700 border-blue-300" : "bg-white text-gray-600 border-gray-200 hover:bg-gray-100")}
                >
                    {showPreview ? "EDIT" : "PREVIEW"}
                </button>
            </div>
          </div>

          {/* Editor / Preview Area */}
          <div className="flex-1 relative overflow-hidden">
                {showPreview ? (
                    <div className="h-full overflow-y-auto p-8 prose prose-sm max-w-none prose-headings:font-bold prose-a:text-blue-600">
                        <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
                            {markdownContent}
                        </ReactMarkdown>
                    </div>
                ) : (
                    <textarea 
                        ref={textAreaRef}
                        className="w-full h-full resize-none p-8 focus:outline-none font-mono text-sm text-gray-800 leading-relaxed custom-scrollbar selection:bg-yellow-200"
                        value={markdownContent}
                        onChange={(e) => setMarkdownContent(e.target.value)}
                        placeholder="# Start your draft..."
                    />
                )}
          </div>
          
          {/* Status Bar */}
          <div className="h-6 border-t border-gray-200 bg-white px-3 flex items-center justify-between text-[10px] text-gray-400 font-mono">
              <span>Markdown Supported</span>
              <span>{markdownContent.length} chars</span>
          </div>
      </div>
    </div>
  );
};
