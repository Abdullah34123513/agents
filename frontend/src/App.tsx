import React, { useState, useEffect, useRef } from 'react';
import ChatInterface from './components/ChatInterface';
import ToolboxSidebar from './components/ToolboxSidebar';
import { api } from './services/api';
import { Message, DynamicTool, InterAgentMessage } from './types';
import { LayoutGrid } from 'lucide-react';

const generateId = () => Math.random().toString(36).substr(2, 9);

const App: React.FC = () => {
  // Persistent Session ID
  const sessionId = useRef(generateId()).current;

  const [messages, setMessages] = useState<Message[]>([
    { id: 'init', role: 'model', content: 'Nexus Backend Connected. I can build and run tools on the server.' }
  ]);
  const [agentMessages, setAgentMessages] = useState<InterAgentMessage[]>([]);
  const [tools, setTools] = useState<DynamicTool[]>([]);
  
  // Track active chat request
  const [isChatting, setIsChatting] = useState(false);
  
  // Track background activity
  const [activity, setActivity] = useState<string>(''); 

  const fetchTools = async () => {
    try {
      const t = await api.getTools();
      setTools(t);
    } catch(e) { console.error(e); }
  };

  useEffect(() => { 
    fetchTools(); 

    // --- SSE Connection for Background Events ---
    const eventSource = new EventSource(api.getEventStreamUrl(sessionId));

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        // Ping
        if (data.type === 'ping') return;

        // Background Logs
        if (data.type === 'log') {
          setActivity(data.content.replace('[Builder]', '').trim());
        }
        // Inter-Agent Chat
        else if (data.type === 'inter_agent') {
          setAgentMessages(prev => [...prev, {
            id: generateId(),
            from: data.from,
            to: data.to,
            content: data.content,
            timestamp: Date.now()
          }]);
          if (data.from === 'Builder') {
             setActivity(`Builder: ${data.content}`);
          }
        }
        // Tool Updates
        else if (data.type === 'tool_update') {
          fetchTools();
          setActivity('Tool registry updated.');
          setTimeout(() => setActivity(''), 3000);
        }
        // Async Text (Main Agent speaking from background)
        else if (data.type === 'text') {
             // Supports explicit roles like 'builder'
             const role = data.role || 'model';
             setMessages(prev => [...prev, { id: generateId(), role: role, content: data.content }]);
        }
        // Errors
        else if (data.type === 'error') {
           setMessages(prev => [...prev, { id: generateId(), role: 'system', content: `Error: ${data.content}` }]);
        }

      } catch (e) {
        console.error("SSE Error", e);
      }
    };

    eventSource.onerror = (e) => {
      console.error("EventSource failed:", e);
      eventSource.close();
    };

    return () => {
      eventSource.close();
    };
  }, [sessionId]);

  const handleSend = async (text: string) => {
    const userMsg: Message = { id: generateId(), role: 'user', content: text };
    setMessages(prev => [...prev, userMsg]);
    
    // Prepare bot message bubble
    const botMsgId = generateId();
    setMessages(prev => [...prev, { id: botMsgId, role: 'model', content: '' }]);
    
    setIsChatting(true);
    setActivity('Processing...');

    try {
      await api.streamChat(text, sessionId, (chunk) => {
        if (chunk.type === 'text') {
          setMessages(prev => prev.map(m => 
            m.id === botMsgId ? { ...m, content: m.content + chunk.content } : m
          ));
        } 
        // Note: 'log' and 'inter_agent' now come via SSE mostly, 
        // but we handle them here too just in case the backend sends them via HTTP stream.
        else if (chunk.type === 'done') {
           // Request finished
        }
      });
    } catch (e) {
      setMessages(prev => [...prev, { id: generateId(), role: 'system', content: 'Connection Error' }]);
    } finally {
      setIsChatting(false);
      // Don't clear activity here immediately, as background build might still be running via SSE
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
            isLoading={isChatting} 
            onSendMessage={handleSend}
            status={activity}
          />
        </div>
      </div>
    </div>
  );
};

export default App;