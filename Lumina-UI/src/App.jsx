import React, { useRef, useEffect } from 'react';
import { useStore } from './store/useStore';
import { LeftColumn } from './components/LeftColumn';
import { MiddleColumn } from './components/MiddleColumn';
import { RightColumn } from './components/RightColumn';
import { Panel, Group, Separator } from "react-resizable-panels";
import { GripVertical, Layers, BookOpen, PenTool, MessageSquare, Telescope } from 'lucide-react';
import { healthCheck } from './api/client';
import clsx from 'clsx';

const ICON_B64 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAGAAAABgCAYAAADimHc4AAAAAXNSR0IArs4c6QAAAT5JREFUeJzt2sFNw0AQQFGDKIADJaQwDi6DI2XkQCkUkhLSA9wRlrIk1rfJe2cLLfpaaTSbaQIAAADgXjzUB7jU28fpa+T799fDLv63x/oA906AmAAxAWICxASICRATICZATICYALHN7UuOp993PvNhbLdzq7+zNjcgJkBMgJgAMQFiq08Ea7xkXTPhbO1lzQ2ICRATICZATIDYU32Av9jaPucabkBMgJgAMQFiAsT+zTTxkxcxLiJATICYADEBYrvZBR2P56GXrPnwsqlpZ4kbEBMgJkBMgJgAMQFiAsQEiAkQEyAmQGxzu6Dll6x97HZGuQExAWICxASICRBbfQq61UvW6O98lr6fPp9HjjPN87rTlxsQEyAmQEyAmACxHe2Cxqadxe8Hp7K1uQExAWICxASICQAAAAAAAACs6BtI9jzLTzjdsgAAAABJRU5ErkJggg==';

const ResizeHandle = ({ id }) => (
  <Separator className="w-1.5 bg-gray-100 hover:bg-blue-100 transition-colors flex flex-col justify-center items-center group relative z-50">
    <div className="h-8 w-1 rounded-full bg-gray-300 group-hover:bg-blue-400 transition-colors flex items-center justify-center">
       <GripVertical size={12} className="text-gray-400 group-hover:text-blue-600" />
    </div>
  </Separator>
);

const Header = ({ viewMode, setViewMode, backendOnline }) => {
  const NavButton = ({ mode, icon: Icon, label }) => (
    <button 
      onClick={() => setViewMode(mode)}
      className={clsx(
        "flex items-center gap-2 px-4 py-2 text-xs font-bold transition-all border-b-4",
        viewMode === mode 
          ? "border-blue-600 text-blue-700 bg-blue-50" 
          : "border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-50"
      )}
    >
      <Icon size={14} />
      {label}
    </button>
  );

  return (
    <div className="h-14 border-b border-gray-200 flex items-center justify-between px-4 bg-white select-none">
        {/* Left: Brand */}
        <div className="flex items-center gap-3">
            <div className="w-8 h-8 border-2 border-black overflow-hidden shadow-[3px_3px_0px_#000000] bg-black flex items-center justify-center">
                <img src={ICON_B64} alt="AtomicLab" className="w-full h-full object-contain" style={{ imageRendering: 'pixelated' }} />
            </div>
            <h1 className="font-pixel text-sm tracking-tighter mt-1">
                ATOMIC<span className="text-blue-600">LAB</span>
            </h1>
        </div>

        {/* Center: Navigation (View Modes) */}
        <div className="flex h-full items-end gap-1 font-pixel">
            <NavButton mode="read" icon={BookOpen} label="READ" />
            <NavButton mode="organize" icon={Layers} label="ORGANIZE" />
            <NavButton mode="write" icon={PenTool} label="WRITE" />
            <NavButton mode="chat" icon={MessageSquare} label="CHAT" />
            <NavButton mode="arxiv" icon={Telescope} label="ARXIV" />
        </div>

        {/* Right: Backend Status */}
        <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5 text-[10px] font-mono">
                <span className={clsx('w-2 h-2 rounded-full', backendOnline ? 'bg-green-500 animate-pulse' : 'bg-red-400')} />
                <span className={backendOnline ? 'text-green-700' : 'text-gray-400'}>{backendOnline ? 'ENGINE ONLINE' : 'ENGINE OFFLINE'}</span>
            </div>
            <div className="w-8 h-8 rounded-full bg-gray-200 border-2 border-black"></div>
        </div>
    </div>
  );
};

function App() {
  const { isZenMode, viewMode, setViewMode, backendOnline, setBackendOnline } = useStore();
  const panelGroupRef = useRef(null);

  // 后端健康检查（每 15 秒轮询）
  useEffect(() => {
    const check = () => healthCheck().then(() => setBackendOnline(true)).catch(() => setBackendOnline(false));
    check();
    const t = setInterval(check, 15000);
    return () => clearInterval(t);
  }, []);

  // View Mode Logic -> Panel Layout
  useEffect(() => {
    const layout = panelGroupRef.current;
    if (layout) {
        if (viewMode === 'read') {
            layout.setLayout([50, 25, 25]);
        } else if (viewMode === 'organize') {
            layout.setLayout([20, 60, 20]);
        } else if (viewMode === 'write') {
            layout.setLayout([25, 0, 75]); // Hide middle by shrinking to 0
        } else if (viewMode === 'chat') {
            layout.setLayout([25, 50, 25]);
        } else if (viewMode === 'arxiv') {
            layout.setLayout([0, 60, 40]);
        }
    }
  }, [viewMode]);

  return (
    <div className="h-screen w-full flex flex-col font-sans antialiased overflow-hidden bg-white text-gray-900">
      
      {/* Global Header */}
      {!isZenMode && <Header viewMode={viewMode} setViewMode={setViewMode} backendOnline={backendOnline} />}
      
      {/* Resizable Layout */}
      <div className="flex-1 w-full relative">
        <Group ref={panelGroupRef} direction="horizontal" className="h-full w-full">
            
            {/* Left Column: Read */}
            <Panel defaultSize={30} minSize={15} collapsible={true} order={1} className="bg-white">
                <LeftColumn />
            </Panel>
            
            <ResizeHandle />

            {/* Middle Column: Organize/Chat */}
            <Panel defaultSize={40} minSize={0} collapsible={true} order={2} className="bg-gray-50/50">
                <MiddleColumn />
            </Panel>
            
            <ResizeHandle />

            {/* Right Column: Write */}
            <Panel defaultSize={30} minSize={15} collapsible={true} order={3} className="bg-white">
                <RightColumn />
            </Panel>

        </Group>
      </div>
    </div>
  );
}

export default App;
