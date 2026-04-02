/** 后端 Demo 只读单例 doc_id，与 aether_engine/api/demo.py 一致 */
export const GLOBAL_DEMO_DOC_ID = 'global_demo_official';

/** PDF 解析章节摘要模式，与后端 SECTION_SUMMARY_MODE / Query 一致 */
export const SECTION_SUMMARY_MODE_KEY = 'atomiclab_section_summary_mode';

/** @returns {'first_paragraph'|'llm'} */
export function getStoredSectionSummaryMode() {
  try {
    const v = localStorage.getItem(SECTION_SUMMARY_MODE_KEY);
    return v === 'llm' ? 'llm' : 'first_paragraph';
  } catch {
    return 'first_paragraph';
  }
}
