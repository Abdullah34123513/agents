import React, { useEffect, useRef } from 'react';
import { Message } from '../types';
import { Terminal, Cpu, User, Wrench, Loader2 } from 'lucide-react';

interface ChatInterfaceProps {
  messages: Message[];
  isLoading: boolean;
  onSendMessage: (msg: string) => void;
  status: string;
}

const ChatInterface: React.FC<ChatInterfaceProps> = ({ messages, isLoading, onSendMessage, status }) => {
  const [input, setInput] = React.useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, status]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;
    onSendMessage(input);
    setInput('');
  };

  // Filter out system messages to keep the conversation clean
  const visibleMessages = messages.filter(m => m.role !== 'system');

  return (
    <div className="flex flex-col h-full bg-slate-900 rounded-2xl border border-slate-800 shadow-2xl overflow-hidden relative">
      {/* Header */}
      <div className="bg-slate-950 p-4 border-b border-slate-800 flex items-center justify-between z-10">
        <div className="flex items-center gap-2">
          <div className="p-2 bg-indigo-500/10 rounded-lg">
            <Terminal className="w-5 h-5 text-indigo-400" />
          </div>
          <div>
            <h2 className="font-semibold text-slate-200">Nexus Core</h2>
            <div className="flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full ${isLoading ? 'bg-amber-400 animate-pulse' : 'bg-emerald-400'}`}></span>
              <span className="text-xs text-slate-500 font-mono uppercase">ONLINE</span>
            </div>
          </div>
        </div>
      </div>

      {/* Messages Area */}
      <div className="flex-1 overflow-y-auto p-4 space-y-6 custom-scrollbar bg-gradient-to-b from-slate-900 to-slate-950">
        {visibleMessages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-slate-600 space-y-4">
            <Cpu className="w-16 h-16 opacity-20" />
            <p className="text-sm font-medium">Ready to build and execute tools.</p>
          </div>
        )}
        
        {visibleMessages.map((msg) => (
          <div key={msg.id} className={`flex gap-4 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}>
            {/* Avatar */}
            <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 mt-1 
              ${msg.role === 'user' ? 'bg-indigo-600' : 'bg-slate-700'}`}>
              {msg.role === 'user' ? <User size={14} /> : <Cpu size={14} />}
            </div>

            {/* Bubble */}
            <div className={`flex flex-col max-w-[80%] ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
              <div className={`px-4 py-3 rounded-2xl text-sm leading-relaxed shadow-sm
                ${msg.role === 'user' 
                  ? 'bg-indigo-600 text-white rounded-tr-sm' 
                  : 'bg-slate-800 text-slate-200 rounded-tl-sm border border-slate-700'}`}>
                {msg.content}
              </div>
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Status Bar for Technical Logs (Hidden when idle) */}
      {status !== 'idle' && status !== '' && (
        <div className="bg-slate-900/90 border-t border-slate-800 px-4 py-2 flex items-center gap-2 text-xs font-mono text-slate-400 animate-in slide-in-from-bottom-2">
          <Loader2 className="w-3 h-3 animate-spin text-indigo-400" />
          <span className="truncate">{status}</span>
        </div>
      )}

      {/* Input Area */}
      <div className="p-4 bg-slate-950 border-t border-slate-800">
        <form onSubmit={handleSubmit} className="relative">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Type your request..."
            className="w-full bg-slate-900 text-slate-200 placeholder-slate-500 border border-slate-700 rounded-xl py-3 px-4 pr-12 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500 transition-all"
            disabled={isLoading}
          />
          <button 
            type="submit"
            disabled={isLoading || !input.trim()}
            className="absolute right-2 top-2 p-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="22" y1="2" x2="11" y2="13"></line>
              <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
            </svg>
          </button>
        </form>
      </div>
    </div>
  );
};

export default ChatInterface;