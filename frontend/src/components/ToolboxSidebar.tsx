import React, { useState, useEffect, useRef } from 'react';
import { DynamicTool, InterAgentMessage } from '../types';
import { Wrench, Code2, ChevronRight, Activity, Cpu, Bot } from 'lucide-react';

interface ToolboxSidebarProps {
  tools: DynamicTool[];
  agentMessages?: InterAgentMessage[];
}

const ToolboxSidebar: React.FC<ToolboxSidebarProps> = ({ tools, agentMessages = [] }) => {
  const [activeTab, setActiveTab] = useState<'tools' | 'network'>('tools');
  const [selectedTool, setSelectedTool] = React.useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-switch to network tab if new agent messages come in
  useEffect(() => {
    if (agentMessages.length > 0 && activeTab === 'tools') {
        const lastMsg = agentMessages[agentMessages.length - 1];
        // Only switch if message is recent (prevents annoying switch on load)
        if (Date.now() - lastMsg.timestamp < 2000) {
            setActiveTab('network');
        }
    }
  }, [agentMessages]);

  useEffect(() => {
    if (activeTab === 'network' && scrollRef.current) {
        scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [agentMessages, activeTab]);

  return (
    <div className="flex flex-col h-full bg-slate-900 rounded-2xl border border-slate-800 overflow-hidden shadow-xl">
      
      {/* Tabs Header */}
      <div className="flex border-b border-slate-800 bg-slate-950">
        <button 
          onClick={() => setActiveTab('tools')}
          className={`flex-1 py-3 text-xs font-semibold flex items-center justify-center gap-2 transition-colors
            ${activeTab === 'tools' ? 'text-indigo-400 border-b-2 border-indigo-500 bg-slate-900' : 'text-slate-500 hover:text-slate-300'}`}
        >
          <Wrench className="w-3.5 h-3.5" />
          LIBRARY
        </button>
        <button 
          onClick={() => setActiveTab('network')}
          className={`flex-1 py-3 text-xs font-semibold flex items-center justify-center gap-2 transition-colors
            ${activeTab === 'network' ? 'text-emerald-400 border-b-2 border-emerald-500 bg-slate-900' : 'text-slate-500 hover:text-slate-300'}`}
        >
          <Activity className="w-3.5 h-3.5" />
          NEURAL NET
          {agentMessages.length > 0 && (
             <span className="bg-emerald-500/20 text-emerald-400 px-1.5 rounded-full text-[9px]">{agentMessages.length}</span>
          )}
        </button>
      </div>

      <div className="flex-1 overflow-hidden relative">
        
        {/* TOOLS TAB */}
        {activeTab === 'tools' && (
          <div className="h-full overflow-y-auto p-2 space-y-2">
            {tools.length === 0 ? (
              <div className="p-4 text-center text-slate-600 text-xs italic border border-dashed border-slate-800 rounded-lg m-2">
                No custom tools built yet.
              </div>
            ) : (
              tools.map((tool) => (
                <div key={tool.name} className="group">
                  <button
                    onClick={() => setSelectedTool(selectedTool === tool.name ? null : tool.name)}
                    className={`w-full text-left p-3 rounded-lg border transition-all duration-200
                      ${selectedTool === tool.name 
                        ? 'bg-slate-800 border-indigo-500/50 shadow-md' 
                        : 'bg-slate-900/50 border-slate-800 hover:border-slate-700 hover:bg-slate-800'}`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 overflow-hidden">
                        <Code2 className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                        <span className="font-mono text-xs font-semibold text-slate-300 truncate">{tool.name}</span>
                      </div>
                      <ChevronRight 
                        size={14} 
                        className={`text-slate-600 transition-transform ${selectedTool === tool.name ? 'rotate-90' : ''}`} 
                      />
                    </div>
                    {selectedTool === tool.name && (
                      <div className="mt-3 space-y-2 animate-in fade-in slide-in-from-top-2">
                        <p className="text-xs text-slate-400 leading-relaxed border-l-2 border-slate-700 pl-2">
                          {tool.description}
                        </p>
                        <div className="bg-[#0d1117] rounded p-2 overflow-hidden">
                          <pre className="text-[10px] font-mono text-emerald-400/80 overflow-x-auto whitespace-pre-wrap">
                            {tool.implementation}
                          </pre>
                        </div>
                      </div>
                    )}
                  </button>
                </div>
              ))
            )}
          </div>
        )}

        {/* NETWORK TAB (Chat between Agents) */}
        {activeTab === 'network' && (
          <div ref={scrollRef} className="h-full overflow-y-auto p-3 space-y-4 bg-slate-950/50">
            {agentMessages.length === 0 ? (
               <div className="flex flex-col items-center justify-center h-full text-slate-600 gap-2 opacity-50">
                  <Activity size={24} />
                  <span className="text-xs">No active agent communication.</span>
               </div>
            ) : (
              agentMessages.map((msg) => (
                <div key={msg.id} className="flex flex-col gap-1 animate-in slide-in-from-left-2 duration-300">
                  <div className="flex items-center gap-2">
                    <span className={`text-[10px] font-bold uppercase tracking-wider
                      ${msg.from.includes('Main') ? 'text-indigo-400' : 'text-emerald-400'}
                    `}>
                      {msg.from.includes('Main') ? <Bot size={10} className="inline mr-1" /> : <Wrench size={10} className="inline mr-1" />}
                      {msg.from}
                    </span>
                    <span className="text-[9px] text-slate-600">➔</span>
                    <span className="text-[9px] text-slate-500">{msg.to}</span>
                  </div>
                  <div className={`p-2 rounded-lg text-xs leading-relaxed border
                    ${msg.from.includes('Main') 
                       ? 'bg-indigo-500/10 border-indigo-500/20 text-indigo-100' 
                       : 'bg-emerald-500/10 border-emerald-500/20 text-emerald-100'}
                  `}>
                    {msg.content}
                  </div>
                </div>
              ))
            )}
          </div>
        )}
        
      </div>
      
      {/* Footer Info */}
      <div className="p-2 bg-slate-950 border-t border-slate-800 text-[9px] text-slate-600 text-center font-mono flex justify-between px-4">
        <span>STATUS: ACTIVE</span>
        <span>VER: 2.5.0</span>
      </div>
    </div>
  );
};

export default ToolboxSidebar;