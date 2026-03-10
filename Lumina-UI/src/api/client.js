/**
 * Aether-Engine API 客户端
 * 统一管理所有与后端的 HTTP 通信
 */

const BASE_URL = '/api';

async function request(path, options = {}) {
  const url = `${BASE_URL}${path}`;
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  });

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
