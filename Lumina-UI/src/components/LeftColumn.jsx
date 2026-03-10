import React, { useState, useRef, useEffect } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/esm/Page/AnnotationLayer.css';
import 'react-pdf/dist/esm/Page/TextLayer.css';
import { useStore } from '../store/useStore';
import { Highlighter, Type, Sparkles, MessageSquare } from 'lucide-react';
import { createPortal } from 'react-dom';

// Load PDF worker
pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

export const LeftColumn = () => {
  const { pdfFile, currentPage, setCurrentPage, addHighlight, activeReference } = useStore();
  const [numPages, setNumPages] = useState(null);
  const [selection, setSelection] = useState(null);
  const containerRef = useRef(null);
  const pageRef = useRef(null);
  
  // Effect: Scroll to active reference
  useEffect(() => {
    if (activeReference && activeReference.page === currentPage && containerRef.current) {
        // Simple scroll logic (mock implementation for bbox)
        // If bbox provided [x, y, w, h]
        // containerRef.current.scrollTo({ top: activeReference.bbox[1], behavior: 'smooth' });
    }
  }, [activeReference, currentPage]);
  
  const onDocumentLoadSuccess = ({ numPages }) => {
    setNumPages(numPages);
  };

  const handleMouseUp = () => {
    const sel = window.getSelection();
    if (sel && sel.toString().length > 0) {
      const range = sel.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      
      // Calculate position relative to viewport or container
      // For floating toolbar
      setSelection({
        text: sel.toString(),
        bbox: {
            x: rect.x + window.scrollX, 
            y: rect.y + window.scrollY - 40,
            width: rect.width,
            height: rect.heading
        }, // Simplified bbox for UI
      });
    } else {
      setSelection(null);
    }
  };

  const handleAction = (action) => {
    console.log(`Action: ${action} on text: "${selection?.text}"`);
    if (action === 'highlight') {
        addHighlight({
            page: currentPage,
            text: selection.text,
            color: 'yellow',
            id: Date.now()
        });
        setSelection(null);
    }
    // Implement other actions (Translate, Ask AI, Extract Atomic Note) -> likely open modal or call API
  };

  return (
    <div 
        ref={containerRef}
        className="h-full overflow-y-auto bg-gray-50 relative p-4 flex justify-center"
        onMouseUp={handleMouseUp}
    >
      <div className="w-full max-w-[800px] bg-white shadow-lg min-h-[1000px]">
        {/* PDF Renderer */}
        <Document
            file={pdfFile || 'https://arxiv.org/pdf/1706.03762.pdf'} // Default fallback
            onLoadSuccess={onDocumentLoadSuccess}
            className="flex flex-col items-center"
        >
            <Page 
                pageNumber={currentPage} 
                renderTextLayer={true} 
                renderAnnotationLayer={true}
                height={window.innerHeight} // Make it fill nicely or use width
                scale={1.2}
            />
        </Document>
      </div>

      {/* Floating Toolbar */}
      {selection && createPortal(
        <div 
            className="fixed bg-white shadow-xl rounded-full px-2 py-1 flex items-center gap-1 border border-gray-100 z-50 animate-in fade-in zoom-in-95 duration-200"
            style={{ 
                top: Math.max(10, selection.bbox.y), // Ensure visible
                left: selection.bbox.x 
            }}
        >
            <button onClick={() => handleAction('highlight')} className="p-2 hover:bg-yellow-50 rounded-full text-yellow-600 transition-colors" title="Highlight">
                <Highlighter size={16} />
            </button>
            <div className="w-px h-4 bg-gray-200 mx-1" />
            <button onClick={() => handleAction('translate')} className="p-2 hover:bg-blue-50 rounded-full text-blue-600 transition-colors" title="Translate">
                <Type size={16} />
            </button>
            <button onClick={() => handleAction('ask-ai')} className="p-2 hover:bg-purple-50 rounded-full text-purple-600 transition-colors" title="Ask AI">
                <MessageSquare size={16} />
            </button>
            <div className="w-px h-4 bg-gray-200 mx-1" />
            <button onClick={() => handleAction('extract')} className="flex items-center gap-2 px-3 py-1.5 bg-black text-white hover:bg-gray-800 rounded-full text-xs font-medium transition-colors shadow-sm" title="Extract Atomic Note">
                <Sparkles size={12} className="text-yellow-300" />
                Atomic Note
            </button>
        </div>,
        document.body
      )}
      
      {/* Pagination Controls (Floating at bottom-left) */}
      <div className="fixed bottom-6 left-6 bg-white/90 backdrop-blur border border-gray-200 rounded-lg shadow-sm px-4 py-2 flex items-center gap-4 text-sm z-40">
        <button onClick={() => setCurrentPage(Math.max(1, currentPage - 1))} disabled={currentPage <= 1} className="hover:bg-gray-100 p-1 rounded disabled:opacity-50">Prev</button>
        <span className="font-mono text-gray-600">Page {currentPage} of {numPages || '--'}</span>
        <button onClick={() => setCurrentPage(Math.min(numPages, currentPage + 1))} disabled={currentPage >= numPages} className="hover:bg-gray-100 p-1 rounded disabled:opacity-50">Next</button>
      </div>
    </div>
  );
};
