
import React from 'react';
import { DynamicTool } from '../types';
import { Wrench, Code2, ChevronRight } from 'lucide-react';

interface ToolboxSidebarProps {
  tools: DynamicTool[];
}

const ToolboxSidebar: React.FC<ToolboxSidebarProps> = ({ tools }) => {
  const [selectedTool, setSelectedTool] = React.useState<string | null>(null);

  return (
    <div className="flex flex-col h-full bg-slate-900 rounded-2xl border border-slate-800 overflow-hidden shadow-xl">
      <div className="p-4 border-b border-slate-800 bg-slate-950 flex items-center gap-2">
        <Wrench className="w-4 h-4 text-emerald-400" />
        <h3 className="font-semibold text-slate-200 text-sm tracking-wide">Available Tools</h3>
        <span className="ml-auto bg-slate-800 text-slate-400 text-xs px-2 py-0.5 rounded-full border border-slate-700">
          {tools.length}
        </span>
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-2">
        {tools.length === 0 ? (
          <div className="p-4 text-center text-slate-600 text-xs italic border border-dashed border-slate-800 rounded-lg m-2">
            No custom tools built yet. Ask the agent to solve a problem!
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
      
      {/* Footer Info */}
      <div className="p-3 bg-slate-950 border-t border-slate-800 text-[10px] text-slate-500 text-center font-mono">
        ENV: SECURE SANDBOX
      </div>
    </div>
  );
};

export default ToolboxSidebar;
