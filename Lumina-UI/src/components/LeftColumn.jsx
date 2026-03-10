import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';
import { useStore } from '../store/useStore';
import { Highlighter, Type, Sparkles, AlertCircle, Languages, Palette, BookOpen, Tag, FolderOpen, ChevronDown, ChevronUp, Trash2, FileText, ListTree, Camera, ZoomIn, ZoomOut, RotateCcw } from 'lucide-react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import * as api from '../api/client';

// Load PDF worker
pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

export const LeftColumn = () => {
    const {
        pdfFile, pdfUrl, setPdfUrl, setPdfFile, currentPage, setCurrentPage,
        addHighlight, highlights, activeReference, addNote, library, addToLibrary,
        removeFromLibrary, pdfFileName, parseStatus, parseProgress, parsedMarkdown,
        parsedSections, parsedDocName, setParseStatus, addParseLog, setParsedMarkdown,
        addParsedSection, updateParsedSectionSummary, clearParseState,
        notes, setActiveReference
    } = useStore();
    const [numPages, setNumPages] = useState(null);
    const [pdfDocument, setPdfDocument] = useState(null);
    const [selection, setSelection] = useState(null);
    const [pageWidth, setPageWidth] = useState(600);
    const [highlightColor, setHighlightColor] = useState('yellow');
    const [translating, setTranslating] = useState(false);
    const [translationResult, setTranslationResult] = useState(null);
    const [showLibrary, setShowLibrary] = useState(false);
    const [contentMode, setContentMode] = useState('pdf'); // pdf | markdown | outline
    const [toolMode, setToolMode] = useState('text'); // text | screenshot
    const [pageScale, setPageScale] = useState(1.0);
    const [shotDraft, setShotDraft] = useState(null);
    const containerRef = useRef(null);
    const pageRef = useRef(null);

    const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

    const onScreenshotPointerDown = (e) => {
        if (contentMode !== 'pdf' || toolMode !== 'screenshot' || !pageRef.current) return;
        const rect = pageRef.current.getBoundingClientRect();
        const x = clamp(e.clientX - rect.left, 0, rect.width);
        const y = clamp(e.clientY - rect.top, 0, rect.height);
        setSelection(null);
        setShotDraft({
            startX: x,
            startY: y,
            x,
            y,
            width: 0,
            height: 0,
            dragging: true,
        });
    };

    const onScreenshotPointerMove = (e) => {
        if (contentMode !== 'pdf' || toolMode !== 'screenshot' || !shotDraft?.dragging || !pageRef.current) return;
        const rect = pageRef.current.getBoundingClientRect();
        const currX = clamp(e.clientX - rect.left, 0, rect.width);
        const currY = clamp(e.clientY - rect.top, 0, rect.height);

        const x = Math.min(currX, shotDraft.startX);
        const y = Math.min(currY, shotDraft.startY);
        const width = Math.abs(currX - shotDraft.startX);
        const height = Math.abs(currY - shotDraft.startY);
        setShotDraft((d) => d ? { ...d, x, y, width, height } : d);
    };

    const onScreenshotPointerUp = async () => {
        if (contentMode !== 'pdf' || toolMode !== 'screenshot' || !shotDraft) return;
        const minSize = 8;
        if (shotDraft.width >= minSize && shotDraft.height >= minSize) {
            const bbox = {
                x: shotDraft.x,
                y: shotDraft.y,
                width: shotDraft.width,
                height: shotDraft.height,
            };
            const normBbox = toNormalizedBbox(bbox);
            addHighlight({
                page: currentPage,
                text: '[截图高亮]',
                color: highlightColor,
                bbox: normBbox,
                id: Date.now(),
            });

            // 截取选区图像并自动创建原子笔记
            let screenshotUrl = null;
            if (pdfDocument && pageRef.current) {
                try {
                    const page = await pdfDocument.getPage(currentPage);
                    const unscaledVp = page.getViewport({ scale: 1.0 });
                    const renderScale = pageWidth / unscaledVp.width;
                    const capScale = 2.0;
                    const vp = page.getViewport({ scale: renderScale * capScale });
                    const cvs = document.createElement('canvas');
                    cvs.width = vp.width;
                    cvs.height = vp.height;
                    await page.render({ canvasContext: cvs.getContext('2d'), viewport: vp }).promise;
                    const sx = bbox.x * capScale;
                    const sy = bbox.y * capScale;
                    const sw = bbox.width * capScale;
                    const sh = bbox.height * capScale;
                    const crop = document.createElement('canvas');
                    crop.width = sw;
                    crop.height = sh;
                    crop.getContext('2d').drawImage(cvs, sx, sy, sw, sh, 0, 0, sw, sh);
                    screenshotUrl = crop.toDataURL();
                } catch (e) {
                    console.error('截图捕获失败:', e);
                }
            }

            const shotNote = {
                id: `note_${Date.now()}`,
                type: 'data',
                content: '[截图高亮]',
                page: currentPage,
                bbox: normBbox,
                screenshot: screenshotUrl,
                timestamp: new Date().toISOString(),
            };
            addNote(shotNote);
            api.createNote({
                content: shotNote.content,
                type: shotNote.type,
                page: shotNote.page,
                bbox: shotNote.bbox,
                screenshot: shotNote.screenshot,
            }).catch((e) => console.warn('截图笔记后端同步失败:', e));
        }
        setShotDraft(null);
    };

    const parsePercent = useMemo(() => {
        if (parseStatus === 'done') return 100;
        if (parseStatus === 'error') return 0;
        if (parseStatus !== 'parsing') return 0;

        let maxPct = 0;
        for (const log of parseProgress) {
            const m = String(log).match(/(\d{1,3})\s*%/);
            if (m) {
                maxPct = Math.max(maxPct, Math.min(99, Number(m[1])));
            }
        }
        if (maxPct > 0) return maxPct;
        if (parsedSections.length > 0) {
            return Math.min(95, 20 + parsedSections.length * 8);
        }
        return 10;
    }, [parseStatus, parseProgress, parsedSections.length]);

    const isNormalizedBbox = (bbox) => {
        if (!bbox) return false;
        const arr = Array.isArray(bbox) ? bbox : [bbox.x, bbox.y, bbox.width, bbox.height];
        return arr.every((v) => typeof v === 'number' && v >= 0 && v <= 1.2);
    };

    const toNormalizedBbox = (bbox) => {
        if (!pageRef.current) return [bbox.x, bbox.y, bbox.width, bbox.height];
        const rect = pageRef.current.getBoundingClientRect();
        return [
            bbox.x / Math.max(rect.width, 1),
            bbox.y / Math.max(rect.height, 1),
            bbox.width / Math.max(rect.width, 1),
            bbox.height / Math.max(rect.height, 1),
        ];
    };

    const fromStoredBbox = (bbox) => {
        if (!pageRef.current) {
            const arr = Array.isArray(bbox) ? bbox : [bbox.x, bbox.y, bbox.width, bbox.height];
            return { x: arr[0], y: arr[1], width: arr[2], height: arr[3] };
        }
        const arr = Array.isArray(bbox) ? bbox : [bbox.x, bbox.y, bbox.width, bbox.height];
        if (!isNormalizedBbox(arr)) {
            return { x: arr[0], y: arr[1], width: arr[2], height: arr[3] };
        }
        const rect = pageRef.current.getBoundingClientRect();
        return {
            x: arr[0] * rect.width,
            y: arr[1] * rect.height,
            width: arr[2] * rect.width,
            height: arr[3] * rect.height,
        };
    };
    
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

    useEffect(() => {
        api.listDocuments()
            .then((resp) => {
                const docs = resp.documents || [];
                docs.forEach((doc) => {
                    addToLibrary({
                        id: `local_${doc.id}`,
                        docId: doc.id,
                        fileUrl: api.getDocumentFileUrl(doc.id),
                        name: doc.name,
                        addedAt: doc.created_at,
                        source: 'local',
                        noteCount: 0,
                    });
                });
            })
            .catch(() => {});
    }, [addToLibrary]);

    const onFileChange = (event) => {
        const file = event.target.files[0];
        if (file) {
            setPdfFile(file);
            clearParseState();
            // 上传到后端文件库，确保切换/刷新后可恢复
            api.uploadDocument(file).then((doc) => {
                const fileUrl = api.getDocumentFileUrl(doc.id);
                setPdfUrl(fileUrl, doc.name, doc.id);
                addToLibrary({
                    id: `local_${doc.id}`,
                    docId: doc.id,
                    fileUrl,
                    name: doc.name,
                    addedAt: new Date().toISOString(),
                    source: 'local',
                    noteCount: 0,
                });
            }).catch(() => {});

            // 上传后立即触发 MinerU 解析，展示流式进度与 Markdown。
            setParseStatus('parsing');
            addParseLog(`开始解析: ${file.name}`);
            api.parsePDF(file, 'auto', (evt) => {
                if (evt.message) addParseLog(evt.message);
                if (evt.status === 'chunk') {
                    addParsedSection({
                        title: evt.section_title || 'Untitled',
                        summary: evt.section_summary || '',
                        content: evt.markdown_chunk || '',
                        imageRefs: evt.image_refs || [],
                    });
                }
                if (evt.status === 'summary') {
                    updateParsedSectionSummary(evt.section_title || '', evt.section_summary || '');
                }
                if (evt.markdown) {
                    setParsedMarkdown(evt.markdown, file.name);
                    api.indexDocument(`doc_${file.name}`, file.name, evt.markdown).catch(() => {});
                }
                if (evt.status === 'success') {
                    setParseStatus('done');
                    addParseLog('解析完成。');
                }
                if (evt.status === 'error') {
                    setParseStatus('error');
                }
            }).catch((e) => {
                setParseStatus('error');
                addParseLog(`解析失败: ${e instanceof Error ? e.message : String(e)}`);
            });
        }
    };

    const outline = parsedSections.length > 0
        ? parsedSections.map((s, idx) => ({
            level: 2,
            title: s.title,
            summary: s.summary,
            content: s.content,
            imageRefs: s.imageRefs || [],
            idx,
        }))
        : [];

    const textHighlights = highlights.map((h) => h.text).filter(Boolean);
    const renderTextWithHighlights = (text) => {
        if (!text || textHighlights.length === 0) return <span>{text}</span>;
        const escaped = textHighlights
            .filter((t) => t.length >= 2)
            .slice(0, 20)
            .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
        if (escaped.length === 0) return <span>{text}</span>;
        const regex = new RegExp(`(${escaped.join('|')})`, 'gi');
        const parts = String(text).split(regex);
        return (
            <>
                {parts.map((p, i) =>
                    i % 2 === 1
                        ? <mark key={`${p}-${i}`} className="bg-yellow-200/80 px-0.5">{p}</mark>
                        : <span key={`${p}-${i}`}>{p}</span>
                )}
            </>
        );
    };
  
    // Effect: Scroll to active reference & Flash Bbox
    useEffect(() => {
        if (activeReference && activeReference.page === currentPage) {
             if (activeReference.bbox && activeReference.bbox.length === 4 && pageRef.current) {
                const p = fromStoredBbox(activeReference.bbox);
                const y = p.y;
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

    // 点击空白区域时清除工具栏（mousedown 阶段，在 mouseup 之前）
    const handleMouseDown = useCallback((e) => {
        // 不清除：点击工具栏本身（portal 在 document.body 上，不会冒泡到此处）
        if (selection) {
            setSelection(null);
            setTranslationResult(null);
        }
    }, [selection]);

    const handleMouseUp = useCallback(() => {
        if (toolMode === 'screenshot') return;
        // 用 setTimeout 确保浏览器选区完全稳定（比 rAF 更可靠）
        setTimeout(() => {
            const sel = window.getSelection();
            const text = sel?.toString().trim() || '';
            // 只在有选中文本时设置，绝不在此处清除
            if (!text || !sel || sel.rangeCount === 0) return;

            const range = sel.getRangeAt(0);
            const rects = Array.from(range.getClientRects()).filter((r) => r.width > 0 && r.height > 0);
            if (rects.length === 0) return;

            const targetRect = rects[0];

            let relativeX = targetRect.left;
            let relativeY = targetRect.top;
            if (pageRef.current) {
                const pageRect = pageRef.current.getBoundingClientRect();
                relativeX = targetRect.left - pageRect.left;
                relativeY = targetRect.top - pageRect.top;
            }

            setSelection({
                text,
                bbox: { x: relativeX, y: relativeY, width: targetRect.width, height: targetRect.height },
                screenPos: { x: targetRect.left, y: targetRect.top },
            });
        }, 16);
    }, [toolMode]);


    const handleAction = async (action) => {
        if (!selection) return;

        if (action === 'crush') {
            let screenshotUrl = null;
            
            // Generate Screenshot
            if (pdfDocument) {
                try {
                    const page = await pdfDocument.getPage(currentPage);
                    const unscaledViewport = page.getViewport({ scale: 1.0 });
                    const renderScale = pageWidth / unscaledViewport.width;
                    const screenshotScale = 2.0;
                    const viewport = page.getViewport({ scale: renderScale * screenshotScale });
                    
                    const canvas = document.createElement('canvas');
                    const context = canvas.getContext('2d');
                    canvas.height = viewport.height;
                    canvas.width = viewport.width;
                    
                    await page.render({ canvasContext: context, viewport }).promise;
                    
                    const sx = selection.bbox.x * screenshotScale;
                    const sy = selection.bbox.y * screenshotScale;
                    const sw = selection.bbox.width * screenshotScale;
                    const sh = selection.bbox.height * screenshotScale;
                    
                    const cropCanvas = document.createElement('canvas');
                    cropCanvas.width = sw;
                    cropCanvas.height = sh;
                    cropCanvas.getContext('2d').drawImage(canvas, sx, sy, sw, sh, 0, 0, sw, sh);
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
                bbox: contentMode === 'pdf'
                    ? toNormalizedBbox(selection.bbox)
                    : [selection.bbox.x, selection.bbox.y, selection.bbox.width, selection.bbox.height],
                screenshot: screenshotUrl,
                timestamp: new Date().toISOString()
            };
            
            // 本地先加：快速反馈
            addNote(payload);
            setSelection(null);

            // 后端同步 + Crusher 自动分类
            try {
                const created = await api.createNote({
                    content: payload.content,
                    type: payload.type,
                    page: payload.page,
                    bbox: payload.bbox,
                    screenshot: payload.screenshot,
                });
                // 尝试通过翻译接口做 Crusher 分类（利用 DeepSeek 做简单分类）
                try {
                    const classifyResp = await api.translateText(
                        `请对以下学术文本片段进行知识类型分类，只返回一个词：方法/公式/定义/观点/数据/其他\n\n"${payload.content.substring(0, 200)}"`,
                        'zh'
                    );
                    const typeMap = { '方法': 'method', '公式': 'formula', '定义': 'definition', '观点': 'idea', '数据': 'data', '其他': 'other' };
                    const raw = classifyResp.translation?.replace(/[[\]Mock 翻译]/g, '').trim();
                    const detectedType = typeMap[raw] || null;
                    if (detectedType && detectedType !== payload.type) {
                        // 更新本地笔记类型
                        const notes = useStore.getState().notes;
                        useStore.getState().setNotes(notes.map(n => n.id === payload.id ? { ...n, type: detectedType } : n));
                    }
                } catch {}
            } catch (e) {
                console.warn("后端同步失败:", e);
            }
            
        } else if (action === 'highlight') {
            const hlBbox = contentMode === 'pdf'
                ? toNormalizedBbox(selection.bbox)
                : { ...selection.bbox };
            addHighlight({
                page: currentPage,
                text: selection.text,
                color: highlightColor,
                bbox: hlBbox,
                id: Date.now()
            });
            // 同时创建一条高亮笔记
            const hlNote = {
                id: `note_${Date.now()}`,
                type: 'idea',
                content: selection.text,
                page: currentPage,
                bbox: Array.isArray(hlBbox) ? hlBbox : [hlBbox.x, hlBbox.y, hlBbox.width, hlBbox.height],
                timestamp: new Date().toISOString(),
            };
            addNote(hlNote);
            api.createNote({
                content: hlNote.content,
                type: hlNote.type,
                page: hlNote.page,
                bbox: hlNote.bbox,
            }).catch((e) => console.warn('高亮笔记后端同步失败:', e));
            setSelection(null);
        } else if (action === 'translate') {
            setTranslating(true);
            setTranslationResult(null);
            try {
                const resp = await api.translateText(selection.text.substring(0, 2000));
                setTranslationResult(resp.translation);
                // 同时生成一条翻译笔记
                addNote({
                    id: `note_${Date.now()}`,
                    type: 'idea',
                    content: selection.text,
                    translation: resp.translation,
                    page: currentPage,
                    bbox: [selection.bbox.x, selection.bbox.y, selection.bbox.width, selection.bbox.height],
                    timestamp: new Date().toISOString()
                });
            } catch (e) {
                setTranslationResult(`翻译失败: ${e instanceof Error ? e.message : '后端未启动'}`);
            } finally {
                setTranslating(false);
            }
        } else if (action === 'annotate') {
            // 创建批注卡片
            const annotation = prompt('输入批注内容：');
            if (annotation) {
                addNote({
                    id: `note_${Date.now()}`,
                    type: 'idea',
                    content: `[批注] ${annotation}\n\n原文: ${selection.text.substring(0, 100)}...`,
                    page: currentPage,
                    bbox: [selection.bbox.x, selection.bbox.y, selection.bbox.width, selection.bbox.height],
                    timestamp: new Date().toISOString()
                });
            }
            setSelection(null);
        }
    };

    // Render saved highlight overlays for current page
    const renderHighlightOverlays = () => {
        const pageHighlights = highlights.filter(h => h.page === currentPage && h.bbox);
        return pageHighlights.map(h => {
            const colorMap = { yellow: 'bg-yellow-300', green: 'bg-green-300', blue: 'bg-blue-300', pink: 'bg-pink-300' };
            const p = fromStoredBbox(h.bbox);
            return (
                <div
                    key={h.id}
                    className={`absolute ${colorMap[h.color] || 'bg-yellow-300'} mix-blend-multiply pointer-events-none z-10 opacity-40`}
                    style={{ left: p.x, top: p.y, width: p.width, height: p.height }}
                    title={h.text?.substring(0, 50)}
                />
            );
        });
    };

    // Render active reference flash overlay
    const renderActiveHighlight = () => {
        if (!activeReference || activeReference.page !== currentPage || !activeReference.bbox) return null;
        
        const p = fromStoredBbox(activeReference.bbox);
        
        return (
            <motion.div
                initial={{ opacity: 0, scale: 1.1 }}
                animate={{ opacity: 0.5, scale: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.5, repeat: 3, repeatType: "reverse" }}
                className="absolute bg-yellow-400 mix-blend-multiply pointer-events-none z-20 border-2 border-red-500"
                style={{ left: p.x, top: p.y, width: p.width, height: p.height }}
            />
        );
    };

    return (
        <div 
            className="h-full flex flex-col bg-gray-50 relative"
        >
             {/* 文献库折叠面板 */}
             <div className="border-b border-gray-200 bg-white shrink-0">
                <button
                    onClick={() => setShowLibrary(!showLibrary)}
                    className="w-full flex items-center justify-between px-4 py-2 text-xs font-bold text-gray-600 hover:bg-gray-50"
                >
                    <span className="flex items-center gap-2">
                        <FolderOpen size={14} className="text-blue-600" />
                        文献库 ({library.length})
                    </span>
                    {showLibrary ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                </button>
                <AnimatePresence>
                    {showLibrary && (
                        <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: 'auto', opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            className="overflow-hidden"
                        >
                            <div className="px-3 pb-3 space-y-1 max-h-[200px] overflow-y-auto custom-scrollbar">
                                {library.length === 0 && (
                                    <p className="text-[10px] text-gray-400 text-center py-2">上传 PDF 或从 ArXiv 下载后自动加入</p>
                                )}
                                {library.map(doc => (
                                    <div
                                        key={doc.id}
                                        onClick={() => {
                                            if (doc.source === 'arxiv') {
                                                clearParseState();
                                                setPdfUrl(`https://arxiv.org/pdf/${doc.arxivId}.pdf`, doc.name);
                                            } else if (doc.source === 'local' && doc.docId) {
                                                clearParseState();
                                                setPdfUrl(doc.fileUrl || api.getDocumentFileUrl(doc.docId), doc.name, doc.docId);
                                            } else {
                                                alert("Local files cannot be restored automatically due to browser security. Please re-upload.");
                                            }
                                        }}
                                        className={`flex items-center gap-2 px-2 py-1.5 rounded text-xs cursor-pointer group transition-colors ${
                                            pdfFileName === doc.name ? 'bg-blue-50 text-blue-700 border border-blue-200' : 'hover:bg-gray-100 text-gray-600'
                                        }`}
                                    >
                                        <BookOpen size={11} className="shrink-0" />
                                        <span className="truncate flex-1">{doc.name}</span>
                                        <span className={`text-[9px] px-1 py-0.5 rounded ${doc.source === 'arxiv' ? 'bg-green-50 text-green-600' : 'bg-gray-100 text-gray-400'}`}>
                                            {doc.source === 'arxiv' ? 'ArXiv' : 'Local'}
                                        </span>
                                        <button
                                            onClick={(e) => { e.stopPropagation(); removeFromLibrary(doc.id); }}
                                            className="opacity-0 group-hover:opacity-100 p-0.5 hover:text-red-500"
                                        >
                                            <Trash2 size={10} />
                                        </button>
                                    </div>
                                ))}
                                {/* 上传按钮 */}
                                <label className="flex items-center justify-center gap-1 text-[10px] text-blue-600 hover:bg-blue-50 rounded py-1.5 cursor-pointer border border-dashed border-blue-200 mt-1">
                                    + 添加文献
                                    <input type="file" accept=".pdf" onChange={onFileChange} className="hidden" />
                                </label>
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>
             </div>

             {/* ✦ 像素风顶部工具栏 - 纯图标 */}
             <div className="border-b border-gray-200 bg-white px-2 py-1.5 shrink-0 flex items-center gap-1 font-pixel">
                <button
                    onClick={() => setContentMode('pdf')}
                    className={`p-1.5 rounded border transition-colors ${contentMode === 'pdf' ? 'bg-blue-50 border-blue-300 text-blue-700' : 'bg-gray-50 border-gray-200 text-gray-500 hover:bg-gray-100'}`}
                    title="PDF 原文"
                >
                    <span className="text-[10px] font-bold">✦ PDF</span>
                </button>
                <button
                    onClick={() => setContentMode('markdown')}
                    className={`p-1.5 rounded border transition-colors ${contentMode === 'markdown' ? 'bg-amber-50 border-amber-300 text-amber-700' : 'bg-gray-50 border-gray-200 text-gray-500 hover:bg-gray-100'}`}
                    title="Markdown 解析结果"
                >
                    <FileText size={13} />
                </button>
                <button
                    onClick={() => setContentMode('outline')}
                    className={`p-1.5 rounded border transition-colors ${contentMode === 'outline' ? 'bg-emerald-50 border-emerald-300 text-emerald-700' : 'bg-gray-50 border-gray-200 text-gray-500 hover:bg-gray-100'}`}
                    title="章节大纲 + 摘要"
                >
                    <ListTree size={13} />
                </button>
                {contentMode === 'pdf' && (
                    <>
                        <div className="w-px h-4 bg-gray-200 mx-0.5" />
                        <button
                            onClick={() => setToolMode('text')}
                            className={`p-1.5 rounded border transition-colors ${toolMode === 'text' ? 'bg-yellow-50 border-yellow-300 text-yellow-700 shadow-[2px_2px_0px_#000]' : 'bg-gray-50 border-gray-200 text-gray-500 hover:bg-gray-100'}`}
                            title="✦ 文本选取高亮"
                        >
                            <Highlighter size={13} />
                        </button>
                        <button
                            onClick={() => setToolMode('screenshot')}
                            className={`p-1.5 rounded border transition-colors ${toolMode === 'screenshot' ? 'bg-pink-50 border-pink-300 text-pink-700 shadow-[2px_2px_0px_#000]' : 'bg-gray-50 border-gray-200 text-gray-500 hover:bg-gray-100'}`}
                            title="✦ 截图选区"
                        >
                            <Camera size={13} />
                        </button>
                        <div className="w-px h-4 bg-gray-200 mx-0.5" />
                        <button
                            onClick={() => setPageScale((s) => Math.max(0.6, Number((s - 0.1).toFixed(2))))}
                            className="p-1.5 rounded border bg-gray-50 border-gray-200 text-gray-500 hover:bg-gray-100 transition-colors"
                            title="缩小"
                        >
                            <ZoomOut size={12} />
                        </button>
                        <span className="text-[9px] text-gray-500 w-8 text-center tabular-nums">{Math.round(pageScale * 100)}%</span>
                        <button
                            onClick={() => setPageScale((s) => Math.min(2.5, Number((s + 0.1).toFixed(2))))}
                            className="p-1.5 rounded border bg-gray-50 border-gray-200 text-gray-500 hover:bg-gray-100 transition-colors"
                            title="放大"
                        >
                            <ZoomIn size={12} />
                        </button>
                        <button
                            onClick={() => setPageScale(1.0)}
                            className="p-1.5 rounded border bg-gray-50 border-gray-200 text-gray-500 hover:bg-gray-100 transition-colors"
                            title="重置缩放 100%"
                        >
                            <RotateCcw size={12} />
                        </button>
                    </>
                )}
             </div>

            {(parseStatus === 'parsing' || parseStatus === 'done' || parseStatus === 'error') && (
                <div className="px-3 py-2 bg-white border-b border-gray-100 shrink-0">
                    <div className="h-1.5 w-full rounded bg-gray-100 overflow-hidden">
                        <div
                            className={`h-full transition-all duration-300 ${parseStatus === 'error' ? 'bg-red-400' : 'bg-emerald-500'}`}
                            style={{ width: `${parsePercent}%` }}
                        />
                    </div>
                    <p className="text-[10px] text-gray-400 mt-1">
                        {parseStatus === 'done' ? '解析完成' : parseStatus === 'error' ? '解析失败' : `解析中 ${parsePercent}%`}
                    </p>
                </div>
            )}

             {/* PDF Scroll Container */}
            <div 
                ref={containerRef}
                className="flex-1 overflow-y-auto p-4 flex justify-center custom-scrollbar"
                onMouseDown={handleMouseDown}
                onMouseUp={handleMouseUp}
            >
                {contentMode === 'markdown' && (
                    <div className="w-full max-w-3xl bg-white border border-gray-200 p-4">
                        {parsedMarkdown && parsedDocName === pdfFileName ? (
                            <div className="text-xs whitespace-pre-wrap text-gray-700 leading-6">{renderTextWithHighlights(parsedMarkdown)}</div>
                        ) : (
                            <p className="text-xs text-gray-400">当前文献暂无 Markdown 结果，请先上传并等待解析完成。</p>
                        )}
                    </div>
                )}

                {contentMode === 'outline' && (
                    <div className="w-full max-w-3xl bg-white border border-gray-200 p-4">
                        {outline.length === 0 || parsedDocName !== pdfFileName ? (
                            <p className="text-xs text-gray-400">暂无章节结构，请先上传并解析 PDF。</p>
                        ) : (
                            <div className="space-y-2">
                                {outline.map((item, idx) => (
                                    <button
                                        key={`${item.title}-${idx}`}
                                        onClick={() => {
                                            const approx = Math.max(1, Math.round(((idx + 1) / Math.max(outline.length, 1)) * Math.max(numPages || 1, 1)));
                                            setContentMode('pdf');
                                            setCurrentPage(approx);
                                            const related = notes.find((n) => (n.content || '').toLowerCase().includes((item.title || '').toLowerCase().slice(0, 12)));
                                            if (related?.bbox) {
                                                setActiveReference({ page: related.page || approx, bbox: related.bbox });
                                            }
                                        }}
                                        style={{ marginLeft: `${(item.level - 1) * 12}px` }}
                                        className="w-full text-left border-l-2 border-emerald-100 pl-2 hover:bg-emerald-50/50"
                                    >
                                        <p className="text-xs font-semibold text-gray-800">{item.title}</p>
                                        {item.summary && <p className="text-[11px] text-gray-500">{item.summary}</p>}
                                        {!item.summary && item.content && <p className="text-[11px] text-gray-400">{renderTextWithHighlights(item.content.slice(0, 120))}</p>}
                                        <p className="text-[10px] text-gray-400 mt-0.5">
                                            原子卡片: {notes.filter((n) => (n.content || '').toLowerCase().includes((item.title || '').toLowerCase().slice(0, 10))).length}
                                            {' · '}引用: {(item.content.match(/\[[0-9]+\]|\[@/g) || []).length}
                                        </p>
                                        {item.imageRefs?.length > 0 && (
                                            <p className="text-[10px] text-emerald-500 mt-0.5">图像片段: {item.imageRefs.length}</p>
                                        )}
                                    </button>
                                ))}
                            </div>
                        )}
                        {parseProgress.length > 0 && (
                            <div className="mt-4 border-t border-gray-100 pt-3">
                                <p className="text-[10px] text-gray-400 mb-1">解析日志</p>
                                <div className="max-h-32 overflow-y-auto text-[10px] text-gray-500 space-y-1">
                                    {parseProgress.map((log, i) => <p key={`${log}-${i}`}>{log}</p>)}
                                </div>
                            </div>
                        )}
                    </div>
                )}

                {contentMode === 'pdf' && (
                <div 
                    className="relative bg-white shadow-lg border-x border-gray-200"
                    style={{ minHeight: '800px', width: 'fit-content' }}
                >
                    {/* PDF Renderer */}
                    {!(pdfFile || pdfUrl) && (
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

                    {(pdfFile || pdfUrl) && (
                        <div
                            className={`relative group ${toolMode === 'screenshot' ? 'cursor-crosshair' : ''}`}
                            ref={pageRef}
                            onPointerDown={onScreenshotPointerDown}
                            onPointerMove={onScreenshotPointerMove}
                            onPointerUp={onScreenshotPointerUp}
                            onPointerLeave={onScreenshotPointerUp}
                        >
                                {renderHighlightOverlays()}
                                {renderActiveHighlight()}
                            {toolMode === 'screenshot' && shotDraft && (
                                <div
                                className="absolute z-30 border-2 border-pink-400 bg-pink-200/20 pointer-events-none"
                                style={{
                                    left: shotDraft.x,
                                    top: shotDraft.y,
                                    width: shotDraft.width,
                                    height: shotDraft.height,
                                }}
                                />
                            )}
                                <Document
                                        file={pdfFile || pdfUrl}
                                        onLoadSuccess={onDocumentLoadSuccess}
                                        className="flex flex-col items-center"
                                        loading={<div className="p-10 font-pixel text-xs animate-pulse">Initializing Core...</div>}
                                >
                                        <Page 
                                                pageNumber={currentPage} 
                                                renderTextLayer={true} 
                                                renderAnnotationLayer={true}
                                                width={pageWidth}
                                    scale={pageScale}
                                        />
                                </Document>
                        </div>
                    )}
                </div>
                )}
            </div>

            {/* Pixel Toolbar (Floating Portal) */}
            <AnimatePresence>
            {selection && (
                createPortal(
                        <motion.div 
                                initial={{ opacity: 0, scale: 0.9 }}
                                animate={{ opacity: 1, scale: 1 }}
                                exit={{ opacity: 0, scale: 0.9 }}
                                className="fixed bg-white border-2 border-black shadow-[4px_4px_0px_#000] p-1.5 flex flex-col gap-1.5 z-50 font-pixel text-[10px]"
                                style={{ 
                                        top: Math.max(10, selection.screenPos.y - 80), 
                                        left: selection.screenPos.x 
                                }}
                        >
                                {/* 主工具行 */}
                                <div className="flex items-center gap-1">
                                    <button onClick={() => handleAction('translate')} disabled={translating} className="px-2 py-1 hover:bg-blue-100 flex items-center gap-1 active:bg-blue-200 transition-colors text-blue-800 disabled:opacity-50 text-xs">
                                            <Languages size={14} />
                                            译
                                    </button>
                                    <button onClick={() => handleAction('highlight')} className="px-2 py-1 hover:bg-yellow-100 flex items-center gap-1 active:bg-yellow-200 transition-colors text-yellow-800 text-xs">
                                            <Highlighter size={14} />
                                            亮
                                    </button>
                                    <button onClick={() => handleAction('annotate')} className="px-2 py-1 hover:bg-green-100 flex items-center gap-1 active:bg-green-200 transition-colors text-green-800 text-xs">
                                            <Tag size={14} />
                                            注
                                    </button>
                                    <button onClick={() => handleAction('crush')} className="px-2 py-1 bg-pink-50 hover:bg-pink-100 flex items-center gap-1 active:bg-pink-200 transition-colors text-pink-600 font-bold border border-pink-200 animate-pulse text-xs">
                                            <Sparkles size={14} />
                                            粉碎
                                    </button>
                                </div>
                                {/* 高亮颜色选择 */}
                                <div className="flex items-center gap-1 border-t border-gray-100 pt-1">
                                    <Palette size={10} className="text-gray-400 mr-1" />
                                    {['yellow', 'green', 'blue', 'pink'].map(c => (
                                        <button
                                            key={c}
                                            onClick={() => setHighlightColor(c)}
                                            className={`w-4 h-4 rounded-full border-2 transition-all ${highlightColor === c ? 'border-black scale-125' : 'border-gray-300'}`}
                                            style={{ backgroundColor: { yellow: '#fde047', green: '#86efac', blue: '#93c5fd', pink: '#f9a8d4' }[c] }}
                                        />
                                    ))}
                                </div>
                                {/* 翻译结果 */}
                                {translationResult && (
                                    <div className="border-t border-gray-100 pt-1 max-w-[300px]">
                                        <p className="text-[10px] text-gray-600 leading-relaxed whitespace-pre-wrap">{translationResult}</p>
                                        <button onClick={() => { setTranslationResult(null); setSelection(null); }} className="text-[9px] text-blue-500 mt-1 hover:underline">关闭</button>
                                    </div>
                                )}
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
