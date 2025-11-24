import { ToolBuilderResponse, DynamicTool } from "../types";

// Points to the Node.js backend
const API_URL = 'http://localhost:3000/api';

export const geminiService = {
  /**
   * Decides the next course of action based on user input and available tools.
   */
  async decideAction(userPrompt: string, availableToolNames: string[]) {
    try {
      const response = await fetch(`${API_URL}/decide`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userPrompt, availableToolNames })
      });

      if (!response.ok) throw new Error(`Backend error: ${response.statusText}`);
      return await response.json();
    } catch (e) {
      console.error("Decide failed:", e);
      // Fallback if backend is down to avoid crashing UI completely
      throw e;
    }
  },

  /**
   * Generates a new tool definition and implementation.
   */
  async buildTool(requirement: string): Promise<ToolBuilderResponse> {
    const response = await fetch(`${API_URL}/build`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requirement })
    });

    if (!response.ok) throw new Error('Failed to build tool');
    return await response.json() as ToolBuilderResponse;
  },

  /**
   * Fixes a broken tool based on error output.
   */
  async fixTool(tool: DynamicTool, error: string, args: any): Promise<ToolBuilderResponse> {
    const response = await fetch(`${API_URL}/fix`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tool, error, args })
    });

    if (!response.ok) throw new Error('Failed to fix tool');
    return await response.json() as ToolBuilderResponse;
  },

  /**
   * Executes a prompt using the provided tools via the backend.
   * Handles the client-side execution of dynamic tools.
   */
  async runWithTools(
    prompt: string, 
    tools: any[], 
    toolExecutor: (name: string, args: any) => any
  ): Promise<{ text: string | undefined; error?: { name: string; message: string; args: any } }> {
    
    // 1. Start Chat Session on Backend
    let response = await fetch(`${API_URL}/chat/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, tools })
    });

    if (!response.ok) throw new Error('Failed to start chat. Is the backend running on port 3000?');
    
    let data = await response.json();
    let executionError = undefined;

    // 2. Loop while the backend requests tool execution
    while (data.status === 'tool_call') {
      const toolOutputs = [];
      const calls = data.toolCalls;

      console.log(`[Nexus] Received ${calls.length} tool calls from backend.`);

      for (const call of calls) {
        const { name, args } = call;
        console.log(`[Nexus] Executing: ${name}`, args);
        
        try {
          const result = toolExecutor(name, args);
          toolOutputs.push({
            name,
            response: { result: result }
          });
        } catch (e: any) {
          console.error(`[Nexus] Tool Error: ${e.message}`);
          
          if (!executionError) {
             executionError = { name, message: e.message, args };
          }
          
          toolOutputs.push({
            name,
            response: { error: e.message }
          });
        }
      }

      // 3. Send results back to backend
      response = await fetch(`${API_URL}/chat/reply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          sessionId: data.sessionId, 
          toolOutputs 
        })
      });

      if (!response.ok) throw new Error('Failed to reply with tool outputs');
      data = await response.json();
    }

    // 4. Final Text Response
    return { 
      text: data.text,
      error: executionError
    };
  }
};
