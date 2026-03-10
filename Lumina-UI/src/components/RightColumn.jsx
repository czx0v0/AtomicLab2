import React, { useEffect, useState, useRef } from 'react';
import { Bold, Italic, Link, List, Quote, Code, Timer, AlertCircle } from 'lucide-react';
import { useStore } from '../store/useStore';

export const RightColumn = () => {
  const { markdownContent, setMarkdownContent, citations, pdfFile } = useStore();
  const [showCitationPopup, setShowCitationPopup] = useState(false);
  const [cursorPos, setCursorPos] = useState({ top: 0, left: 0 });
  const [query, setQuery] = useState('');
  const textAreaRef = useRef(null);
  
  // Pomodoro
  const { isPomodoroActive, pomodoroTime, togglePomodoro, decrementPomodoro, resetPomodoro } = useStore();
  
  useEffect(() => {
    let interval;
    if (isPomodoroActive && pomodoroTime > 0) {
      interval = setInterval(decrementPomodoro, 1000);
    } else if (pomodoroTime === 0) {
      clearInterval(interval);
      // Play sound or notification
    }
    return () => clearInterval(interval);
  }, [isPomodoroActive, pomodoroTime, decrementPomodoro]);

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  };

  // Editor Logic: Insert Markdown
  const insertMarkdown = (syntax) => {
    if (!textAreaRef.current) return;
    const start = textAreaRef.current.selectionStart;
    const end = textAreaRef.current.selectionEnd;
    const text = markdownContent;
    const before = text.substring(0, start);
    const selected = text.substring(start, end);
    const after = text.substring(end);
    
    let newText = text;
    let newCursorPos = start;

    switch (syntax) {
      case 'bold': 
        newText = `${before}**${selected}**${after}`;
        newCursorPos = end + 4;
        break;
      case 'italic':
        newText = `${before}*${selected}*${after}`;
        break;
      // ... more cases
      default:
        newText = text;
    }
    
    setMarkdownContent(newText);
    textAreaRef.current.focus();
  };

  // Citation Logic: Handle '@'
  const handleChange = (e) => {
    const val = e.target.value;
    const newPos = e.target.selectionStart;
    
    // Check if user just typed '@' or is typing after it
    // Simple heuristic: look back from cursor
    const lastAt = val.lastIndexOf('@', newPos - 1);
    if (lastAt !== -1 && val.slice(lastAt, newPos).match(/^@[a-zA-Z0-9]*$/)) {
      const q = val.slice(lastAt + 1, newPos);
      setQuery(q);
      
      // Calculate popup position (simplified for textarea)
      // For real rich text editors, you'd use getBoundingClientRect of range
      // Here we just use a fixed or approximate position relative to textarea
      // For MVP, enable popup near cursor (mock position)
      setShowCitationPopup(true);
    } else {
      setShowCitationPopup(false);
    }
    
    setMarkdownContent(val);
  };

  const insertCitation = (citation) => {
    if (!textAreaRef.current) return;
    const val = markdownContent;
    const newPos = textAreaRef.current.selectionStart;
    const lastAt = val.lastIndexOf('@', newPos - 1);
    
    const before = val.substring(0, lastAt);
    const after = val.substring(newPos);
    const newText = `${before}[@${citation.key}]${after}`;
    
    setMarkdownContent(newText);
    setShowCitationPopup(false);
    textAreaRef.current.focus();
  };
  
  // Render Links Logic (e.g., [Page 3])
  // We need a preview mode or a compromised "Live Rendering" mode
  // The prompt asks for "Render AI Answer... click [Page 3]" in CHAT (Nexus?)
  // But also mentions "Write Module Editor". The prompt says:
  // "Update & Highlight Linkage: When rendering AI Answer... [Page 3] tag..."
  // This implies the AI Answer (in Nexus/Middle) handles this. 
  // However, the EDITOR also supports citations.
  // The Prompt asks for: "Citation Autocomplete & Highlight: When user inputs @ in Editor..."

  return (
    <div className="flex flex-col h-full bg-white border-l border-gray-200 shadow-sm relative">
      {/* Toolbar */}
      <div className="flex items-center justify-between p-2 border-b border-gray-100 bg-gray-50/50">
        <div className="flex items-center gap-1">
          <button onClick={() => insertMarkdown('bold')} className="p-1.5 hover:bg-gray-200 rounded text-gray-600"><Bold size={16} /></button>
          <button onClick={() => insertMarkdown('italic')} className="p-1.5 hover:bg-gray-200 rounded text-gray-600"><Italic size={16} /></button>
          <button className="p-1.5 hover:bg-gray-200 rounded text-gray-600"><List size={16} /></button>
          <div className="w-px h-4 bg-gray-300 mx-1" />
          <button className="p-1.5 hover:bg-gray-200 rounded text-gray-600"><Quote size={16} /></button>
          <button className="p-1.5 hover:bg-gray-200 rounded text-gray-600"><Code size={16} /></button>
          <button className="p-1.5 hover:bg-gray-200 rounded text-gray-600"><Link size={16} /></button>
        </div>
        
        {/* Pomodoro */}
        <div className="flex items-center gap-2 bg-white border border-gray-200 rounded-full px-3 py-1 shadow-sm">
          <Timer size={14} className={isPomodoroActive ? "text-red-500 animate-pulse" : "text-gray-400"} />
          <span className="text-sm font-mono font-medium text-gray-700 w-11 text-center cursor-pointer" onClick={togglePomodoro}>
            {formatTime(pomodoroTime)}
          </span>
        </div>
      </div>

      {/* Editor Area */}
      <textarea
        ref={textAreaRef}
        className="flex-1 w-full p-6 resize-none focus:outline-none font-mono text-sm leading-relaxed text-gray-800 bg-transparent"
        value={markdownContent}
        onChange={handleChange}
        placeholder="# Start writing..."
      />
      
      {/* Citation Popup */}
      {showCitationPopup && (
        <div className="absolute top-20 left-10 w-64 bg-white border border-gray-200 rounded-lg shadow-xl z-50 overflow-hidden">
          <div className="bg-gray-50 px-3 py-1 text-xs font-semibold text-gray-500 border-b border-gray-100">
            Select Reference
          </div>
          <div className="max-h-48 overflow-y-auto">
            {citations.filter(c => c.title.toLowerCase().includes(query.toLowerCase()) || c.authors.toLowerCase().includes(query.toLowerCase())).map(c => (
              <button 
                key={c.id}
                className="w-full text-left px-3 py-2 hover:bg-blue-50 text-sm group"
                onClick={() => insertCitation(c)}
              >
                <div className="font-medium text-gray-800 group-hover:text-blue-600 truncate">{c.title}</div>
                <div className="text-xs text-gray-500">{c.authors}</div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
