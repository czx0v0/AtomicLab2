import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';
import { useStore } from '../store/useStore';
import { createPortal } from 'react-dom';
import { Highlighter, Type, Sparkles, AlertCircle, Languages, Palette, BookOpen, Tag, FolderOpen, ChevronDown, ChevronUp, ChevronLeft, ChevronRight, Trash2, FileText, ListTree, Camera, ZoomIn, ZoomOut, RotateCcw, MessageSquare, X, Upload } from 'lucide-react';
import clsx from 'clsx';

import { motion, AnimatePresence } from 'framer-motion';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import rehypeHighlight from 'rehype-highlight';
import * as api from '../api/client';
import { MarkdownRenderer } from './MarkdownRenderer';

// Load PDF worker
pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

export const LeftColumn = () => {
    const {
        pdfFile, pdfUrl, setPdfUrl, setPdfFile, currentPage, setCurrentPage,
        addHighlight, highlights, activeReference, addNote, library, addToLibrary,
        removeFromLibrary, pdfFileName, parseStatus, parseProgress, parsedMarkdown,
        parsedSections, parsedDocName, setParseStatus, addParseLog, setParsedMarkdown,
        addParsedSection, updateParsedSectionSummary, clearParseState,
        notes, setNotes, setParsedSections, setActiveReference, setViewMode, setCopilotOpen, setContextAttachment,
        pendingScreenshotQueue, addPendingScreenshot, removePendingScreenshot, updateNoteContent,
        startOver, setNotification,
        startDemoLoad, setStartDemoLoad,
    } = useStore();
    const accumulatedMarkdownRef = useRef('');
    const [numPages, setNumPages] = useState(null);
    const [pdfDocument, setPdfDocument] = useState(null);
    const [pdfLoadError, setPdfLoadError] = useState(null);
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
    const [confirmRemoveId, setConfirmRemoveId] = useState(null); // 防误删：移除文献前二次确认
    const [popoverHighlight, setPopoverHighlight] = useState(null); // 点击高亮时弹窗显示原文
    const [demoLoading, setDemoLoading] = useState(false);
    const containerRef = useRef(null);
    const pageRef = useRef(null);
    const actionInFlightRef = useRef(false);

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
            if (actionInFlightRef.current) { setShotDraft(null); return; }
            actionInFlightRef.current = true;
            const bbox = {
                x: shotDraft.x,
                y: shotDraft.y,
                width: shotDraft.width,
                height: shotDraft.height,
            };
            const normBbox = toNormalizedBbox(bbox);
            const shotId = crypto.randomUUID();
            addHighlight({
                id: shotId,
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
                    const renderScale = (pageWidth * pageScale) / unscaledVp.width;
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

            // 从 PDF 文字层提取选区内文本作为笔记内容
            let extractedText = '[截图高亮]';
            if (pdfDocument && pageRef.current) {
                try {
                    const page = await pdfDocument.getPage(currentPage);
                    const unscaledVp = page.getViewport({ scale: 1.0 });
                    const scale = (pageWidth * pageScale) / unscaledVp.width;
                    const textContent = await page.getTextContent();
                    const texts = [];
                    for (const item of textContent.items) {
                        if (!item.transform) continue;
                        // pdf 坐标系：原点左下角，Y 轴向上
                        const itemX = item.transform[4] * scale;
                        const itemY = (unscaledVp.height - item.transform[5]) * scale;
                        if (
                            itemX >= bbox.x - 4 &&
                            itemX <= bbox.x + bbox.width + 4 &&
                            itemY >= bbox.y - 4 &&
                            itemY <= bbox.y + bbox.height + 4
                        ) {
                            if (item.str?.trim()) texts.push(item.str.trim());
                        }
                    }
                    if (texts.length > 0) extractedText = texts.join(' ');
                } catch (e) {
                    console.warn('文字层提取失败:', e);
                }
            }

            const shotNote = {
                id: crypto.randomUUID(),
                type: 'data',
                content: extractedText,
                page: currentPage,
                bbox: normBbox,
                screenshot: screenshotUrl,
                timestamp: new Date().toISOString(),
            };
            addNote(shotNote);
            if (!extractedText || extractedText === '[截图高亮]') {
                addPendingScreenshot({ noteId: shotNote.id, page: currentPage, bbox: bbox });
            }
            api.createNote({
                content: shotNote.content,
                type: shotNote.type,
                page: shotNote.page,
                bbox: shotNote.bbox,
                screenshot: shotNote.screenshot,
            }).catch((e) => console.warn('截图笔记后端同步失败:', e))
            .finally(() => { actionInFlightRef.current = false; });
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

    // 待识别队列：当前页与 PDF 就绪时，从文字层补全截图/高亮笔记内容
    useEffect(() => {
        if (!pdfDocument || !pendingScreenshotQueue?.length) return;
        const forPage = pendingScreenshotQueue.filter((p) => p.page === currentPage);
        if (forPage.length === 0) return;

        let cancelled = false;
        (async () => {
            try {
                const page = await pdfDocument.getPage(currentPage);
                const unscaledVp = page.getViewport({ scale: 1.0 });
                const scale = (pageWidth * pageScale) / unscaledVp.width;
                const textContent = await page.getTextContent();
                for (const item of forPage) {
                    if (cancelled) break;
                    const bbox = item.bbox && (item.bbox.x !== undefined ? item.bbox : { x: item.bbox[0], y: item.bbox[1], width: item.bbox[2] || 0, height: item.bbox[3] || 0 });
                    const texts = [];
                    for (const it of textContent.items) {
                        if (!it.transform) continue;
                        const itemX = it.transform[4] * scale;
                        const itemY = (unscaledVp.height - it.transform[5]) * scale;
                        if (itemX >= bbox.x - 4 && itemX <= bbox.x + bbox.width + 4 && itemY >= bbox.y - 4 && itemY <= bbox.y + bbox.height + 4 && it.str?.trim()) {
                            texts.push(it.str.trim());
                        }
                    }
                    if (texts.length > 0) {
                        updateNoteContent(item.noteId, texts.join(' '));
                        removePendingScreenshot(item.noteId);
                    }
                }
            } catch (e) {
                console.warn('待识别队列补全失败:', e);
            }
        })();
        return () => { cancelled = true; };
    }, [pdfDocument, currentPage, pageWidth, pageScale, pendingScreenshotQueue, updateNoteContent, removePendingScreenshot]);

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
                const w = entry.contentRect.width;
                setPageWidth(Math.max(400, Math.floor((w || 600) - 48)));
            }
        });
        
        observer.observe(containerRef.current);
        return () => observer.disconnect();
    }, []);

    const [pdfObjectUrl, setPdfObjectUrl] = useState(null);
    const [pdfLoadTimeout, setPdfLoadTimeout] = useState(false);
    const pdfLoadTimeoutRef = useRef(null);
    useEffect(() => {
        setPdfLoadError(null);
        setPdfLoadTimeout(false);
    }, [pdfObjectUrl, pdfUrl]);
    useEffect(() => {
        if (pdfFile && typeof pdfFile === 'object' && pdfFile instanceof File) {
            const url = URL.createObjectURL(pdfFile);
            setPdfObjectUrl(url);
            return () => URL.revokeObjectURL(url);
        }
        setPdfObjectUrl(null);
    }, [pdfFile]);
    // PDF 加载超时（12s）：提示可切换至 Markdown 视图
    useEffect(() => {
        if (!(pdfObjectUrl || pdfUrl)) return;
        setPdfLoadTimeout(false);
        pdfLoadTimeoutRef.current = setTimeout(() => setPdfLoadTimeout(true), 12000);
        return () => {
            if (pdfLoadTimeoutRef.current) clearTimeout(pdfLoadTimeoutRef.current);
        };
    }, [pdfObjectUrl, pdfUrl]);

    const applyFileAsUpload = useCallback((file) => {
        setNotes([]);
        setParsedSections([]);
        setPdfFile(file);
        clearParseState();
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

        accumulatedMarkdownRef.current = '';
        setParseStatus('parsing');
        addParseLog(`开始解析: ${file.name}`);
        api.parsePDF(file, 'auto', (evt) => {
            if (evt.message) addParseLog(evt.message);
            if (evt.status === 'chunk') {
                const part = (evt.section_title ? '## ' + evt.section_title + '\n\n' : '') + (evt.markdown_chunk || '');
                if (part) accumulatedMarkdownRef.current += (accumulatedMarkdownRef.current ? '\n\n' : '') + part;
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
            }
            if (evt.status === 'success') {
                const fullMd = evt.markdown || accumulatedMarkdownRef.current || '';
                if (fullMd) {
                    setParsedMarkdown(fullMd, file.name);
                    api.indexDocument(`doc_${file.name}`, file.name, fullMd)
                        .then(() => addParseLog('知识库已索引，可检索。'))
                        .catch((e) => {
                            setNotification('知识库索引失败: ' + (e?.message || String(e)), 'error');
                            addParseLog('知识库索引失败');
                        });
                }
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
    }, [setNotes, setParsedSections, setPdfFile, clearParseState, setPdfUrl, addToLibrary, setParseStatus, addParseLog, addParsedSection, updateParsedSectionSummary, setParsedMarkdown, setNotification]);

    const onFileChange = (event) => {
        const file = event.target.files[0];
        if (file) applyFileAsUpload(file);
    };

    // Header/其他处触发「加载白皮书」时，拉取 demo PDF 并当作用户上传解析
    useEffect(() => {
        if (!startDemoLoad) return;
        setStartDemoLoad(false);
        setDemoLoading(true);
        setNotification('正在加载白皮书…');
        startOver();
        api.resetSession()
            .then(() => api.loadDemo())
            .then(() => api.getDemoPdfBlob())
            .then((blob) => {
                const file = new File([blob], 'demo_paper.pdf', { type: 'application/pdf' });
                applyFileAsUpload(file);
                setViewMode('read');
                setNotification('白皮书已加载，正在解析…');
            })
            .catch((e) => setNotification(e?.message || '加载白皮书失败', 'error'))
            .finally(() => setDemoLoading(false));
    }, [startDemoLoad, setStartDemoLoad, setNotification, startOver, applyFileAsUpload, setViewMode]);

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
        if (pdfLoadTimeoutRef.current) clearTimeout(pdfLoadTimeoutRef.current);
        setPdfLoadTimeout(false);
        setNumPages(pdf.numPages);
        setPdfDocument(pdf);
        setPdfLoadError(null);
    };
    const onDocumentLoadError = (e) => {
        if (pdfLoadTimeoutRef.current) clearTimeout(pdfLoadTimeoutRef.current);
        setPdfLoadTimeout(false);
        setPdfLoadError(e?.message || 'PDF 加载失败');
        setPdfDocument(null);
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

            const pageRect = pageRef.current?.getBoundingClientRect();

            // 收集每行的相对坐标
            const relLines = rects.map(r => ({
                x: r.left - (pageRect?.left ?? 0),
                y: r.top - (pageRect?.top ?? 0),
                width: r.width,
                height: r.height,
            }));

            // 计算所有行的外包矩形（用于工具栏定位与 fallback）
            const fullX = Math.min(...relLines.map(b => b.x));
            const fullY = Math.min(...relLines.map(b => b.y));
            const fullRight = Math.max(...relLines.map(b => b.x + b.width));
            const fullBottom = Math.max(...relLines.map(b => b.y + b.height));

            setSelection({
                text,
                bbox: { x: fullX, y: fullY, width: fullRight - fullX, height: fullBottom - fullY },
                lines: relLines,   // 逐行 bbox，用于精准高亮
                screenPos: { x: rects[0].left, y: rects[0].top },
            });
        }, 16);
    }, [toolMode]);


    const handleAction = async (action) => {
        if (!selection) return;
        if (actionInFlightRef.current) return;
        actionInFlightRef.current = true;

        if (action === 'crush') {
            let screenshotUrl = null;
            
            // Generate Screenshot
            if (pdfDocument) {
                try {
                    const page = await pdfDocument.getPage(currentPage);
                    const unscaledViewport = page.getViewport({ scale: 1.0 });
                    const renderScale = (pageWidth * pageScale) / unscaledViewport.width;
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
                id: crypto.randomUUID(),
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
            actionInFlightRef.current = false;

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
            try {
                const hlBbox = contentMode === 'pdf'
                    ? toNormalizedBbox(selection.bbox)
                    : [selection.bbox.x, selection.bbox.y, selection.bbox.width, selection.bbox.height];
                const bboxArr = Array.isArray(hlBbox) ? hlBbox : [hlBbox.x, hlBbox.y, hlBbox.width, hlBbox.height];
                const normLines = contentMode === 'pdf' && selection.lines?.length > 0
                    ? selection.lines.map(b => toNormalizedBbox(b))
                    : null;
                addHighlight({
                    id: crypto.randomUUID(),
                    page: currentPage,
                    text: selection.text,
                    color: highlightColor,
                    bbox: bboxArr,
                    lines: normLines,
                });
                const hlNote = {
                    id: crypto.randomUUID(),
                    type: 'idea',
                    content: selection.text,
                    page: currentPage,
                    bbox: bboxArr,
                    timestamp: new Date().toISOString(),
                };
                addNote(hlNote);
                api.createNote({
                    content: hlNote.content,
                    type: hlNote.type,
                    page: hlNote.page,
                    bbox: hlNote.bbox,
                }).catch((e) => console.warn('高亮笔记后端同步失败:', e));
            } catch (e) {
                console.error('高亮操作失败:', e);
            }
            setSelection(null);
            actionInFlightRef.current = false;
        } else if (action === 'translate') {
            setTranslating(true);
            setTranslationResult(null);
            actionInFlightRef.current = false;
            try {
                const resp = await api.translateText(selection.text.substring(0, 2000));
                setTranslationResult(resp.translation);
                addNote({
                    id: crypto.randomUUID(),
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
            const annotation = prompt('输入批注内容：');
            if (annotation) {
                addNote({
                    id: crypto.randomUUID(),
                    type: 'idea',
                    content: `[批注] ${annotation}\n\n原文: ${selection.text.substring(0, 100)}...`,
                    page: currentPage,
                    bbox: [selection.bbox.x, selection.bbox.y, selection.bbox.width, selection.bbox.height],
                    timestamp: new Date().toISOString()
                });
            }
            setSelection(null);
            actionInFlightRef.current = false;
        }
    };

    // Render saved highlight overlays for current page（可点击弹窗显示原文）
    const renderHighlightOverlays = () => {
        const pageHighlights = highlights.filter(h => h.page === currentPage && h.bbox);
        const colorMap = { yellow: 'bg-yellow-300', green: 'bg-green-300', blue: 'bg-blue-300', pink: 'bg-pink-300' };
        return pageHighlights.flatMap(h => {
            const colorClass = colorMap[h.color] || 'bg-yellow-300';
            const onClick = (e) => { e.stopPropagation(); setPopoverHighlight(h); };
            // 优先使用逐行 bbox（精准高亮），否则退回整体 bbox
            if (h.lines && h.lines.length > 0) {
                return h.lines.map((line, i) => {
                    const p = fromStoredBbox(line);
                    return (
                        <div
                            key={`${h.id}_${i}`}
                            role="button"
                            tabIndex={0}
                            onClick={i === 0 ? onClick : undefined}
                            className={`absolute ${colorClass} mix-blend-multiply z-10 opacity-50 ${i === 0 ? 'cursor-pointer hover:opacity-70' : 'pointer-events-none'}`}
                            style={{ left: p.x, top: p.y, width: p.width, height: p.height }}
                            title={i === 0 ? (h.text ? '点击查看原文' : '') : undefined}
                        />
                    );
                });
            }
            const p = fromStoredBbox(h.bbox);
            return [(
                <div
                    key={h.id}
                    role="button"
                    tabIndex={0}
                    onClick={onClick}
                    className={`absolute ${colorClass} mix-blend-multiply z-10 opacity-50 cursor-pointer hover:opacity-70`}
                    style={{ left: p.x, top: p.y, width: p.width, height: p.height }}
                    title={h.text ? '点击查看原文' : ''}
                />
            )];
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

    const handleLoadDemo = useCallback(() => {
        setDemoLoading(true);
        setNotification('正在加载白皮书…');
        startOver();
        api.resetSession()
            .then(() => api.loadDemo())
            .then(() => api.getDemoPdfBlob())
            .then((blob) => {
                const file = new File([blob], 'demo_paper.pdf', { type: 'application/pdf' });
                applyFileAsUpload(file);
                setViewMode('read');
                setNotification('白皮书已加载，正在解析…');
            })
            .catch((e) => setNotification(e?.message || '加载白皮书失败', 'error'))
            .finally(() => setDemoLoading(false));
    }, [startOver, applyFileAsUpload, setViewMode, setNotification]);

    return (
        <div 
            className="h-full flex flex-col bg-gray-50 relative"
        >
             {/* 阅读栏顶部：体验 Demo */}
             <div className="border-b border-amber-200 bg-amber-50/80 shrink-0 px-3 py-2">
                <button
                    type="button"
                    onClick={handleLoadDemo}
                    disabled={demoLoading}
                    className="w-full flex items-center justify-center gap-2 py-2 rounded-lg border-2 border-amber-300 bg-white text-amber-800 font-sans text-xs font-bold hover:bg-amber-50 hover:border-amber-400 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
                >
                    {demoLoading ? (
                        <>
                            <span className="inline-block w-3 h-3 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
                            正在加载官方白皮书 Demo…
                        </>
                    ) : (
                        <>🎁 体验官方架构白皮书 Demo</>
                    )}
                </button>
             </div>
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
                                    <div key={doc.id} className="rounded border border-transparent hover:border-gray-200">
                                        <div
                                            onClick={() => {
                                                if (confirmRemoveId === doc.id) return;
                                                if (doc.source === 'arxiv') {
                                                    clearParseState();
                                                    setPdfUrl(`https://arxiv.org/pdf/${doc.arxivId}.pdf`, doc.name);
                                                } else if (doc.source === 'local' && doc.docId) {
                                                    clearParseState();
                                                    setPdfUrl(doc.fileUrl || api.getDocumentFileUrl(doc.docId), doc.name, doc.docId);
                                                } else {
                                                    useStore.getState().setNotification("本地文件因浏览器安全限制无法自动恢复，请重新上传。", "warn");
                                                }
                                            }}
                                            className={`flex items-center gap-2 px-2 py-1.5 rounded text-xs cursor-pointer group transition-colors ${
                                                pdfFileName === doc.name ? 'bg-blue-50 text-blue-700 border border-blue-200' : 'hover:bg-gray-100 text-gray-600'
                                            }`}
                                        >
                                            <BookOpen size={11} className="shrink-0" />
                                            <span className="truncate flex-1">{doc.name}</span>
                                            <span className={`text-[9px] px-1 py-0.5 rounded shrink-0 ${doc.source === 'arxiv' ? 'bg-green-50 text-green-600' : 'bg-gray-100 text-gray-400'}`}>
                                                {doc.source === 'arxiv' ? 'ArXiv' : 'Local'}
                                            </span>
                                            {confirmRemoveId === doc.id ? (
                                                <span className="text-[9px] text-amber-600 shrink-0">确认中</span>
                                            ) : (
                                                <button
                                                    type="button"
                                                    onClick={(e) => { e.stopPropagation(); setConfirmRemoveId(doc.id); }}
                                                    className="opacity-0 group-hover:opacity-100 p-0.5 hover:text-red-500"
                                                    title="从列表移除（需二次确认）"
                                                >
                                                    <Trash2 size={10} />
                                                </button>
                                            )}
                                        </div>
                                        {confirmRemoveId === doc.id && (
                                            <div className="px-2 pb-2 flex items-center gap-2 bg-amber-50/80 rounded-b border-b border-l border-r border-amber-200">
                                                <span className="text-[9px] text-amber-800 flex-1">从文献库移除？笔记会保留。</span>
                                                <button type="button" onClick={(e) => { e.stopPropagation(); setConfirmRemoveId(null); }} className="text-[9px] px-1.5 py-0.5 bg-gray-200 rounded hover:bg-gray-300">取消</button>
                                                <button type="button" onClick={(e) => { e.stopPropagation(); removeFromLibrary(doc.id); setConfirmRemoveId(null); }} className="text-[9px] px-1.5 py-0.5 bg-red-100 text-red-700 rounded hover:bg-red-200">确认移除</button>
                                            </div>
                                        )}
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
             <div className="border-b border-gray-200 bg-white px-2 py-1.5 shrink-0 flex items-center gap-1 font-sans">
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
                <div className="px-4 py-3 bg-white border-b border-slate-100 shrink-0">
                    <div className="flex items-center justify-between gap-2 mb-2">
                        <span className="text-[11px] font-medium text-slate-600">
                            {parseStatus === 'done' ? '解析完成' : parseStatus === 'error' ? '解析失败' : '正在解析文档…'}
                        </span>
                        {(parseStatus === 'parsing' || parseStatus === 'done') && parseStatus !== 'error' && (
                            <span className="text-[10px] tabular-nums text-slate-400">{parsePercent}%</span>
                        )}
                    </div>
                    <div className="h-2 w-full rounded-full bg-slate-100 overflow-hidden">
                        <div
                            className={clsx(
                                'h-full rounded-full transition-all duration-500 ease-out',
                                parseStatus === 'error' ? 'bg-rose-400' : parseStatus === 'done' ? 'bg-emerald-500' : 'bg-gradient-to-r from-slate-400 to-slate-600'
                            )}
                            style={{ width: `${parsePercent}%` }}
                        />
                    </div>
                </div>
            )}

            {/* ✦ 划词悬浮工具条（Medium/Notion 风格：出现在选区上方） */}
            {selection && selection.screenPos && createPortal(
                <AnimatePresence>
                    <motion.div
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 4 }}
                        transition={{ duration: 0.15 }}
                        className="fixed z-[90] flex items-center gap-0.5 px-1.5 py-1 rounded-lg border border-slate-200 shadow-lg bg-white"
                        style={{
                            left: Math.max(8, Math.min(selection.screenPos.x, typeof window !== 'undefined' ? window.innerWidth - 280 : selection.screenPos.x)),
                            top: Math.max(60, selection.screenPos.y - 44),
                        }}
                    >
                        <button onClick={() => { setHighlightColor('yellow'); handleAction('highlight'); }} className="p-1.5 rounded hover:bg-yellow-100 text-yellow-700" title="高亮"><Highlighter size={14} /></button>
                        <button onClick={() => handleAction('annotate')} className="p-1.5 rounded hover:bg-green-100 text-green-700" title="批注"><Tag size={14} /></button>
                        <button onClick={() => handleAction('crush')} className="p-1.5 rounded hover:bg-pink-100 text-pink-600" title="存为卡片"><Sparkles size={14} /></button>
                        <button
                            onClick={() => {
                              setContextAttachment({
                                text: selection.text,
                                page: currentPage,
                                docName: pdfFileName || undefined,
                              });
                              setCopilotOpen(true);
                              setSelection(null);
                              setTranslationResult(null);
                            }}
                            className="p-1.5 rounded hover:bg-blue-100 text-blue-600"
                            title="原子助手"
                        >
                            <MessageSquare size={14} />
                        </button>
                        <div className="w-px h-5 bg-gray-200 mx-0.5" />
                        <button onClick={() => handleAction('translate')} disabled={translating} className="p-1.5 rounded hover:bg-sky-100 text-sky-600 disabled:opacity-50" title="翻译"><Languages size={14} /></button>
                        <button onClick={() => { setSelection(null); setTranslationResult(null); }} className="p-1 rounded hover:bg-gray-100 text-gray-400" title="关闭">×</button>
                    </motion.div>
                </AnimatePresence>,
                document.body
            )}
            {/* 内联翻译结果仍放在顶部条下，避免遮挡 PDF */}
            {selection && translationResult && (
                <div className="shrink-0 px-3 pb-2 bg-blue-50/80 border-b border-blue-100">
                    <div className="bg-white rounded border border-blue-200 px-2 py-1.5 text-[11px] text-gray-700 leading-relaxed">
                        {translationResult}
                    </div>
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
                            <div className="prose prose-sm max-w-none prose-code:bg-gray-100 prose-code:px-1 prose-code:rounded text-gray-800 prose-h1:text-2xl prose-h1:font-extrabold prose-h1:mt-6 prose-h1:mb-3 prose-h1:text-gray-900 prose-h1:border-b prose-h1:border-gray-200 prose-h1:pb-2 prose-h2:text-xl prose-h2:font-bold prose-h2:mt-4 prose-h2:mb-2 prose-h2:text-gray-800 prose-h2:border-b prose-h2:border-gray-100 prose-h2:pb-1 prose-h3:text-lg prose-h3:font-semibold prose-h3:mt-3 prose-h3:mb-1 prose-h3:text-gray-800 prose-table:border prose-table:border-gray-200 prose-img:rounded prose-img:border">
                                <MarkdownRenderer className="markdown-body">
                                    {parsedMarkdown}
                                </MarkdownRenderer>
                            </div>
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
                        <div className="flex flex-col items-center justify-center h-[500px] w-[600px] gap-6 font-sans text-xs px-6 bg-gradient-to-b from-slate-50/80 to-white rounded-xl border border-slate-200/80">
                            <div className="flex flex-col items-center gap-2 text-slate-500">
                                <div className="w-14 h-14 rounded-2xl bg-slate-100 flex items-center justify-center">
                                    <BookOpen size={26} className="text-slate-400" />
                                </div>
                                <p className="flex items-center gap-2 text-slate-600 font-medium">
                                    <AlertCircle size={13} className="text-amber-500 shrink-0" /> 当前未打开文献
                                </p>
                            </div>
                            {notes.length > 0 && (
                                <p className="text-[11px] text-center max-w-[320px] text-slate-500 leading-relaxed">
                                    您有 <strong className="text-slate-700">{notes.length}</strong> 条笔记仍保留。请从上方「文献库」中点击文献重新打开，或上传新 PDF。
                                </p>
                            )}
                            <div className="flex flex-col items-center gap-4">
                                <label className="inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-slate-800 text-white cursor-pointer hover:bg-slate-700 active:bg-slate-900 transition-colors text-sm font-medium shadow-sm hover:shadow focus:outline-none focus:ring-2 focus:ring-slate-500 focus:ring-offset-2">
                                    <Upload size={18} className="shrink-0" />
                                    上传 PDF
                                    <input type="file" accept=".pdf" onChange={onFileChange} className="hidden" />
                                </label>
                                {library.length > 0 && (
                                    <p className="text-[10px] text-slate-400">或从顶部文献库 ({library.length}) 选择已保存的文献</p>
                                )}
                            </div>
                            {library.length === 0 && notes.length === 0 && (
                                <p className="text-[10px] text-slate-400">上传 PDF 开始阅读与做笔记</p>
                            )}
                        </div>
                    )}

                    {(pdfObjectUrl || pdfUrl) && (
                        <div
                            className={`relative group ${toolMode === 'screenshot' ? 'cursor-crosshair' : ''}`}
                            ref={pageRef}
                            style={{ minWidth: Math.max(400, pageWidth) }}
                            onPointerDown={onScreenshotPointerDown}
                            onPointerMove={onScreenshotPointerMove}
                            onPointerUp={onScreenshotPointerUp}
                            onPointerLeave={onScreenshotPointerUp}
                        >
                                {(pdfLoadError || pdfLoadTimeout) && (
                                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-amber-50/90 border border-amber-200 rounded-lg p-4 z-10">
                                        <p className="text-sm text-amber-800">
                                            {pdfLoadTimeout && !pdfLoadError ? '加载超时，可切换至 Markdown 视图查看' : pdfLoadError}
                                        </p>
                                        {pdfLoadTimeout && !pdfLoadError && (
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    if (pdfLoadTimeoutRef.current) clearTimeout(pdfLoadTimeoutRef.current);
                                                    setContentMode('markdown');
                                                    setPdfLoadTimeout(false);
                                                }}
                                                className="px-3 py-1.5 text-sm bg-amber-500 text-white rounded-lg hover:bg-amber-600"
                                            >
                                                切换至 Markdown
                                            </button>
                                        )}
                                    </div>
                                )}
                                {renderHighlightOverlays()}
                                {renderActiveHighlight()}
                            <AnimatePresence>
                                {popoverHighlight && (
                                    <>
                                        <motion.div
                                            initial={{ opacity: 0 }}
                                            animate={{ opacity: 1 }}
                                            exit={{ opacity: 0 }}
                                            className="fixed inset-0 z-50"
                                            onClick={() => setPopoverHighlight(null)}
                                            aria-hidden
                                        />
                                        <motion.div
                                            initial={{ opacity: 0, scale: 0.95 }}
                                            animate={{ opacity: 1, scale: 1 }}
                                            exit={{ opacity: 0, scale: 0.95 }}
                                            className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-[51] bg-white border border-slate-200 rounded-lg shadow-xl max-w-md w-[90vw] p-4"
                                            onClick={(e) => e.stopPropagation()}
                                        >
                                            <div className="flex items-center justify-between border-b border-slate-100 pb-2 mb-2">
                                                <span className="text-[10px] font-sans text-slate-500 uppercase tracking-wide">高亮原文</span>
                                                <button type="button" onClick={() => setPopoverHighlight(null)} className="p-1 hover:bg-slate-100 rounded" aria-label="关闭"><X size={14} className="text-slate-500" /></button>
                                            </div>
                                            <p className="text-sm text-slate-800 leading-relaxed font-sans">{popoverHighlight.text || '（无文本）'}</p>
                                        </motion.div>
                                    </>
                                )}
                            </AnimatePresence>
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
                                        key={pdfObjectUrl || pdfUrl}
                                        file={pdfObjectUrl || pdfUrl}
                                        onLoadSuccess={onDocumentLoadSuccess}
                                        onLoadError={onDocumentLoadError}
                                        className="flex flex-col items-center"
                                        loading={<div className="p-10 text-sm text-slate-500 animate-pulse">正在加载 PDF…</div>}
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

            {/* Pixel Pagination Controls (Fixed Bottom Left) */}
            <div className="absolute bottom-6 left-6 bg-white/95 border border-slate-200 rounded-lg shadow-lg px-3 py-2 flex items-center gap-3 text-xs z-40 font-sans">
                <button onClick={() => setCurrentPage(Math.max(1, currentPage - 1))} disabled={currentPage <= 1} className="flex items-center gap-1 hover:bg-slate-100 px-2 py-1.5 rounded disabled:opacity-50 text-slate-600 hover:text-slate-900 disabled:cursor-not-allowed transition-colors" title="上一页">
                    <ChevronLeft size={16} />
                    <span>上一页</span>
                </button>
                <span className="text-slate-600 tabular-nums min-w-[4rem] text-center">第 {currentPage} / {numPages ?? '—'} 页</span>
                <button onClick={() => setCurrentPage(Math.min(numPages ?? 999, currentPage + 1))} disabled={currentPage >= (numPages ?? 0)} className="flex items-center gap-1 hover:bg-slate-100 px-2 py-1.5 rounded disabled:opacity-50 text-slate-600 hover:text-slate-900 disabled:cursor-not-allowed transition-colors" title="下一页">
                    <span>下一页</span>
                    <ChevronRight size={16} />
                </button>
            </div>
        </div>
    );
};
