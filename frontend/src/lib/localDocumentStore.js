/**
 * Local-First：高亮与原子笔记（含截图 Base64）仅存浏览器 IndexedDB，不经后端持久化。
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

export async function saveLocalDocState(docId, { highlights, notes }) {
  if (!docId) return;
  try {
    await store.setItem(keyFor(docId), {
      highlights: Array.isArray(highlights) ? highlights : [],
      notes: Array.isArray(notes) ? notes : [],
      updatedAt: Date.now(),
    });
  } catch (e) {
    console.warn('[Local-First] 保存失败', e);
  }
}

export async function loadLocalDocState(docId) {
  if (!docId) return { highlights: [], notes: [] };
  try {
    const raw = await store.getItem(keyFor(docId));
    if (!raw) return { highlights: [], notes: [] };
    return {
      highlights: Array.isArray(raw.highlights) ? raw.highlights : [],
      notes: Array.isArray(raw.notes) ? raw.notes : [],
    };
  } catch (e) {
    console.warn('[Local-First] 读取失败', e);
    return { highlights: [], notes: [] };
  }
}
