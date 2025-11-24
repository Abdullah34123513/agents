import React, { useState, useEffect } from 'react';
import ChatInterface from './components/ChatInterface';
import ToolboxSidebar from './components/ToolboxSidebar';
import { api } from './services/api';
import { Message, DynamicTool, InterAgentMessage } from './types';
import { LayoutGrid } from 'lucide-react';

const generateId = () => Math.random().toString(36).substr(2, 9);

const App: React.FC = () => {
  const [messages, setMessages] = useState<Message[]>([
    { id: 'init', role: 'model', content: 'Nexus Backend Connected. I can build and run tools on the server.' }
  ]);
  const [agentMessages, setAgentMessages] = useState<InterAgentMessage[]>([]);
  const [tools, setTools] = useState<DynamicTool[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [activity, setActivity] = useState<string>(''); // Holds current background task status

  const fetchTools = async () => {
    try {
      const t = await api.getTools();
      setTools(t);
    } catch(e) { console.error(e); }
  };

  useEffect(() => { fetchTools(); }, []);

  const handleSend = async (text: string) => {
    // 1. Add User Message
    const userMsg: Message = { id: generateId(), role: 'user', content: text };
    setMessages(prev => [...prev, userMsg]);
    
    // 2. Prepare Placeholder for Bot Response
    const botMsgId = generateId();
    setMessages(prev => [...prev, { id: botMsgId, role: 'model', content: '' }]);
    setIsLoading(true);
    setActivity('Thinking...');

    try {
      // 3. Stream Response
      await api.streamChat(text, (chunk) => {
        if (chunk.type === 'text') {
          // Append text to the specific bot message
          setMessages(prev => prev.map(m => 
            m.id === botMsgId ? { ...m, content: m.content + chunk.content } : m
          ));
        } 
        else if (chunk.type === 'log') {
          // Update Activity Bar instead of Chat History
          setActivity(chunk.content.replace('[Builder]', '').trim());
        }
        else if (chunk.type === 'inter_agent') {
          // Add to Neural Network chat
          setAgentMessages(prev => [...prev, {
            id: generateId(),
            from: chunk.from,
            to: chunk.to,
            content: chunk.content,
            timestamp: Date.now()
          }]);
          // Also show as activity if it's from builder
          if (chunk.from === 'Builder') {
            setActivity(chunk.content);
          }
        }
        else if (chunk.type === 'tool_update' || chunk.type === 'tool_built') {
          fetchTools();
          setActivity('Tool registry updated.');
        }
        else if (chunk.type === 'error') {
          // Errors still go to chat for visibility, but styled differently
           setMessages(prev => [...prev, { id: generateId(), role: 'system', content: `Error: ${chunk.content}` }]);
        }
      });

    } catch (e) {
      setMessages(prev => [...prev, { id: generateId(), role: 'system', content: 'Connection Error' }]);
    } finally {
      setIsLoading(false);
      setActivity('');
    }
  };

  return (
    <div className="h-screen w-full bg-slate-950 p-4 md:p-6 lg:p-8 font-sans flex items-center justify-center">
      <div className="w-full max-w-6xl h-full flex flex-col md:flex-row gap-6">
        <div className="md:hidden flex items-center gap-2 mb-2 text-slate-200">
           <LayoutGrid size={20} />
           <span className="font-bold">Nexus Agent</span>
        </div>
        <div className="w-full md:w-80 h-[35%] md:h-full shrink-0 order-2 md:order-1">
          <ToolboxSidebar tools={tools} agentMessages={agentMessages} />
        </div>
        <div className="flex-1 h-[65%] md:h-full min-w-0 order-1 md:order-2">
          <ChatInterface 
            messages={messages} 
            isLoading={isLoading} 
            onSendMessage={handleSend}
            status={activity || (isLoading ? 'processing' : 'idle')}
          />
        </div>
      </div>
    </div>
  );
};

export default App;