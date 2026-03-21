import React, { useState, useRef, useEffect } from 'react';
import { useStore } from '../store/useStore';
import { X, Send, Loader2, FileText, Trash2 } from 'lucide-react';
import * as api from '../api/client';
import { ChatMessage } from './MiddleColumn';

/**
 * 原子助手侧栏：嵌入布局右侧，展开时主内容收缩。支持选段附件、AI 对话、点击卡片跳转原文。
 */
export function AssistantSidebar({ embedded = false }) {
  const {
    setCopilotOpen,
    contextAttachment,
    setContextAttachment,
    setPendingEditorAction,
    setViewMode,
    messages,
    addMessage,
    updateLastMessage,
    isAgentThinking,
    setAgentThinking,
    clearMessages,
    activeDocId,
    ensureProjectDeadlineReminder,
    pendingChatQuestion,
    setPendingChatQuestion,
  } = useStore();

  const [input, setInput] = useState('');
  const bottomRef = useRef(null);

  useEffect(() => {
    ensureProjectDeadlineReminder();
  }, [ensureProjectDeadlineReminder]);

  useEffect(() => {
    if (pendingChatQuestion) {
      setInput(pendingChatQuestion);
      setPendingChatQuestion(null);
    }
  }, [pendingChatQuestion, setPendingChatQuestion]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isAgentThinking]);

  const sendMessage = async () => {
    const userText = input.trim();
    const hasAttachment = contextAttachment?.text?.trim();
    if ((!userText && !hasAttachment) || isAgentThinking) return;

    const fullQuestion = hasAttachment
      ? `【以下为选中的原文】\n${contextAttachment.page != null ? `（页码：p.${contextAttachment.page}）\n` : ''}${contextAttachment.docName ? `（文献：${contextAttachment.docName}）\n` : ''}\n${contextAttachment.text}\n\n【用户问题】\n${userText || '请结合上文回答或解释。'}`
      : userText;

    setInput('');
    setContextAttachment(null);
    addMessage({ id: Date.now(), role: 'user', content: fullQuestion });
    setAgentThinking(true);

    let synthId = null;
    let synthContent = '';

    try {
      const history = messages
        .filter((m) => m.role === 'user' || m.role === 'agent')
        .slice(-20)
        .map((m) => ({ role: m.role, content: typeof m.content === 'string' ? m.content : '' }));
      await api.chatStream(fullQuestion, ({ type, data }) => {
        if (type === 'step') {
          if (data.streaming) {
            synthId = Date.now() + Math.random() * 100000;
            synthContent = '';
            addMessage({
              id: synthId,
              role: 'agent',
              agentType: data.agent || 'synthesizer',
              content: '',
              relatedNotes: [],
            });
          } else {
            addMessage({
              id: Date.now() + Math.random() * 100000,
              role: 'agent',
              agentType: data.agent || 'system',
              content: data.score != null ? `${data.content}\n📊 评分: ${data.score}/10` : data.content,
              relatedNotes: data.related_notes?.slice(0, 8) ?? [],
            });
          }
        } else if (type === 'delta' && synthId != null) {
          synthContent += data.token || '';
          updateLastMessage({ content: synthContent });
        } else if (type === 'action' && data?.function === 'update_markdown_editor') {
          const content = (data.content || '').trim();
          const actionType = data.action_type || 'append';
          if (content) {
            setViewMode('write');
            setPendingEditorAction({
              function: 'update_markdown_editor',
              action_type: actionType,
              content,
            });
            addMessage({
              id: Date.now() + Math.random() * 100000,
              role: 'agent',
              agentType: 'writer',
              content: '✅ 已为您将内容生成至左侧编辑器。',
            });
          }
        } else if (type === 'done') {
          const sources = data.sources ?? [];
          const patch = {
            agentTrace: {
              traces: data.agent_traces ?? [],
              retrievedCards: data.retrieved_cards ?? [],
              elapsedMs: data.elapsed_ms ?? null,
            },
          };
          if (sources.length > 0) {
            patch.relatedNotes = sources.slice(0, 10);
          }
          updateLastMessage(patch);
        }
      }, {
        history,
        topK: 5,
        document_id: activeDocId || undefined,
        note_ids: contextAttachment?.noteId ? [contextAttachment.noteId] : undefined,
      });
    } catch (e) {
      addMessage({
        id: Date.now() + 1,
        role: 'agent',
        agentType: 'system',
        content: `⚠️ 请求失败: ${e instanceof Error ? e.message : String(e)}`,
      });
    } finally {
      setAgentThinking(false);
    }
  };

  return (
    <div className="h-full w-full flex flex-col bg-white border-l border-slate-200 overflow-hidden min-w-0">
      {/* 标题栏 */}
      <div className="shrink-0 flex items-center justify-between px-3 py-2 border-b border-slate-200 bg-slate-50">
        <span className="text-xs font-semibold text-slate-800">原子助手</span>
          {!embedded && (
            <button
              type="button"
              onClick={() => setCopilotOpen(false)}
              className="p-1.5 rounded hover:bg-gray-200 text-gray-600"
              aria-label="关闭"
            >
              <X size={16} />
            </button>
          )}
        </div>

        {/* 消息列表 */}
        <div className="flex-1 overflow-y-auto p-3 custom-scrollbar min-h-0">
          {messages.map((msg) => (
            <ChatMessage key={msg.id} msg={msg} />
          ))}
          {isAgentThinking && (
            <div className="flex gap-2 mb-4">
              <div className="w-9 h-9 bg-blue-100 border-2 border-black flex items-center justify-center shrink-0">
                <Loader2 size={16} className="animate-spin text-blue-600" />
              </div>
              <div className="bg-white border-2 border-black p-3 rounded-tr-xl rounded-br-xl rounded-bl-xl shadow-[3px_3px_0px_rgba(0,0,0,0.1)]">
                <div className="flex gap-1">
                  {[0, 1, 2].map((i) => (
                    <span key={i} className="w-2 h-2 bg-blue-400 rounded-full animate-bounce" style={{ animationDelay: `${i * 0.15}s` }} />
                  ))}
                </div>
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        {/* 上下文附件块（选段） */}
        {contextAttachment?.text?.trim() && (
          <div className="shrink-0 px-3 pt-2">
            <div className="flex items-start gap-2 p-2 rounded-lg border-2 border-blue-200 bg-blue-50/80 shadow-[2px_2px_0px_rgba(0,0,0,0.08)]">
              <FileText size={14} className="text-blue-600 shrink-0 mt-0.5" />
              <div className="min-w-0 flex-1">
                <p className="text-[9px] font-sans text-blue-700 uppercase tracking-wider mb-1">
                  选段 {contextAttachment.page != null ? `· p.${contextAttachment.page}` : ''}
                  {contextAttachment.docName ? ` · ${contextAttachment.docName}` : ''}
                </p>
                <p className="text-[11px] text-gray-800 line-clamp-3 leading-relaxed">
                  {contextAttachment.text.trim()}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setContextAttachment(null)}
                className="p-1 rounded hover:bg-blue-100 text-blue-600 shrink-0"
                aria-label="移除附件"
              >
                <X size={12} />
              </button>
            </div>
          </div>
        )}

        {/* 输入区 */}
        <div className="shrink-0 p-3 border-t border-gray-200 flex gap-2 bg-white">
          <button
            onClick={clearMessages}
            title="清空对话"
            className="px-2 py-2 bg-gray-100 text-gray-500 rounded hover:bg-red-50 hover:text-red-500 flex items-center justify-center transition-colors"
          >
            <Trash2 size={14} />
          </button>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && sendMessage()}
            placeholder={contextAttachment?.text ? '补充问题（如：解释这段话）或直接发送' : '向 AI 提问…'}
            className="flex-1 border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 min-w-0"
            disabled={isAgentThinking}
          />
          <button
            onClick={sendMessage}
            disabled={isAgentThinking || (!input.trim() && !contextAttachment?.text?.trim())}
            className="px-3 py-2 bg-gray-900 text-white rounded hover:bg-gray-700 disabled:opacity-50 flex items-center gap-1 text-sm shrink-0"
          >
            <Send size={14} />
          </button>
        </div>
    </div>
  );
}

export const CopilotSidebar = AssistantSidebar;
