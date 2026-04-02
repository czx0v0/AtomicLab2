/**
 * Local-First：文献级本地缓存（IndexedDB）。
 * - highlights / notes：阅读与标注状态
 * - markdown / sections：解析结果，避免切换/刷新后重复请求 MinerU
 */
import localforage from 'localforage';

const store = localforage.createInstance({
  name: 'atomiclab',
  storeName: 'local_first_docs',
  description: 'AtomicLab per-document highlights & notes (IndexedDB)',
});

const keyFor = (docId) => `doc:${docId || '_none'}`;

/** 按 id 合并笔记：后者覆盖前者同 id */
export function mergeNotesById(primary, secondary) {
  const map = new Map();
  (primary || []).forEach((n) => {
    if (n?.id) map.set(n.id, { ...n });
  });
  (secondary || []).forEach((n) => {
    if (n?.id) map.set(n.id, { ...map.get(n.id), ...n });
  });
  return Array.from(map.values());
}

export async function saveLocalDocState(docId, { highlights, notes, markdown, sections, docName }) {
  if (!docId) return;
  try {
    const prev = await store.getItem(keyFor(docId));
    await store.setItem(keyFor(docId), {
      highlights: Array.isArray(highlights) ? highlights : (Array.isArray(prev?.highlights) ? prev.highlights : []),
      notes: Array.isArray(notes) ? notes : (Array.isArray(prev?.notes) ? prev.notes : []),
      markdown: typeof markdown === 'string' ? markdown : (typeof prev?.markdown === 'string' ? prev.markdown : ''),
      sections: Array.isArray(sections) ? sections : (Array.isArray(prev?.sections) ? prev.sections : []),
      docName: typeof docName === 'string' ? docName : (typeof prev?.docName === 'string' ? prev.docName : ''),
      updatedAt: Date.now(),
    });
  } catch (e) {
    console.warn('[Local-First] 保存失败', e);
  }
}

export async function loadLocalDocState(docId) {
  if (!docId) return { highlights: [], notes: [], markdown: '', sections: [], docName: '' };
  try {
    const raw = await store.getItem(keyFor(docId));
    if (!raw) return { highlights: [], notes: [], markdown: '', sections: [], docName: '' };
    return {
      highlights: Array.isArray(raw.highlights) ? raw.highlights : [],
      notes: Array.isArray(raw.notes) ? raw.notes : [],
      markdown: typeof raw.markdown === 'string' ? raw.markdown : '',
      sections: Array.isArray(raw.sections) ? raw.sections : [],
      docName: typeof raw.docName === 'string' ? raw.docName : '',
    };
  } catch (e) {
    console.warn('[Local-First] 读取失败', e);
    return { highlights: [], notes: [], markdown: '', sections: [], docName: '' };
  }
}

export async function clearLocalDocState(docId) {
  if (!docId) return;
  try {
    await store.removeItem(keyFor(docId));
  } catch (e) {
    console.warn('[Local-First] 清理失败', e);
  }
}
