import clsx from 'clsx';
import { motion, AnimatePresence } from 'framer-motion';
import React, { useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import {
  PROJECT_STATUSES,
  PROJECT_STATUS_LABELS,
  daysUntilDeadline,
  useStore,
} from '../store/useStore';

/**
 * 全局右下角 🚩：投稿与进度「任务控制中心」浮层（Pastel Pixel）
 */
export function MissionControlFab() {
  const [open, setOpen] = useState(false);
  const { projects, activeProjectId, setViewMode } = useStore();

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
                <div className="min-w-0">
                  <h2 id="mission-control-title" className="text-sm font-black text-slate-900 truncate">
                    {activeProject?.title ?? '未选择课题'}
                  </h2>
                  <p className="text-[11px] text-slate-600 mt-1 font-medium">
                    目标期刊 / 会议：<span className="text-indigo-700">{activeProject?.target_journal ?? '—'}</span>
                  </p>
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
                        <div
                          key={st}
                          className={clsx(
                            'flex-1 min-w-[52px] flex flex-col items-center gap-1 px-1 py-2 rounded-lg border-2 border-black text-[9px] font-bold',
                            done && 'bg-emerald-100 text-emerald-900',
                            current && 'bg-amber-200 text-amber-950 ring-2 ring-amber-500 ring-offset-1',
                            !done && !current && 'bg-slate-200/80 text-slate-400 border-slate-300'
                          )}
                        >
                          <span className="text-sm leading-none">{done ? '✓' : current ? '●' : '·'}</span>
                          <span className="text-center leading-tight">{PROJECT_STATUS_LABELS[st]}</span>
                        </div>
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
