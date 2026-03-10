/**
 * Aether-Engine API 客户端
 * 统一管理所有与后端的 HTTP 通信
 */

const BASE_URL = '/api';

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
    headers: { 'Content-Type': 'application/json', ...options.headers },
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
export const chat = (question, history = [], topK = 5) =>
  json('/chat', {
    method: 'POST',
    body: JSON.stringify({ question, history, top_k: topK }),
  });

/**
 * SSE 流式 AgenticRAG 对话
 * @param {string} question
 * @param {(event: {type: string, data: object}) => void} onEvent  每个 SSE 事件回调
 * @param {{ history?: Array, topK?: number }} opts
 * @returns {Promise<void>}
 */
export async function chatStream(question, onEvent, opts = {}) {
  const { history = [], topK = 5 } = opts;
  const res = await fetch(`${BASE_URL}/chat/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question, history, top_k: topK }),
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
