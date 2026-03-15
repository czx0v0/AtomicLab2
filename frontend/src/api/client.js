/**
 * Aether-Engine API 客户端
 * 统一管理所有与后端的 HTTP 通信
 */

import { SESSION_ID } from '../store/useStore';

const BASE_URL = '/api';

// 公共 Headers（自动注入 Session ID）
function getHeaders(extra = {}) {
  return {
    'Content-Type': 'application/json',
    'X-Session-ID': SESSION_ID,
    ...extra,
  };
}

// 超时封装
async function fetchWithTimeout(url, options = {}, timeout = 30000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    });
    clearTimeout(id);
    return response;
  } catch (error) {
    clearTimeout(id);
    if (error.name === 'AbortError') {
      throw new Error('请求超时，请检查后端连接或稍后重试');
    }
    throw error;
  }
}

async function request(path, options = {}) {
  const url = `${BASE_URL}${path}`;
  const res = await fetchWithTimeout(url, {
    headers: getHeaders(options.headers),
    ...options,
  }, options.timeout || 30000);

  if (!res.ok) {
    let errorMsg = `HTTP ${res.status}`;
    try {
      const err = await res.json();
      errorMsg = err.detail || errorMsg;
    } catch {}
    throw new Error(errorMsg);
  }

  return res;
}

async function json(path, options = {}) {
  const res = await request(path, options);
  return res.json();
}

// ─── 健康检查 ────────────────────────────────────────────────────────────────
export const healthCheck = () => json('/health');

// ─── 会话重置（清空当前会话的向量库、笔记与缓存，用于「重新开始」）────────────
export const resetSession = () =>
  request('/reset', { method: 'POST' });

// ─── Demo 白皮书（极简：仅清空会话 + 提供 PDF 流，前端当作用户上传并解析）──
export const loadDemo = () =>
  json('/demo/load', { method: 'POST' });

/** 拉取预置白皮书 PDF 的 Blob，用于当作用户上传并触发解析 */
export async function getDemoPdfBlob() {
  const res = await fetch(`${BASE_URL}/demo/pdf`, {
    headers: { 'X-Session-ID': SESSION_ID },
  });
  if (!res.ok) throw new Error('Demo 白皮书获取失败');
  return res.blob();
}

// ─── PDF 解析（SSE 流式）────────────────────────────────────────────────────
/**
 * 上传 PDF，通过 SSE 流式获取解析进度和最终 Markdown。
 * @param {File} file
 * @param {string} method  'auto' | 'txt' | 'ocr'
 * @param {(event: {status, message?, markdown?}) => void} onEvent
 */
export async function parsePDF(file, method = 'auto', onEvent) {
  const formData = new FormData();
  formData.append('file', file);

  const res = await fetch(`${BASE_URL}/parse-document?method=${method}`, {
    method: 'POST',
    headers: { 'X-Session-ID': SESSION_ID },
    body: formData,
  });

  if (!res.ok) throw new Error(`解析失败: HTTP ${res.status}`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        try {
          const payload = JSON.parse(line.slice(6));
          onEvent(payload);
        } catch {}
      }
    }
  }
}

// ─── 笔记 CRUD ───────────────────────────────────────────────────────────────
export const getNotes = () => json('/notes');

export const createNote = (note) =>
  json('/notes', {
    method: 'POST',
    body: JSON.stringify(note),
  });

export const deleteNote = (noteId) =>
  request(`/notes/${noteId}`, { method: 'DELETE' });

/** 更新笔记（支持 axiom / method / boundary 等原子解构字段） */
export const updateNote = (noteId, patch) =>
  json(`/notes/${noteId}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });

/** 原子解构：将笔记内容解构为公理/方法/边界，返回 { axiom, method, boundary } */
export const decomposeNote = (content, noteId = '', docId = '') =>
  json('/atomic/decompose', {
    method: 'POST',
    body: JSON.stringify({ content, note_id: noteId, doc_id: docId }),
  });

// ─── 搜索 ────────────────────────────────────────────────────────────────────
export const searchNotes = (query, topK = 5, docId = '') =>
  json('/search', {
    method: 'POST',
    body: JSON.stringify({ query, top_k: topK, doc_id: docId }),
  });

export const indexDocument = (docId, docTitle, markdown) =>
  json('/search/index-document', {
    method: 'POST',
    body: JSON.stringify({ doc_id: docId, doc_title: docTitle, markdown }),
  });

// ─── 文献文件管理 ─────────────────────────────────────────────────────────────
export async function uploadDocument(file) {
  const formData = new FormData();
  formData.append('file', file);
  const res = await fetch(`${BASE_URL}/documents`, {
    method: 'POST',
    headers: { 'X-Session-ID': SESSION_ID },
    body: formData,
  });
  if (!res.ok) throw new Error(`上传失败: HTTP ${res.status}`);
  return res.json();
}

export const listDocuments = () => json('/documents');
export const deleteDocument = (docId) => request(`/documents/${docId}`, { method: 'DELETE' });
export const getDocumentFileUrl = (docId) => `${BASE_URL}/documents/${docId}/file`;

// ─── 翻译 ────────────────────────────────────────────────────────────────────
export const translateText = (text, targetLang = 'zh') =>
  json('/translate', {
    method: 'POST',
    body: JSON.stringify({ text, target_lang: targetLang }),
  });

// ─── ArXiv 检索 ──────────────────────────────────────────────────────────────
export const searchArxiv = (query, maxResults = 10) =>
  json('/arxiv/search', {
    method: 'POST',
    body: JSON.stringify({ query, max_results: maxResults }),
  });

/** 返回代理后的 PDF 下载 URL（直接用于 <a href> 或 react-pdf） */
export const getArxivPdfUrl = (arxivId) =>
  `${BASE_URL}/arxiv/download/${arxivId}`;

// ─── AgenticRAG 对话 ──────────────────────────────────────────────────────────────────
/**
 * @param {{ document_id?: string, note_ids?: string[] }} opts - 写作/阅读上下文，强制基于文献与选中笔记作答
 */
export const chat = (question, history = [], topK = 5, opts = {}) =>
  json('/chat', {
    method: 'POST',
    body: JSON.stringify({
      question,
      history,
      top_k: topK,
      document_id: opts.document_id ?? undefined,
      note_ids: opts.note_ids?.length ? opts.note_ids : undefined,
    }),
  });

/**
 * SSE 流式 AgenticRAG 对话
 * @param {string} question
 * @param {(event: {type: string, data: object}) => void} onEvent  每个 SSE 事件回调
 * @param {{ history?: Array, topK?: number, document_id?: string, note_ids?: string[] }} opts
 * @returns {Promise<void>}
 */
export async function chatStream(question, onEvent, opts = {}) {
  const { history = [], topK = 5, document_id, note_ids } = opts;
  const res = await fetch(`${BASE_URL}/chat/stream`, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify({
      question,
      history,
      top_k: topK,
      document_id: document_id ?? undefined,
      note_ids: note_ids?.length ? note_ids : undefined,
    }),
  });

  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try { const e = await res.json(); msg = e.detail || msg; } catch {}
    throw new Error(msg);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    let currentEvent = 'message';
    for (const line of lines) {
      if (line.startsWith('event: ')) {
        currentEvent = line.slice(7).trim();
      } else if (line.startsWith('data: ')) {
        try {
          const payload = JSON.parse(line.slice(6));
          onEvent({ type: currentEvent, data: payload });
        } catch {}
      }
    }
  }
}

// ─── 写作辅助 ────────────────────────────────────────────────────────────────
export const writingAssist = (action, text, context = '') =>
  json('/writing/assist', {
    method: 'POST',
    body: JSON.stringify({ action, text, context }),
  });

/** 行内助手：自然语言指令 → 状态机映射到续写/润色/纠错/病句，返回建议文本。maxTokens 控制建议长度（默认 1200） */
export const writingInline = (command, text, context = '', maxTokens = 1200) =>
  json('/writing/inline', {
    method: 'POST',
    body: JSON.stringify({ command, text, context, max_tokens: maxTokens }),
  });

/** 解析引用：根据标题或 DOI 获取文献元数据（Crossref / Semantic Scholar） */
export const resolveCitation = (title = '', doi = '') =>
  json('/writing/resolve-citation', {
    method: 'POST',
    body: JSON.stringify({ title: (title || '').trim(), doi: (doi || '').trim() }),
  });
