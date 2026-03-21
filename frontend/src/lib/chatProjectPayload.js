import { PROJECT_STATUS_LABELS, daysUntilDeadline } from '../store/useStore';

/**
 * 供 chatStream 注入课题与「导师视角」摘要（与后端 ChatRequest.project_context / user_state 对齐）。
 */
export function buildProjectChatPayload(state) {
  const { projects, activeProjectId } = state;
  const p = projects.find((x) => x.id === activeProjectId);
  if (!p) {
    return { project_context: undefined, user_state: undefined };
  }
  const days = daysUntilDeadline(p.deadline);
  const todos = Array.isArray(p.plannerTodos) ? p.plannerTodos : [];
  const open = todos.filter((t) => !t.done).length;
  const log = Array.isArray(p.activityLog) ? p.activityLog : [];
  const recent = log
    .slice(-5)
    .map((e) => e.message || e.type || '')
    .filter(Boolean)
    .join('；');

  return {
    project_context: {
      title: p.title,
      target_journal: p.target_journal,
      research_goal: p.researchGoal || '',
      status: PROJECT_STATUS_LABELS[p.status] || p.status,
    },
    user_state: {
      days_to_deadline: days === Infinity ? null : days,
      is_urgent: days < 7,
      timeline_stage: PROJECT_STATUS_LABELS[p.status] || p.status,
      open_todos_count: open,
      completed_recent: recent || undefined,
    },
  };
}
