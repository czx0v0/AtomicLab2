import React, { useRef, useEffect } from 'react';
import { useStore } from './store/useStore';
import { LeftColumn } from './components/LeftColumn';
import { MiddleColumn } from './components/MiddleColumn';
import { RightColumn } from './components/RightColumn';
import { Panel, Group, Separator } from "react-resizable-panels";
import { GripVertical, Layers, BookOpen, PenTool, MessageSquare, Terminal } from 'lucide-react';
import clsx from 'clsx';

const ResizeHandle = ({ id }) => (
  <Separator className="w-1.5 bg-gray-100 hover:bg-blue-100 transition-colors flex flex-col justify-center items-center group relative z-50">
    <div className="h-8 w-1 rounded-full bg-gray-300 group-hover:bg-blue-400 transition-colors flex items-center justify-center">
       <GripVertical size={12} className="text-gray-400 group-hover:text-blue-600" />
    </div>
  </Separator>
);

const Header = ({ viewMode, setViewMode }) => {
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
            <div className="w-8 h-8 bg-blue-600 flex items-center justify-center shadow-[3px_3px_0px_#000000]">
                <Terminal className="text-white" size={18} />
            </div>
            <h1 className="font-pixel text-sm tracking-tighter loading-none mt-1">
                ATOMIC<span className="text-blue-600">LAB</span>
            </h1>
        </div>

        {/* Center: Navigation (View Modes) */}
        <div className="flex h-full items-end gap-1 font-pixel">
            <NavButton mode="read" icon={BookOpen} label="READ" />
            <NavButton mode="organize" icon={Layers} label="ORGANIZE" />
            <NavButton mode="write" icon={PenTool} label="WRITE" />
            <NavButton mode="chat" icon={MessageSquare} label="CHAT" />
        </div>

        {/* Right: User / Settings */}
        <div className="flex items-center gap-3">
             <div className="w-8 h-8 rounded-full bg-gray-200 border-2 border-black"></div>
        </div>
    </div>
  );
};

function App() {
  const { isZenMode, toggleZenMode, viewMode, setViewMode } = useStore();
  const panelGroupRef = useRef(null);

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
        }
    }
  }, [viewMode]);

  return (
    <div className="h-screen w-full flex flex-col font-sans antialiased overflow-hidden bg-white text-gray-900">
      
      {/* Global Header */}
      {!isZenMode && <Header viewMode={viewMode} setViewMode={setViewMode} />}
      
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
