import React, { useState, useRef, useEffect } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';
import { useStore } from '../store/useStore';
import { Highlighter, Type, Sparkles, AlertCircle } from 'lucide-react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';

// Load PDF worker
pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

export const LeftColumn = () => {
    const { pdfFile, setPdfFile, currentPage, setCurrentPage, addHighlight, activeReference, addNote } = useStore();
    const [numPages, setNumPages] = useState(null);
    const [pdfDocument, setPdfDocument] = useState(null);
    const [selection, setSelection] = useState(null);
    const [pageWidth, setPageWidth] = useState(600);
    const containerRef = useRef(null);
    const pageRef = useRef(null); // Ref for Page specific wrapper to get exact coords
    
    // Resize Observer for Responsive PDF
    useEffect(() => {
        if (!containerRef.current) return;
        
        const observer = new ResizeObserver(entries => {
            for (let entry of entries) {
                // Adjust width to fit container with some padding
                setPageWidth(Math.floor(entry.contentRect.width - 48)); 
            }
        });
        
        observer.observe(containerRef.current);
        return () => observer.disconnect();
    }, []);

    const onFileChange = (event) => {
        const file = event.target.files[0];
        if (file) {
            setPdfFile(file);
        }
    };
  
    // Effect: Scroll to active reference & Flash Bbox
    useEffect(() => {
        if (activeReference && activeReference.page === currentPage) {
             if (activeReference.bbox && activeReference.bbox.length === 4 && pageRef.current) {
                // Scroll Logic
                // We scroll the CONTAINER to the Top position of the highlight
                const y = activeReference.bbox[1];
                // Check if containerRef is valid, adjust scroll. 
                // Note: The y here is relative to the page. 
                // We must account for the page's position relative to container, usually 0 if it's the only page or we scroll to page element first.
                // Simplified: Just scroll container to y.
                containerRef.current.scrollTo({ top: y - 100, behavior: 'smooth' });
            }
        } else if (activeReference && activeReference.page !== currentPage) {
            // Auto Jump Page
            setCurrentPage(activeReference.page);
        }
    }, [activeReference, currentPage, setCurrentPage]);

    const onDocumentLoadSuccess = (pdf) => {
        setNumPages(pdf.numPages);
        setPdfDocument(pdf);
    };

    const handleMouseUp = () => {
        const sel = window.getSelection();
        // Check if selection is inside the page container
        if (sel && sel.toString().length > 0 && pageRef.current && pageRef.current.contains(sel.anchorNode)) {
            const range = sel.getRangeAt(0);
            const rect = range.getBoundingClientRect();
            const pageRect = pageRef.current.getBoundingClientRect();
            
            // Calculate coordinates relative to the PDF Page overlay area
            const relativeX = rect.left - pageRect.left;
            const relativeY = rect.top - pageRect.top;
            
            setSelection({
                text: sel.toString(),
                bbox: { // Relative PDF Page Coords (DOM pixels at current rendered scale)
                    x: relativeX, 
                    y: relativeY,
                    width: rect.width,
                    height: rect.height
                },
                screenPos: { // Absolute coords for floating toolbar
                    x: rect.left,
                    y: rect.top
                }
            });
        } else {
            setSelection(null);
        }
    };


    const handleAction = async (action) => {
        if (!selection) return;

        console.log(`Action: ${action}`);
        
        if (action === 'crush') {
            let screenshotUrl = null;
            
            // Generate Screenshot
            if (pdfDocument) {
                try {
                    const page = await pdfDocument.getPage(currentPage);
                    const unscaledViewport = page.getViewport({ scale: 1.0 });
                    // Calculate visual scale ratio: Rendered Width / Original PDF Width
                    // Note: We use the scale relative to the rendered pageWidth
                    const renderScale = pageWidth / unscaledViewport.width;
                    
                    // We want a high-quality screenshot (2x)
                    const screenshotScale = 2.0;
                    const viewport = page.getViewport({ scale: renderScale * screenshotScale });
                    
                    const canvas = document.createElement('canvas');
                    const context = canvas.getContext('2d');
                    canvas.height = viewport.height;
                    canvas.width = viewport.width;
                    
                    const renderContext = {
                        canvasContext: context,
                        viewport: viewport
                    };
                    await page.render(renderContext).promise;
                    
                    // Crop coordinates (Selection is in DOM pixels, which match renderScale 1x)
                    // We need to scale them up to matched the screenshotScale (2x)
                    const sx = selection.bbox.x * screenshotScale;
                    const sy = selection.bbox.y * screenshotScale;
                    const sw = selection.bbox.width * screenshotScale;
                    const sh = selection.bbox.height * screenshotScale;
                    
                    const cropCanvas = document.createElement('canvas');
                    cropCanvas.width = sw;
                    cropCanvas.height = sh;
                    const cropCtx = cropCanvas.getContext('2d');
                    cropCtx.drawImage(canvas, sx, sy, sw, sh, 0, 0, sw, sh);
                    screenshotUrl = cropCanvas.toDataURL();
                    
                } catch (e) {
                    console.error("Screenshot error:", e);
                }
            }

            const payload = {
                id: `note_${Date.now()}`,
                type: 'idea',
                content: selection.text,
                page: currentPage,
                bbox: [selection.bbox.x, selection.bbox.y, selection.bbox.width, selection.bbox.height], 
                screenshot: screenshotUrl,
                timestamp: new Date().toISOString()
            };
            
            console.log("Creating Atomic Note (Crush):", payload);
            if (addNote) addNote(payload);
            setSelection(null);
            
        } else if (action === 'highlight') {
            addHighlight({
                page: currentPage,
                text: selection.text,
                color: 'yellow',
                id: Date.now()
            });
            setSelection(null);
        } else if (action === 'translate') {
            alert(`AI Translation: ${selection.text.substring(0, 50)}... [Translated]`);
            setSelection(null);
        }
    };

    // Render Highlight Box Overlay
    const renderActiveHighlight = () => {
        if (!activeReference || activeReference.page !== currentPage || !activeReference.bbox) return null;
        
        // Assume bbox is [x, y, w, h] relative to page
        const [x, y, w, h] = activeReference.bbox;
        
        return (
            <motion.div
                initial={{ opacity: 0, scale: 1.1 }}
                animate={{ opacity: 0.5, scale: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.5, repeat: 3, repeatType: "reverse" }}
                className="absolute bg-yellow-400 mix-blend-multiply pointer-events-none z-20 border-2 border-red-500"
                style={{
                    left: x,
                    top: y,
                    width: w,
                    height: h,
                }}
            />
        );
    };

    return (
        <div 
            className="h-full flex flex-col bg-gray-50 relative"
        >
             {/* PDF Scroll Container */}
            <div 
                ref={containerRef}
                className="flex-1 overflow-y-auto p-4 flex justify-center custom-scrollbar"
                onMouseUp={handleMouseUp}
            >
                <div 
                    className="relative bg-white shadow-lg border-x border-gray-200"
                    style={{ minHeight: '800px', width: 'fit-content' }}
                >
                    {/* PDF Renderer */}
                    {!pdfFile && (
                        <div className="flex flex-col items-center justify-center h-[500px] w-[600px] text-gray-400 gap-4 font-pixel text-xs">
                            <p className="flex items-center gap-2 text-red-400">
                                    <AlertCircle size={14} /> NO SIGNAL - PDF NOT FOUND
                            </p>
                            <label className="px-4 py-3 bg-blue-600 text-white cursor-pointer hover:bg-blue-700 transition-colors border-2 border-black shadow-[4px_4px_0px_#000] active:translate-y-1 active:shadow-none uppercase tracking-widest">
                                <span>Upload Schema</span>
                                <input 
                                    type="file" 
                                    accept=".pdf" 
                                    onChange={onFileChange} 
                                    className="hidden" 
                                />
                            </label>
                            <p className="text-[10px] opacity-70 font-mono">SYSTEM DEFAULT: TARGET_NULL</p>
                        </div>
                    )}

                    {pdfFile && (
                        <div className="relative group" ref={pageRef}> 
                                {renderActiveHighlight()}
                                <Document
                                        file={pdfFile} 
                                        onLoadSuccess={onDocumentLoadSuccess}
                                        className="flex flex-col items-center"
                                        loading={<div className="p-10 font-pixel text-xs animate-pulse">Initializing Core...</div>}
                                >
                                        <Page 
                                                pageNumber={currentPage} 
                                                renderTextLayer={true} 
                                                renderAnnotationLayer={true}
                                                width={pageWidth}
                                                scale={1.0}
                                        />
                                </Document>
                        </div>
                    )}
                </div>
            </div>

            {/* Pixel Toolbar (Floating Portal) */}
            <AnimatePresence>
            {selection && (
                createPortal(
                        <motion.div 
                                initial={{ opacity: 0, scale: 0.9 }}
                                animate={{ opacity: 1, scale: 1 }}
                                exit={{ opacity: 0, scale: 0.9 }}
                                className="fixed bg-white border-2 border-black shadow-[4px_4px_0px_#000] p-1.5 flex items-center gap-2 z-50 font-pixel text-[10px]"
                                style={{ 
                                        top: Math.max(10, selection.screenPos.y - 45), 
                                        left: selection.screenPos.x 
                                }}
                        >
                                <button onClick={() => handleAction('translate')} className="px-2 py-1 hover:bg-blue-100 flex items-center gap-1 active:bg-blue-200 transition-colors text-blue-800 uppercase">
                                        <Type size={12} />
                                        Translate
                                </button>
                                <div className="w-0.5 h-4 bg-gray-200" />
                                <button onClick={() => handleAction('highlight')} className="px-2 py-1 hover:bg-yellow-100 flex items-center gap-1 active:bg-yellow-200 transition-colors text-yellow-800 uppercase">
                                        <Highlighter size={12} />
                                        Mark
                                </button>
                                <div className="w-0.5 h-4 bg-gray-200" />
                                <button onClick={() => handleAction('crush')} className="px-2 py-1 bg-pink-50 hover:bg-pink-100 flex items-center gap-1 active:bg-pink-200 transition-colors text-pink-600 font-bold border border-pink-200 uppercase animate-pulse">
                                        <Sparkles size={12} />
                                        CRUSH IT
                                </button>
                        </motion.div>,
                        document.body
                )
            )}
            </AnimatePresence>

            {/* Pixel Pagination Controls (Fixed Bottom Left) */}
            <div className="absolute bottom-6 left-6 bg-white border-2 border-black shadow-[4px_4px_0px_#000] px-4 py-2 flex items-center gap-4 text-xs z-40 font-pixel transform transition-transform hover:scale-105 origin-bottom-left">
                <button onClick={() => setCurrentPage(Math.max(1, currentPage - 1))} disabled={currentPage <= 1} className="hover:bg-gray-100 px-2 py-1 active:translate-y-1 disabled:opacity-50 text-blue-600 uppercase border border-transparent hover:border-gray-300">Prev</button>
                <span className="text-gray-800">PAGE {currentPage} / {numPages || '--'}</span>
                <button onClick={() => setCurrentPage(Math.min(numPages, currentPage + 1))} disabled={currentPage >= numPages} className="hover:bg-gray-100 px-2 py-1 active:translate-y-1 disabled:opacity-50 text-blue-600 uppercase border border-transparent hover:border-gray-300">Next</button>
            </div>
        </div>
    );
};
