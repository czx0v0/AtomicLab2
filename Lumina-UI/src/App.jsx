import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useStore } from './store/useStore';
import { LeftColumn } from './components/LeftColumn';
import { MiddleColumn } from './components/MiddleColumn';
import { RightColumn } from './components/RightColumn';
import { Sparkles, Maximize2, Minimize2 } from 'lucide-react';
import clsx from 'clsx';

function App() {
  const { isZenMode, toggleZenMode } = useStore();

  return (
    <div className={clsx("h-screen w-full flex flex-col font-sans antialiased overflow-hidden transition-colors duration-500", isZenMode ? "bg-amber-50" : "bg-white")}>
      
      {/* Zen Mode Toggle (Global) */}
      <div className="absolute top-4 right-4 z-50">
        <button 
          onClick={toggleZenMode}
          className={clsx(
            "p-3 rounded-full shadow-xl transition-all duration-300 hover:scale-110 active:scale-95 group border bg-white text-gray-800 hover:bg-gray-100 border-gray-200",
            isZenMode && "bg-amber-100 text-amber-800 hover:bg-amber-200 border-amber-300"
          )}
          title={isZenMode ? "Exit Zen Mode" : "Enter Zen Mode"}
        >
          {isZenMode ? <Minimize2 size={20} /> : <Sparkles size={20} className="group-hover:animate-spin-slow text-purple-600" />}
        </button>
      </div>

      {/* Main Layout Grid */}
      <div className="flex-1 flex w-full h-full relative">
        
        {/* Left Column: Read Module */}
        <motion.div 
            layout
            initial={{ width: '33.33%' }}
            animate={{ width: isZenMode ? '50%' : '33.33%' }}
            transition={{ type: 'spring', stiffness: 200, damping: 25 }}
            className="flex-shrink-0 border-r border-gray-200 h-full relative z-10 bg-white"
        >
            <LeftColumn />
        </motion.div>

        {/* Middle Column: Nexus (Hidden in Zen Mode) */}
        {!isZenMode && (
                <motion.div
                    initial={{ width: '33.33%', opacity: 1, scale: 1 }}
                    exit={{ width: 0, opacity: 0, scale: 0.95 }}
                    animate={{ width: '33.33%', opacity: 1, scale: 1 }}
                    transition={{ duration: 0.4, ease: "easeInOut" }}
                    className="flex-shrink-0 h-full overflow-hidden border-r border-gray-200 z-0 origin-center bg-gray-50"
                >
                    <MiddleColumn />
                </motion.div>
        )}

        {/* Right Column: Write Module */}
        <motion.div 
            layout
            initial={{ width: '33.33%' }}
            animate={{ width: isZenMode ? '50%' : '33.33%' }}
            transition={{ type: 'spring', stiffness: 200, damping: 25 }}
            className="flex-shrink-0 h-full z-10 bg-white"
        >
            <RightColumn />
        </motion.div>

      </div>
    </div>
  );
}

export default App;
