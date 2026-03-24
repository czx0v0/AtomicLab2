import clsx from 'clsx';
import { AnimatePresence, motion } from 'framer-motion';
import { BookOpen, Cpu, Info, Layers, Loader2, Menu, PenLine, X } from 'lucide-react';
import React, { useEffect, useRef, useState } from 'react';
import { Group, Panel, Separator } from "react-resizable-panels";
import { getDocumentFileUrl, healthCheck, listDocuments, resetSession } from './api/client';
import { AssistantFab } from './components/CopilotFab';
import { MissionControlFab } from './components/MissionControlFab';
import { AssistantSidebar } from './components/CopilotSidebar';
import { LeftColumn } from './components/LeftColumn';
import { MiddleColumn } from './components/MiddleColumn';
import { RightColumn } from './components/RightColumn';
import { WriteTab } from './components/WriteTab';
import { ErrorBoundary } from './components/ErrorBoundary';
import { LocalFirstBadge } from './components/LocalFirstBadge';
import { useStore } from './store/useStore';

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

/** 顶栏下 Agent 状态条：连接等待 vs SSE 流式进行中（与侧栏气泡占位符配合，避免「空 SYNTHESIZER + 底部重复加载」） */
const AgentPipelineHud = () => {
  const isAgentThinking = useStore((s) => s.isAgentThinking);
  const agentStreamActive = useStore((s) => s.agentStreamActive);
  if (!isAgentThinking && !agentStreamActive) return null;
  return (
    <div
      className="h-7 shrink-0 border-b border-violet-200/90 bg-gradient-to-r from-violet-50/95 to-indigo-50/90 flex items-center justify-center gap-2 px-3 text-[10px] text-violet-900 shadow-[0_1px_0_rgba(15,23,42,0.04)] z-10"
      role="status"
      aria-live="polite"
    >
      <Cpu size={12} className="shrink-0 text-violet-600" aria-hidden />
      <Loader2 size={12} className="animate-spin shrink-0 text-violet-600" aria-hidden />
      <span className="font-medium">
        {isAgentThinking ? '正在连接并准备上下文…' : 'Agent 协同：路由 · 检索 · 合成（流式输出中）'}
      </span>
    </div>
  );
};

const Header = ({ viewMode, setViewMode, backendOnline, onStartOver, onLoadDemo }) => {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
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
    <header className="h-12 border-b border-slate-200 flex items-center justify-between px-3 md:px-4 bg-white select-none relative z-20">
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
        <nav className="hidden md:flex h-full items-end gap-0.5">
            <NavButton mode="read" icon={BookOpen} label="Read" />
            <NavButton mode="organize" icon={Layers} label="Organize" />
            <NavButton mode="write" icon={PenLine} label="Write" />
        </nav>

        {/* Right: Local-First + 加载 Demo / 重新开始 + Backend Status */}
        <div className="hidden md:flex items-center gap-3">
            <LocalFirstBadge variant="header" />
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
        {/* Mobile: 状态 + 汉堡菜单 */}
        <div className="md:hidden flex items-center gap-2">
          <span className={clsx('w-2 h-2 rounded-full', backendOnline ? 'bg-emerald-500 animate-pulse' : 'bg-red-400')} />
          <button
            type="button"
            onClick={() => setMobileMenuOpen((v) => !v)}
            className="p-2 rounded border border-slate-200 text-slate-600 hover:bg-slate-50"
            aria-label="打开菜单"
          >
            <Menu size={16} />
          </button>
        </div>
        {/* Mobile: 下拉菜单 */}
        <AnimatePresence>
          {mobileMenuOpen && (
            <motion.div
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              className="md:hidden absolute top-12 left-0 right-0 bg-white border-b border-slate-200 shadow-sm z-30 p-2 space-y-2"
            >
              <div className="grid grid-cols-3 gap-1">
                <button
                  type="button"
                  onClick={() => { setViewMode('read'); setMobileMenuOpen(false); }}
                  className={clsx('px-2 py-2 rounded text-xs', viewMode === 'read' ? 'bg-blue-50 text-blue-700' : 'bg-slate-50 text-slate-600')}
                >
                  Read
                </button>
                <button
                  type="button"
                  onClick={() => { setViewMode('organize'); setMobileMenuOpen(false); }}
                  className={clsx('px-2 py-2 rounded text-xs', viewMode === 'organize' ? 'bg-blue-50 text-blue-700' : 'bg-slate-50 text-slate-600')}
                >
                  Organize
                </button>
                <button
                  type="button"
                  onClick={() => { setViewMode('write'); setMobileMenuOpen(false); }}
                  className={clsx('px-2 py-2 rounded text-xs', viewMode === 'write' ? 'bg-blue-50 text-blue-700' : 'bg-slate-50 text-slate-600')}
                >
                  Write
                </button>
              </div>
              <div className="flex items-center gap-2">
                {onLoadDemo && (
                  <button
                    type="button"
                    onClick={() => { onLoadDemo(); setMobileMenuOpen(false); }}
                    className="flex-1 text-[11px] px-2 py-1.5 rounded border border-amber-300 bg-amber-50 text-amber-700"
                  >
                    加载 Demo
                  </button>
                )}
                {onStartOver && (
                  <button
                    type="button"
                    onClick={() => { onStartOver(); setMobileMenuOpen(false); }}
                    className="flex-1 text-[11px] px-2 py-1.5 rounded border border-slate-300 text-slate-600"
                  >
                    重新开始
                  </button>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
    </header>
  );
};

function App() {
  const {
    isZenMode,
    viewMode,
    setViewMode,
    backendOnline,
    setBackendOnline,
    startOver,
    setNotification,
    copilotOpen,
    setCopilotOpen,
    setStartDemoLoad,
    mobileReferenceOpen,
    setMobileReferenceOpen,
    hydrateLocalLibrary,
  } = useStore();
  const handleStartOver = () => {
    resetSession().then(() => startOver()).catch(() => startOver());
  };
  const handleLoadDemo = () => {
    setViewMode('read');
    setStartDemoLoad(true);
  };
  const panelGroupRef = useRef(null);

  // 后端健康检查（每 15 秒轮询）
  useEffect(() => {
    const check = () => healthCheck().then(() => setBackendOnline(true)).catch(() => setBackendOnline(false));
    check();
    const t = setInterval(check, 15000);
    return () => clearInterval(t);
  }, []);

  // 启动时回填服务端文献列表（本地重启/刷新后恢复文献库显示）
  useEffect(() => {
    let cancelled = false;
    listDocuments()
      .then((resp) => {
        if (cancelled) return;
        const docs = Array.isArray(resp?.documents) ? resp.documents : [];
        const mapped = docs.map((item) => ({
          id: `local_${item.id}`,
          docId: item.id,
          fileUrl: getDocumentFileUrl(item.id),
          name: item.name || item.original_filename || '未命名.pdf',
          domain_id: item.domain_id ?? null,
          addedAt: item.created_at || new Date().toISOString(),
          source: 'local',
          noteCount: 0,
        }));
        hydrateLocalLibrary(mapped);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [hydrateLocalLibrary]);

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

  useEffect(() => {
    if (viewMode !== 'write' && mobileReferenceOpen) {
      setMobileReferenceOpen(false);
    }
  }, [viewMode, mobileReferenceOpen, setMobileReferenceOpen]);

  return (
    <div className="h-screen w-full flex flex-col font-sans antialiased overflow-hidden bg-slate-50 text-slate-900">
      {/* 全局浮动通知（替代 alert） */}
      <NotificationBar />
      {/* Global Header */}
      {!isZenMode && <Header viewMode={viewMode} setViewMode={setViewMode} backendOnline={backendOnline} onStartOver={handleStartOver} onLoadDemo={handleLoadDemo} />}
      {!isZenMode && <AgentPipelineHud />}

      {/* Resizable Layout：flex-col + min-h-0 保证移动端写作 Tab 获得可计算高度，避免 h-full 塌陷为空白 */}
      <div className="flex-1 w-full relative min-h-0 flex flex-col">
        {/* Desktop / iPad 大屏：三栏可变布局 */}
        <div className="hidden md:block h-full w-full min-h-0 flex-1">
          {/* viewMode 作为 key：避免从 Read 切换 Write 时沿用已折叠的左栏宽度导致写作区/顶栏视觉异常 */}
          <Group key={viewMode} ref={panelGroupRef} direction="horizontal" className="h-full w-full min-h-0">
              {/* 左栏：Read = PDF+章节，Write = 写作区，Organize = 可选原文 PDF（复用阅读界面） */}
              <Panel defaultSize={viewMode === 'organize' ? 25 : 30} minSize={viewMode === 'organize' ? 0 : 15} collapsible={true} order={1} className="bg-white min-h-0">
                  {viewMode === 'write' ? (
                    <ErrorBoundary context="Write / RightColumn">
                      <RightColumn />
                    </ErrorBoundary>
                  ) : (viewMode === 'read' || viewMode === 'organize') ? <LeftColumn /> : <div className="h-full bg-slate-50" />}
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

        {/* Mobile：单栏堆叠（flex-1 占满主内容区剩余高度） */}
        <div className="md:hidden flex-1 min-h-0 w-full bg-white flex flex-col overflow-hidden">
          {viewMode === 'write' ? <WriteTab /> : viewMode === 'read' ? <LeftColumn /> : <MiddleColumn />}
        </div>
      </div>

      {/* Mobile：Write 参考资料半屏抽屉（覆盖编辑器） */}
      <AnimatePresence>
        {viewMode === 'write' && mobileReferenceOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="md:hidden fixed inset-0 bg-black/30 z-[9991]"
              onClick={() => setMobileReferenceOpen(false)}
            />
            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 24, stiffness: 260 }}
              className="md:hidden fixed left-0 right-0 bottom-0 h-[68vh] bg-white border-t border-slate-200 rounded-t-2xl z-[9992] overflow-hidden"
            >
              <div className="h-11 px-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
                <span className="text-sm font-medium text-slate-700">参考资料</span>
                <button
                  type="button"
                  className="p-1.5 rounded hover:bg-slate-200 text-slate-600"
                  onClick={() => setMobileReferenceOpen(false)}
                >
                  <X size={16} />
                </button>
              </div>
              <div className="h-[calc(68vh-44px)]">
                <MiddleColumn />
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
      {/* 移动端：全局 AI 助手 BottomSheet */}
      <AnimatePresence>
        {copilotOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="md:hidden fixed inset-0 bg-black/35 z-[9996]"
              onClick={() => setCopilotOpen(false)}
            />
            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 24, stiffness: 260 }}
              className="md:hidden fixed left-0 right-0 bottom-0 h-[82vh] bg-white rounded-t-2xl border-t border-slate-200 z-[9997] overflow-hidden"
            >
              <AssistantSidebar embedded />
            </motion.div>
          </>
        )}
      </AnimatePresence>
      {/* 专注模式下助手：桌面侧滑 */}
      {isZenMode && copilotOpen && (
        <div className="hidden md:block fixed inset-0 z-[9998] pointer-events-none">
          <div className="pointer-events-auto absolute right-0 top-0 bottom-0 w-full max-w-md bg-white border-l border-slate-200 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <AssistantSidebar />
          </div>
        </div>
      )}
      {/* 投稿进度 🚩 + 原子助手：单层视口固定栈，避免 fixed 受异常包含块影响；含 safe-area */}
      <div
        className="fixed bottom-6 right-4 z-[9999] pointer-events-none flex flex-col items-end gap-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pr-[max(0.75rem,env(safe-area-inset-right))]"
      >
        <div className="flex flex-col gap-3 items-end pointer-events-auto">
          <MissionControlFab />
          <AssistantFab />
        </div>
      </div>
    </div>
  );
}

export default App;
