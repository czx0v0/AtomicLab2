/**
 * 解析完成后为 Organize 树注入「章节摘要种子笔记」，与 demo_seed 类似，用于 assignNotesToSections 计数与分配。
 * id 稳定：section_summary_${docId}_${idx}，重复解析时由 merge 覆盖同 doc 旧种子。
 */

/**
 * @param {string} docId
 * @param {Array<{ title?: string, summary?: string, content?: string }>} sections
 * @returns {Array<object>}
 */
export function buildSectionSummarySeedNotes(docId, sections) {
  if (!docId || !Array.isArray(sections) || sections.length === 0) return [];
  return sections.map((s, idx) => {
    const summary = (s.summary || '').trim();
    const title = (s.title || 'Untitled').trim();
    return {
      id: `section_summary_${docId}_${idx}`,
      type: 'idea',
      content: summary || title,
      // 与 parsedSections 的下标一一绑定，避免在中文/英文摘要与页码启发式下出现错配。
      section_index: idx,
      keywords: [],
      tags: [],
      source: 'section_summary',
      doc_id: docId,
      page: idx + 1,
      bbox: [],
    };
  });
}

/**
 * 移除该 doc 下旧 section_summary 种子，再前置新种子（与用户笔记合并，不删用户高亮/原子笔记）。
 */
export function mergeSectionSummarySeeds(existingNotes, docId, sections) {
  const did = (docId || '').trim();
  if (!did) return existingNotes || [];
  const seeds = buildSectionSummarySeedNotes(did, sections);
  const without = (existingNotes || []).filter(
    (n) => !((n.source === 'section_summary') && (n.doc_id || '') === did),
  );
  return [...seeds, ...without];
}
