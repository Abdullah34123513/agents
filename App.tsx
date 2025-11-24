import React, { useState, useCallback } from 'react';
import ChatInterface from './components/ChatInterface';
import ToolboxSidebar from './components/ToolboxSidebar';
import { geminiService } from './services/gemini';
import { toolRegistry } from './services/toolRegistry';
import { Message, MessageRole, DynamicTool } from './types';
import { v4 as uuidv4 } from 'uuid'; // We'll implement a simple UUID gen since we can't use external lib
import { LayoutGrid } from 'lucide-react';

// Simple ID generator
const generateId = () => Math.random().toString(36).substr(2, 9);

const App: React.FC = () => {
  const [messages, setMessages] = useState<Message[]>([
    { 
      id: 'welcome', 
      role: MessageRole.MODEL, 
      content: "I am Nexus. I can build new tools on the fly to solve your problems. Try asking me to 'calculate the factorial of 10' or 'generate a random password with specific rules'." 
    }
  ]);
  const [tools, setTools] = useState<DynamicTool[]>([]);
  const [state, setState] = useState<'idle' | 'analyzing' | 'building' | 'executing'>('idle');

  const addMessage = (role: MessageRole, content: string, type: Message['type'] = 'text', metadata?: Message['metadata']) => {
    setMessages(prev => [...prev, {
      id: generateId(),
      role,
      content,
      type,
      metadata
    }]);
  };

  const executeRequest = useCallback(async (inputPrompt: string) => {
    // First execution attempt
    setState('executing');
    let executionResult = await geminiService.runWithTools(
      inputPrompt, 
      toolRegistry.getDeclarations(),
      (name, args) => toolRegistry.executeTool(name, args)
    );

    // Self-correction loop
    let attempts = 0;
    const maxRetries = 2;

    while (executionResult.error && attempts < maxRetries) {
      attempts++;
      const err = executionResult.error;
      
      // UI Feedback: Error detection
      addMessage(
        MessageRole.MODEL, 
        `⚠️ Tool '${err.name}' crashed: "${err.message}". Attempting self-correction... (Attempt ${attempts}/${maxRetries})`,
        'error'
      );
      
      setState('building');

      const brokenTool = toolRegistry.getTool(err.name);
      if (brokenTool) {
        try {
          // Ask Gemini to fix code
          const fixedSpec = await geminiService.fixTool(brokenTool, err.message, err.args);
          
          // Update Registry
          const fixedTool = toolRegistry.registerTool(fixedSpec);
          setTools(toolRegistry.getTools());
          
          addMessage(MessageRole.MODEL, `Applied fix for ${fixedTool.name}. Retrying execution...`, 'tool-build', {
             toolName: fixedTool.name,
             code: fixedTool.implementation
          });

          // Retry Execution
          setState('executing');
          executionResult = await geminiService.runWithTools(
            inputPrompt,
            toolRegistry.getDeclarations(),
            (name, args) => toolRegistry.executeTool(name, args)
          );
        } catch (fixError: any) {
          addMessage(MessageRole.MODEL, `Failed to fix tool: ${fixError.message}`);
          break; 
        }
      } else {
        break; // Tool not found? Should not happen.
      }
    }

    // Final Output
    if (executionResult.error) {
      addMessage(MessageRole.MODEL, `I couldn't complete the task after multiple attempts. The tool ${executionResult.error.name} keeps failing.`);
    } else {
      addMessage(MessageRole.MODEL, executionResult.text || "Task completed.");
    }

    setState('idle');
  }, []);

  const processUserMessage = useCallback(async (text: string) => {
    // 1. Add user message
    addMessage(MessageRole.USER, text);
    
    try {
      // 2. Analyze Intent
      setState('analyzing');
      const toolNames = toolRegistry.getTools().map(t => t.name);
      
      const decisionData = await geminiService.decideAction(text, toolNames);
      console.log("Decision:", decisionData);

      if (decisionData.decision === 'BUILD_TOOL') {
        setState('building');
        // Notify user
        addMessage(MessageRole.MODEL, `I need to build a new tool for this: ${decisionData.toolName}. One moment...`);

        // Build the tool
        const toolSpec = await geminiService.buildTool(
           `${decisionData.toolName} - ${decisionData.reasoning || text}`
        );

        // Register the tool
        const newTool = toolRegistry.registerTool(toolSpec);
        setTools(toolRegistry.getTools());

        // Show code preview message
        addMessage(
          MessageRole.MODEL, 
          `Tool constructed: ${newTool.name}`, 
          'tool-build', 
          { toolName: newTool.name, code: newTool.implementation }
        );

        // Execute with the new tool
        await executeRequest(text);

      } else {
        // USE_TOOL or TEXT_ONLY
        await executeRequest(text);
      }

    } catch (error: any) {
      console.error(error);
      addMessage(MessageRole.MODEL, `System Error: ${error.message}`);
      setState('idle');
    }
  }, [executeRequest]);

  return (
    <div className="h-screen w-full bg-slate-950 p-4 md:p-6 lg:p-8 font-sans flex items-center justify-center">
      <div className="w-full max-w-6xl h-full flex flex-col md:flex-row gap-6">
        
        {/* Mobile Header (Hidden on Desktop) */}
        <div className="md:hidden flex items-center gap-2 mb-2 text-slate-200">
           <LayoutGrid size={20} />
           <span className="font-bold">Nexus Agent</span>
        </div>

        {/* Sidebar (Tools) */}
        <div className="w-full md:w-80 h-[30%] md:h-full shrink-0 order-2 md:order-1">
          <ToolboxSidebar tools={tools} />
        </div>

        {/* Main Chat */}
        <div className="flex-1 h-[70%] md:h-full min-w-0 order-1 md:order-2">
          <ChatInterface 
            messages={messages} 
            isLoading={state !== 'idle'} 
            onSendMessage={processUserMessage}
            status={state}
          />
        </div>

      </div>
    </div>
  );
};

export default App;