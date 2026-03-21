import clsx from 'clsx';
import { CheckCircle2, AlertTriangle, XCircle, Cog, FileText } from 'lucide-react';
import React from 'react';

/**
 * Agent 思考链：默认折叠，展开为时间轴 + 检索卡片引用。
 * agentTrace: { traces: Array<{step,status,detail,score?}>, retrievedCards: Array, elapsedMs: number|null }
 */
export function AgentTraceThoughtChain({ agentTrace }) {
  const traces = Array.isArray(agentTrace?.traces) ? agentTrace.traces : [];
  const cards = Array.isArray(agentTrace?.retrievedCards) ? agentTrace.retrievedCards : [];
  const elapsedMs = agentTrace?.elapsedMs;

  if (traces.length === 0 && cards.length === 0 && elapsedMs == null) return null;

  const sec = elapsedMs != null ? (elapsedMs / 1000).toFixed(1) : null;
  const summary = sec != null
    ? `⚙️ Agent 思考完毕（耗时 ${sec}s）`
    : '⚙️ Agent 思考链路';

  const statusIcon = (status) => {
    const s = (status || '').toLowerCase();
    if (s === 'success') return <CheckCircle2 size={14} className="text-emerald-600 shrink-0" />;
    if (s === 'warning') return <AlertTriangle size={14} className="text-amber-500 shrink-0" />;
    if (s === 'error' || s === 'failed') return <XCircle size={14} className="text-rose-500 shrink-0" />;
    return <Cog size={14} className="text-slate-400 shrink-0" />;
  };

  const statusBar = (status) => {
    const s = (status || '').toLowerCase();
    if (s === 'success') return 'bg-emerald-500';
    if (s === 'warning') return 'bg-amber-400';
    if (s === 'error' || s === 'failed') return 'bg-rose-500';
    return 'bg-slate-300';
  };

  return (
    <details className="mb-2 group border border-dashed border-slate-200 rounded-lg bg-slate-50/80 open:bg-slate-50">
      <summary className="list-none cursor-pointer select-none px-2.5 py-2 flex items-center gap-2 text-[10px] font-semibold text-slate-600 hover:text-slate-800 [&::-webkit-details-marker]:hidden">
        <Cog size={12} className="text-slate-500 group-open:rotate-90 transition-transform" />
        <span className="truncate">{summary}</span>
        {traces.length > 0 && (
          <span className="ml-auto text-[9px] font-normal text-slate-400">{traces.length} 步</span>
        )}
      </summary>
      <div className="px-3 pb-3 pt-0 space-y-3 border-t border-slate-100">
        {traces.length > 0 && (
          <div className="relative pl-4 mt-2">
            <div className="absolute left-[7px] top-1 bottom-1 w-px bg-slate-200" aria-hidden />
            <ul className="space-y-3">
              {traces.map((t, i) => (
                <li key={i} className="relative flex gap-2">
                  <span
                    className={clsx(
                      'absolute -left-[1px] top-1.5 w-2 h-2 rounded-full border-2 border-white z-[1]',
                      statusBar(t.status)
                    )}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 mb-0.5">
                      {statusIcon(t.status)}
                      <span className="text-[10px] font-bold text-slate-700 uppercase tracking-wide">
                        {t.step || 'Step'}
                      </span>
                      {t.score != null && (
                        <span className="text-[9px] text-violet-600 font-mono">score {t.score}</span>
                      )}
                    </div>
                    <p className="text-[10px] text-slate-600 whitespace-pre-wrap leading-snug pl-[22px]">
                      {t.detail || '—'}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}

        {cards.length > 0 && (
          <div>
            <p className="text-[9px] font-bold text-slate-500 uppercase tracking-wider mb-1.5 flex items-center gap-1">
              <FileText size={10} />
              检索卡片 retrieved_cards
            </p>
            <ul className="space-y-1.5 max-h-[200px] overflow-y-auto custom-scrollbar">
              {cards.map((c, i) => (
                <li
                  key={`${c.id}-${i}`}
                  className="text-[9px] rounded border border-slate-200 bg-white px-2 py-1.5 leading-relaxed"
                >
                  <div className="flex items-center gap-2 flex-wrap">
                    <code className="font-mono text-violet-700 font-semibold">{c.id}</code>
                    <span className="text-[8px] px-1 py-0 rounded bg-slate-100 text-slate-600">{c.type}</span>
                    {c.page_num != null && c.page_num > 0 && (
                      <span className="text-[8px] text-slate-400">p.{c.page_num}</span>
                    )}
                    {c.score != null && (
                      <span className="text-[8px] text-emerald-600">sim {Number(c.score).toFixed(3)}</span>
                    )}
                  </div>
                  {c.doc_title && (
                    <p className="text-[9px] font-medium text-slate-700 mt-0.5 line-clamp-1">{c.doc_title}</p>
                  )}
                  <p className="text-slate-500 mt-0.5 line-clamp-3">{c.snippet || '—'}</p>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </details>
  );
}
