import React, { useRef, useEffect } from 'react';
import { useStore } from './store/useStore';
import { LeftColumn } from './components/LeftColumn';
import { MiddleColumn, ReferencePanel } from './components/MiddleColumn';
import { RightColumn } from './components/RightColumn';
import { AssistantFab } from './components/CopilotFab';
import { AssistantSidebar } from './components/CopilotSidebar';
import { Panel, Group, Separator } from "react-resizable-panels";
import { BookOpen, Layers, PenLine, X, Info } from 'lucide-react';
import { healthCheck, resetSession, loadDemo } from './api/client';
import clsx from 'clsx';
import { AnimatePresence, motion } from 'framer-motion';

/** 全局浮动通知条（替代 alert/Toast），中性灰 SaaS 风格 */
const NotificationBar = () => {
  const { notification, clearNotification } = useStore();
  useEffect(() => {
    if (!notification?.message) return;
    const t = setTimeout(clearNotification, 5000);
    return () => clearTimeout(t);
  }, [notification?.message, clearNotification]);
  if (!notification?.message) return null;
  const isWarn = notification.type === 'warn' || notification.type === 'error';
  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: -12 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -8 }}
        className={clsx(
          'fixed top-14 left-1/2 -translate-x-1/2 z-[100] flex items-center gap-2 px-4 py-2 rounded-lg border shadow-sm max-w-[90vw] text-sm',
          isWarn ? 'bg-amber-50 border-amber-200 text-amber-800' : 'bg-slate-50 border-slate-200 text-slate-700'
        )}
      >
        <Info size={14} className="shrink-0" />
        <span>{notification.message}</span>
        <button type="button" onClick={clearNotification} className="p-0.5 hover:opacity-70 rounded" aria-label="关闭">
          <X size={12} />
        </button>
      </motion.div>
    </AnimatePresence>
  );
};

const ICON_B64 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAGAAAABgCAYAAADimHc4AAAAAXNSR0IArs4c6QAAAT5JREFUeJzt2sFNw0AQQFGDKIADJaQwDi6DI2XkQCkUkhLSA9wRlrIk1rfJe2cLLfpaaTSbaQIAAADgXjzUB7jU28fpa+T799fDLv63x/oA906AmAAxAWICxASICRATICZATICYALHN7UuOp993PvNhbLdzq7+zNjcgJkBMgJgAMQFiq08Ea7xkXTPhbO1lzQ2ICRATICZATIDYU32Av9jaPucabkBMgJgAMQFiAsT+zTTxkxcxLiJATICYADEBYrvZBR2P56GXrPnwsqlpZ4kbEBMgJkBMgJgAMQFiAsQEiAkQEyAmQGxzu6Dll6x97HZGuQExAWICxASICRBbfQq61UvW6O98lr6fPp9HjjPN87rTlxsQEyAmQEyAmACxHe2Cxqadxe8Hp7K1uQExAWICxASICQAAAAAAAACs6BtI9jzLTzjdsgAAAABJRU5ErkJggg==';

const ResizeHandle = () => (
  <Separator className="w-1 bg-slate-200 hover:bg-slate-300 transition-colors flex flex-col justify-center items-center group relative" />
);

const Header = ({ viewMode, setViewMode, backendOnline, onStartOver, onLoadDemo }) => {
  const NavButton = ({ mode, icon: Icon, label }) => (
    <button 
      onClick={() => setViewMode(mode)}
      className={clsx(
        "flex items-center gap-2 px-3 py-2 text-xs font-medium transition-colors border-b-2 rounded-t",
        viewMode === mode 
          ? "border-blue-600 text-blue-700 bg-slate-50" 
          : "border-transparent text-slate-500 hover:text-slate-700 hover:bg-slate-50"
      )}
    >
      <Icon size={14} />
      {label}
    </button>
  );

  return (
    <header className="h-12 border-b border-slate-200 flex items-center justify-between px-4 bg-white select-none relative z-20">
        {/* Left: Brand */}
        <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg overflow-hidden bg-slate-100 border border-slate-200 flex items-center justify-center">
                <img src={ICON_B64} alt="AtomicLab" className="w-full h-full object-contain" />
            </div>
            <div>
              <h1 className="text-sm font-semibold tracking-tight leading-none text-slate-800">
                <span>Atomic</span><span className="text-blue-600">Lab</span>
              </h1>
              <p className="text-[10px] text-slate-500 leading-none mt-0.5">Read · Organize · Write</p>
            </div>
        </div>

        {/* Center: 三 Tab — Read / Organize / Write（ArXiv、对话嵌入 Organize） */}
        <nav className="flex h-full items-end gap-0.5">
            <NavButton mode="read" icon={BookOpen} label="Read" />
            <NavButton mode="organize" icon={Layers} label="Organize" />
            <NavButton mode="write" icon={PenLine} label="Write" />
        </nav>

        {/* Right: 加载 Demo / 重新开始 + Backend Status */}
        <div className="flex items-center gap-3">
            {onLoadDemo && (
              <button
                type="button"
                onClick={onLoadDemo}
                className="text-[10px] font-mono px-2 py-1 rounded border border-amber-300 hover:border-amber-500 hover:text-amber-700 bg-amber-50/80 transition-colors"
              >
                加载 Demo
              </button>
            )}
            {onStartOver && (
              <button
                type="button"
                onClick={onStartOver}
                className="text-[10px] font-mono px-2 py-1 rounded border border-gray-300 hover:border-blue-500 hover:text-blue-600 transition-colors"
              >
                重新开始
              </button>
            )}
            <div className="flex items-center gap-1.5 text-[10px] font-mono text-slate-500">
                <span className={clsx('w-2 h-2 rounded-full', backendOnline ? 'bg-emerald-500 animate-pulse' : 'bg-red-400')} />
                <span className={backendOnline ? 'text-emerald-600' : 'text-slate-400'}>{backendOnline ? 'Online' : 'Offline'}</span>
            </div>
        </div>
    </header>
  );
};

function App() {
  const { isZenMode, viewMode, setViewMode, backendOnline, setBackendOnline, startOver, setNotification, copilotOpen, setStartDemoLoad } = useStore();
  const handleStartOver = () => {
    resetSession().then(() => startOver()).catch(() => startOver());
  };
  const handleLoadDemo = () => {
    resetSession()
      .then(() => loadDemo())
      .then(() => {
        setViewMode('read');
        setStartDemoLoad(true);
      })
      .catch((e) => setNotification(e?.message || '加载白皮书失败', 'error'));
  };
  const panelGroupRef = useRef(null);

  // 后端健康检查（每 15 秒轮询）
  useEffect(() => {
    const check = () => healthCheck().then(() => setBackendOnline(true)).catch(() => setBackendOnline(false));
    check();
    const t = setInterval(check, 15000);
    return () => clearInterval(t);
  }, []);

  // View Mode + AI 助手 -> Panel Layout（助手展开时右侧占位，主内容收缩）
  useEffect(() => {
    const layout = panelGroupRef.current;
    if (!layout) return;
    const apply = () => {
      if (viewMode === 'read' || viewMode === 'write') {
        layout.setLayout(copilotOpen ? [35, 35, 30] : [50, 50, 0]);
      } else if (viewMode === 'organize') {
        layout.setLayout(copilotOpen ? [25, 45, 30] : [25, 75, 0]);
      }
    };
    apply();
    const t = setTimeout(apply, 50);
    return () => clearTimeout(t);
  }, [viewMode, copilotOpen]);

  return (
    <div className="h-screen w-full flex flex-col font-sans antialiased overflow-hidden bg-slate-50 text-slate-900">
      {/* 全局浮动通知（替代 alert） */}
      <NotificationBar />
      {/* Global Header */}
      {!isZenMode && <Header viewMode={viewMode} setViewMode={setViewMode} backendOnline={backendOnline} onStartOver={handleStartOver} onLoadDemo={handleLoadDemo} />}
      
      {/* Resizable Layout */}
      <div className="flex-1 w-full relative min-h-0">
        <Group ref={panelGroupRef} direction="horizontal" className="h-full w-full min-h-0">
            {/* 左栏：Read = PDF+章节，Write = 写作区，Organize = 可选原文 PDF（复用阅读界面） */}
            <Panel defaultSize={viewMode === 'organize' ? 25 : 30} minSize={viewMode === 'organize' ? 0 : 15} collapsible={true} order={1} className="bg-white min-h-0">
                {viewMode === 'write' ? <RightColumn /> : (viewMode === 'read' || viewMode === 'organize') ? <LeftColumn /> : <div className="h-full bg-slate-50" />}
            </Panel>

            <ResizeHandle />

            {/* 中栏：Read = 章节与笔记，Write = 参考面板，Organize = 多视图（卡片/树/脑图/图谱/ArXiv/对话） */}
            <Panel defaultSize={40} minSize={0} collapsible={true} order={2} className="bg-slate-50 min-h-0">
                <MiddleColumn />
            </Panel>

            <ResizeHandle />

            {/* 右栏：仅 AI 助手展开时占位（Organize 不放大纲栏，留出宽度给助手） */}
            <Panel key={`right-${viewMode}-${copilotOpen}`} defaultSize={copilotOpen ? 30 : 0} minSize={copilotOpen ? 25 : 0} collapsible={true} order={3} className="bg-white min-h-0">
                {copilotOpen ? <AssistantSidebar /> : <div className="h-full bg-slate-50" />}
            </Panel>
        </Group>
      </div>
      {/* 专注模式下助手以悬浮层显示在编辑器之上，不破坏全屏布局 */}
      {isZenMode && copilotOpen && (
        <div className="fixed inset-0 z-[9998] pointer-events-none">
          <div className="pointer-events-auto absolute right-0 top-0 bottom-0 w-full max-w-md bg-white border-l border-slate-200 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <AssistantSidebar />
          </div>
        </div>
      )}
      {/* 原子助手入口：点击展开/收起右侧栏，主内容动态收缩（z 高于专注层以保可点） */}
      <AssistantFab />
    </div>
  );
}

export default App;
