/**
 * 写作区 Markdown 本地快照（非 Git；按课题 projectId 分桶，存 localStorage）
 */

const PREFIX = 'atomiclab_draft_snapshots_v1_';
const MAX_SNAPSHOTS = 24;
const MAX_CONTENT_CHARS = 800_000;

export function snapshotsStorageKey(projectId) {
  return `${PREFIX}${projectId || 'none'}`;
}

export function listSnapshots(projectId) {
  if (!projectId) return [];
  try {
    const raw = localStorage.getItem(snapshotsStorageKey(projectId));
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

export function getSnapshotById(projectId, id) {
  return listSnapshots(projectId).find((s) => s.id === id) ?? null;
}

/**
 * @param {string} projectId
 * @param {string} content
 * @param {string} [label]
 * @returns {{ ok: true, entry: object } | { ok: false, error: string }}
 */
export function pushSnapshot(projectId, content, label) {
  if (!projectId) {
    return { ok: false, error: '未选择课题，无法保存快照' };
  }
  const body = String(content ?? '');
  if (body.length > MAX_CONTENT_CHARS) {
    return { ok: false, error: `正文超过 ${MAX_CONTENT_CHARS} 字，请先精简或导出后再存快照` };
  }
  const list = listSnapshots(projectId);
  const entry = {
    id: crypto.randomUUID(),
    createdAt: Date.now(),
    label: (typeof label === 'string' ? label : '').trim(),
    content: body,
  };
  list.unshift(entry);
  while (list.length > MAX_SNAPSHOTS) list.pop();
  try {
    localStorage.setItem(snapshotsStorageKey(projectId), JSON.stringify(list));
    return { ok: true, entry };
  } catch {
    return { ok: false, error: '无法写入本地存储（空间不足或浏览器限制）' };
  }
}

export function deleteSnapshot(projectId, id) {
  const list = listSnapshots(projectId).filter((s) => s.id !== id);
  try {
    localStorage.setItem(snapshotsStorageKey(projectId), JSON.stringify(list));
  } catch {}
}

export function removeAllSnapshotsForProject(projectId) {
  if (!projectId) return;
  try {
    localStorage.removeItem(snapshotsStorageKey(projectId));
  } catch {}
}
