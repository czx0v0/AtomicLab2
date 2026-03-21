import React from 'react';
import { useStore } from '../store/useStore';
import { motion } from 'framer-motion';
import { Bot } from 'lucide-react';

/**
 * 原子助手入口：右下角固定，点击展开/收起右侧栏（主内容动态收缩）。
 */
export function AssistantFab() {
  const { copilotOpen, setCopilotOpen } = useStore();

  return (
    <motion.button
      type="button"
      onClick={() => setCopilotOpen(!copilotOpen)}
      className="w-12 h-12 rounded-xl border border-slate-200 bg-white shadow-lg flex items-center justify-center hover:bg-slate-50 hover:border-slate-300 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-offset-2 cursor-pointer shrink-0"
      aria-label={copilotOpen ? '收起原子助手' : '展开原子助手'}
      whileHover={{ scale: 1.05 }}
      whileTap={{ scale: 0.98 }}
    >
      {/* 像素风科幻机器人：猫耳 + 方脸 + 单眼 */}
      <span className="relative flex items-center justify-center w-7 h-7">
        <Bot size={28} className="text-gray-800" strokeWidth={2.5} />
        {!copilotOpen && (
          <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-green-500 border border-white animate-pulse" />
        )}
      </span>
    </motion.button>
  );
}

export const CopilotFab = AssistantFab;
