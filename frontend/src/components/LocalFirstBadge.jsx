import clsx from 'clsx';
import React, { useId, useState } from 'react';

/**
 * Local-First 隐私卖点：像素风徽章 + Hover 说明（数据仅存 IndexedDB）
 */
export function LocalFirstBadge({ className = '', compact = false }) {
  const tipId = useId();
  const [open, setOpen] = useState(false);

  return (
    <div className={clsx('relative inline-flex items-center', className)}>
      <button
        type="button"
        className={clsx(
          'group inline-flex items-center gap-1.5 px-2 py-1 rounded border-2 border-black shadow-[3px_3px_0px_#000] bg-emerald-50',
          'font-mono text-[9px] sm:text-[10px] font-bold text-emerald-900 tracking-tight',
          'hover:bg-emerald-100 transition-colors select-none',
          compact && 'px-1.5 py-0.5 text-[8px]'
        )}
        aria-describedby={tipId}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
      >
        <span aria-hidden>🔒</span>
        <span>Local-First 隐私模式开启</span>
      </button>
      {open && (
        <div
          id={tipId}
          role="tooltip"
          className={clsx(
            'absolute left-0 top-full z-[80] mt-1.5 w-[min(92vw,20rem)] p-2.5 rounded border-2 border-black',
            'bg-white shadow-[4px_4px_0px_rgba(0,0,0,0.15)] text-left',
            'font-sans text-[10px] leading-snug text-slate-700'
          )}
        >
          您的私人文献及高亮笔记均加密存储于本地浏览器 IndexedDB 中，服务器不作永久留存，全面保护您的科研数据安全。
        </div>
      )}
    </div>
  );
}
