import clsx from 'clsx';
import { motion, AnimatePresence } from 'framer-motion';
import React, { useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import {
  PROJECT_STATUSES,
  PROJECT_STATUS_LABELS,
  daysUntilDeadline,
  deadlineIsoToDateInput,
  dateInputToDeadlineIso,
  useStore,
} from '../store/useStore';

/**
 * 全局右下角 🚩：投稿与进度「任务控制中心」浮层（Pastel Pixel）
 */
export function MissionControlFab() {
  const [open, setOpen] = useState(false);
  const {
    projects,
    activeProjectId,
    setViewMode,
    updateProject,
    setPendingOrganizeTab,
    setCopilotOpen,
    setPendingChatQuestion,
    setNotification,
  } = useStore();
  const [draftTitle, setDraftTitle] = useState('');
  const [draftTarget, setDraftTarget] = useState('');
  const [draftDate, setDraftDate] = useState('');

  const activeProject = useMemo(
    () => projects.find((p) => p.id === activeProjectId) ?? null,
    [projects, activeProjectId]
  );

  const daysLeft = activeProject ? daysUntilDeadline(activeProject.deadline) : Infinity;
  const urgent = daysLeft < 7;

  /** 无课题时为 -1，时间线全部置灰（避免误高亮「选题」） */
  const currentIdx = useMemo(() => {
    if (!activeProject) return -1;
    const idx = PROJECT_STATUSES.indexOf(activeProject.status);
    return idx >= 0 ? idx : 0;
  }, [activeProject]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  // 仅在打开浮层或切换激活课题时同步 store → 草稿（不把 projects 列入依赖，避免保存后覆盖正在输入的内容）
  useEffect(() => {
    if (!open) return;
    const ap = projects.find((p) => p.id === activeProjectId);
    if (!ap) return;
    setDraftTitle(ap.title ?? '');
    setDraftTarget(ap.target_journal ?? '');
    setDraftDate(deadlineIsoToDateInput(ap.deadline));
  }, [open, activeProjectId]);

  const saveDraft = () => {
    if (!activeProject) return;
    updateProject(activeProject.id, {
      title: (draftTitle || '').trim() || '我的课题',
      target_journal: (draftTarget || '').trim() || '毕业论文',
      deadline: dateInputToDeadlineIso(draftDate),
    });
  };

  /** 点击 Timeline 阶段：跳转 Organize 子页 / 写作 / 打开助手模拟评审 */
  const handleTimelineStage = (statusKey) => {
    const ap = projects.find((p) => p.id === activeProjectId);
    const title = (ap?.title || draftTitle || '当前课题').trim();
    const target = (ap?.target_journal || draftTarget || '目标期刊/会议').trim();
    setOpen(false);

    switch (statusKey) {
      case 'Plan':
        setPendingOrganizeTab('deck');
        setViewMode('organize');
        setNotification('已打开：Organize · 卡片（文稿/知识管理）', 'info');
        break;
      case 'Reading':
        setPendingOrganizeTab('inbox');
        setViewMode('organize');
        setNotification('已打开：Organize · 发现', 'info');
        break;
      case 'Drafting':
        setViewMode('write');
        setNotification('已打开：写作', 'info');
        break;
      case 'Reviewing':
        setViewMode('organize');
        setCopilotOpen(true);
        setPendingChatQuestion(
          `请作为同行评审专家，针对课题「${title}」、投稿目标「${target}」，结合当前知识库与对话上下文，给出一份**模拟同行评审**（中文、Markdown）：\n\n` +
            '1. **优点与创新点**\n2. **主要问题与风险**\n3. **修改建议**（分条）\n4. **模拟结论**（接收 / 大修 / 拒稿）及简要理由'
        );
        setNotification('已打开助手并填入「模拟同行评审」提示', 'info');
        break;
      case 'Submitted':
        setPendingOrganizeTab('deck');
        setViewMode('organize');
        setNotification('已打开：Organize · 卡片', 'info');
        break;
      case 'Rebuttal':
        setViewMode('write');
        setCopilotOpen(true);
        setPendingChatQuestion(
          `请协助我准备课题「${title}」的**返修（Rebuttal）**回复：列出审稿意见要点、逐条回应思路与可补充实验。用中文、Markdown。`
        );
        setNotification('已打开写作与助手，填入返修提示', 'info');
        break;
      default:
        setPendingOrganizeTab('deck');
        setViewMode('organize');
    }
  };

  return (
    <>
      <motion.button
        type="button"
        onClick={() => setOpen(true)}
        className={clsx(
          'fixed bottom-6 right-20 z-[9999] w-12 h-12 rounded-xl',
          'border-[3px] border-black bg-[#ffe8f0] shadow-[4px_4px_0px_rgba(0,0,0,0.85)]',
          'flex items-center justify-center hover:bg-[#ffd6e5] transition-colors',
          'focus:outline-none focus:ring-2 focus:ring-rose-400 focus:ring-offset-2 cursor-pointer pointer-events-auto'
        )}
        aria-label="打开任务控制中心（投稿与进度）"
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.98 }}
      >
        <span className="text-xl leading-none select-none" aria-hidden>
          🚩
        </span>
      </motion.button>

      <AnimatePresence>
        {open && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[10000] bg-slate-900/25 backdrop-blur-[2px]"
              onClick={() => setOpen(false)}
              aria-hidden
            />
            <motion.div
              role="dialog"
              aria-modal="true"
              aria-labelledby="mission-control-title"
              initial={{ opacity: 0, scale: 0.96, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 8 }}
              transition={{ type: 'spring', damping: 26, stiffness: 320 }}
              className={clsx(
                'fixed left-1/2 top-1/2 z-[10001] w-[min(92vw,420px)] -translate-x-1/2 -translate-y-1/2',
                'rounded-2xl border-[3px] border-black bg-[#fdf6ff] shadow-[8px_8px_0px_rgba(0,0,0,0.12)]',
                'text-slate-800 overflow-hidden'
              )}
              onClick={(e) => e.stopPropagation()}
            >
              {urgent && activeProject && (
                <div
                  className={clsx(
                    'px-4 py-2.5 text-center text-xs font-bold tracking-wide text-white',
                    'bg-gradient-to-r from-red-600 to-rose-600 border-b-[3px] border-black',
                    'animate-pulse'
                  )}
                >
                  Urgent! 截稿不足 7 天 · 距离 {activeProject.target_journal} 还有 {Math.max(0, daysLeft)} 天
                </div>
              )}

              <div className="p-4 border-b-[3px] border-black/10 bg-[#fce7f3]/60 flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1 space-y-2">
                  <h2 id="mission-control-title" className="text-sm font-black text-slate-900">
                    课题设置
                  </h2>
                  <label className="block">
                    <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wide">课题标题</span>
                    <input
                      type="text"
                      value={draftTitle}
                      onChange={(e) => setDraftTitle(e.target.value)}
                      onBlur={saveDraft}
                      className="mt-0.5 w-full rounded-lg border-2 border-black bg-white px-2 py-1.5 text-xs font-medium text-slate-900"
                      placeholder="我的课题"
                    />
                  </label>
                  <label className="block">
                    <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wide">目标（期刊 / 会议 / 毕业论文等）</span>
                    <input
                      type="text"
                      value={draftTarget}
                      onChange={(e) => setDraftTarget(e.target.value)}
                      onBlur={saveDraft}
                      className="mt-0.5 w-full rounded-lg border-2 border-black bg-white px-2 py-1.5 text-xs font-medium text-slate-900"
                      placeholder="毕业论文"
                    />
                  </label>
                  <label className="block">
                    <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wide">截止日期</span>
                    <input
                      type="date"
                      value={draftDate}
                      onChange={(e) => setDraftDate(e.target.value)}
                      onBlur={saveDraft}
                      className="mt-0.5 w-full rounded-lg border-2 border-black bg-white px-2 py-1.5 text-xs font-medium text-slate-900"
                    />
                  </label>
                  <p className="text-[10px] text-slate-500">修改后自动保存到本机</p>
                </div>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="p-1.5 rounded-lg border-2 border-black bg-white hover:bg-slate-50 shrink-0"
                  aria-label="关闭"
                >
                  <X size={16} />
                </button>
              </div>

              <div className="p-4 space-y-4">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-2">进度 Timeline</p>
                  <div className="flex items-stretch gap-1 overflow-x-auto pb-1 custom-scrollbar">
                    {PROJECT_STATUSES.map((st, idx) => {
                      const done = currentIdx >= 0 && idx < currentIdx;
                      const current = currentIdx >= 0 && idx === currentIdx;
                      return (
                        <button
                          key={st}
                          type="button"
                          onClick={() => handleTimelineStage(st)}
                          title={
                            st === 'Plan'
                              ? '打开 Organize · 卡片'
                              : st === 'Reading'
                                ? '打开 Organize · 发现'
                                : st === 'Drafting'
                                  ? '打开写作'
                                  : st === 'Reviewing'
                                    ? '一键模拟同行评审（打开助手）'
                                    : st === 'Submitted'
                                      ? '打开 Organize · 卡片'
                                      : '返修助手'
                          }
                          className={clsx(
                            'flex-1 min-w-[52px] flex flex-col items-center gap-1 px-1 py-2 rounded-lg border-2 border-black text-[9px] font-bold',
                            'cursor-pointer hover:opacity-95 active:scale-[0.98] transition-transform',
                            done && 'bg-emerald-100 text-emerald-900',
                            current && 'bg-amber-200 text-amber-950 ring-2 ring-amber-500 ring-offset-1',
                            !done && !current && 'bg-slate-200/80 text-slate-400 border-slate-300'
                          )}
                        >
                          <span className="text-sm leading-none">{done ? '✓' : current ? '●' : '·'}</span>
                          <span className="text-center leading-tight">{PROJECT_STATUS_LABELS[st]}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-2">资产挂载</p>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setPendingOrganizeTab('deck');
                        setViewMode('organize');
                        setOpen(false);
                        setNotification('已打开 Organize · 卡片（文稿与知识管理）', 'info');
                      }}
                      className={clsx(
                        'inline-flex items-center gap-2 px-3 py-2 rounded-xl border-2 border-black bg-white',
                        'text-xs font-bold shadow-[3px_3px_0px_rgba(0,0,0,0.15)] hover:bg-emerald-50'
                      )}
                    >
                      <span>📚</span>
                      <span>文稿管理</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setViewMode('write');
                        setOpen(false);
                      }}
                      className={clsx(
                        'inline-flex items-center gap-2 px-3 py-2 rounded-xl border-2 border-black bg-white',
                        'text-xs font-bold shadow-[3px_3px_0px_rgba(0,0,0,0.15)] hover:bg-violet-50'
                      )}
                    >
                      <span>📄</span>
                      <span>当前 Markdown</span>
                    </button>
                    <button
                      type="button"
                      disabled
                      className={clsx(
                        'inline-flex items-center gap-2 px-3 py-2 rounded-xl border-2 border-slate-300 bg-slate-100',
                        'text-xs font-bold text-slate-400 cursor-not-allowed opacity-80'
                      )}
                      title="预留：即将支持从写作区导出 LaTeX 压缩包"
                    >
                      <span>📥</span>
                      <span>生成 LaTeX 压缩包</span>
                    </button>
                  </div>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
