import { GoogleGenAI } from '@google/genai';
import { toolRegistry } from '../services/toolRegistry.js';
import { builder } from './builder.js';
import dotenv from 'dotenv';

dotenv.config();

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

const DECISION_PROMPT = `
You are the "Main Agent". You are helpful and conversational.
Decide the next action based on the user's message and available tools.

Current System Status: {{STATUS}}
Available Tools: {{TOOLS}}

1. "BUILD_TOOL": Use this if the user asks for:
    - A calculation, data processing, or logic task.
    - A specific utility NOT covered by Google Search (e.g., generating specific file formats, complex text manipulation).
    - A capability explicitly not in the "Available Tools" list.
2. "UPDATE_TOOL": Use this if:
    - The user specifically asks to modify, improve, fix, or change the behavior of an EXISTING tool.
    - The user PROVIDES an API Key, token, or credentials (e.g., "here is my key", "sk-...", "use this api key"). In this case, 'details' should be "Inject this API key: [KEY] into the tool [TOOL_NAME]".
3. "DELETE_TOOL": Use this if the user specifically asks to delete or remove an EXISTING tool.
4. "CHAT": Use this for:
    - General conversation.
    - Questions about current events, news, or general knowledge (Use your built-in Google Search).
    - Executing an EXISTING tool from the list.
    - If the Current System Status is "BUILDING", and the user asks about progress.

Output JSON: 
{ 
  "action": "BUILD_TOOL" | "UPDATE_TOOL" | "DELETE_TOOL" | "CHAT", 
  "toolName": "name of tool to use/build/update/delete",
  "details": "precise description of tool requirement or update" 
}
`;

// In-memory session history
const sessions = new Map();

export const orchestrator = {
  /**
   * Processes a message.
   * @param {string} sessionId 
   * @param {string} message 
   * @param {function} sendEvent - Sends immediate response to the HTTP stream.
   * @param {function} broadcastEvent - Sends background events to the SSE stream.
   */
  async processUserMessage(sessionId, message, sendEvent, broadcastEvent) {
    // 1. Initialize Session
    let session = sessions.get(sessionId);
    if (!session) {
      session = {
        history: [
          { role: 'user', parts: [{ text: "System: You are Nexus. You have access to Google Search for real-time info, and a Builder Agent to code custom tools." }] },
          { role: 'model', parts: [{ text: "Understood. I am the Main Agent. I can search the web or build tools." }] }
        ],
        status: 'IDLE' // IDLE | BUILDING
      };
      sessions.set(sessionId, session);
    }

    const toolNames = toolRegistry.getAll().map(t => t.name).join(', ');

    try {
      // 2. Decide Intent
      const recentHistory = session.history.slice(-4).map(h => `${h.role.toUpperCase()}: ${h.parts[0].text}`).join('\n');

      const decisionContext = `
      Conversation History:
      ${recentHistory}

      User Message: ${message}
      `;

      const prompt = DECISION_PROMPT
        .replace('{{TOOLS}}', toolNames)
        .replace('{{STATUS}}', session.status);

      const decisionReq = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: decisionContext,
        config: {
          systemInstruction: prompt,
          responseMimeType: "application/json"
        }
      });
      
      const decision = JSON.parse(decisionReq.text);

      // --- HANDLE DELETE ---
      if (decision.action === 'DELETE_TOOL') {
         const name = decision.toolName;
         if (toolRegistry.delete(name)) {
             sendEvent({ type: 'text', content: `I have deleted the tool "${name}".` });
             broadcastEvent({ type: 'tool_update' }); 
         } else {
             sendEvent({ type: 'text', content: `I couldn't find a tool named "${name}" to delete.` });
         }
         sendEvent({ type: 'done' });
         return;
      }

      // --- HANDLE UPDATE or BUILD (ASYNC) ---
      if (decision.action === 'BUILD_TOOL' || decision.action === 'UPDATE_TOOL') {
        const isUpdate = decision.action === 'UPDATE_TOOL';
        
        // Immediate Response
        const responseText = isUpdate 
           ? `I've asked the Builder to update "${decision.toolName}".`
           : `I've instructed the Builder to create that tool. You can keep chatting with me while it works.`;
        
        sendEvent({ type: 'text', content: responseText });
        sendEvent({ type: 'done' }); // Close the HTTP request immediately

        // Update History
        session.history.push({ role: 'user', parts: [{ text: message }] });
        session.history.push({ role: 'model', parts: [{ text: responseText }] });
        session.status = 'BUILDING';
        sessions.set(sessionId, session);

        // --- Start Background Task ---
        (async () => {
            let builderRequirement = decision.details || message;
            if (isUpdate) {
                const oldTool = toolRegistry.get(decision.toolName);
                if (oldTool) {
                    builderRequirement = `Update the existing tool '${decision.toolName}'. \n\nOriginal Description: ${oldTool.description}\nOriginal Code: ${oldTool.implementation}\n\nModification Request: ${decision.details}`;
                } else {
                    builderRequirement = `Update tool '${decision.toolName}'. Request: ${decision.details}`;
                }
            }

            // Notify via SSE
            broadcastEvent({ 
              type: 'inter_agent', 
              from: 'Main Agent', 
              to: 'Builder', 
              content: `Requesting ${isUpdate ? 'update' : 'new tool'}: ${builderRequirement}` 
            });

            try {
              // Delegate to Builder
              const buildResult = await builder.buildAndVerify(builderRequirement, (log) => {
                 // Check if the Builder wants to talk to the user directly
                 if (log.type === 'builder_talk') {
                     broadcastEvent({ type: 'text', role: 'builder', content: log.content });
                 } else {
                     broadcastEvent(log);
                 }
              });
              
              broadcastEvent({ type: 'tool_update', tool: buildResult.tool }); 
              
              if (buildResult.status === 'missing_key') {
                 // The builder should have already spoken to the user via the callback, 
                 // but we ensure the status reflects it.
                 broadcastEvent({ 
                    type: 'inter_agent', 
                    from: 'Builder', 
                    to: 'Main Agent', 
                    content: `Tool '${buildResult.tool.name}' built, but paused due to missing API Key.` 
                 });
              } else {
                 broadcastEvent({ 
                    type: 'inter_agent', 
                    from: 'Builder', 
                    to: 'Main Agent', 
                    content: `Task complete. '${buildResult.tool.name}' is verified.` 
                 });
                 broadcastEvent({ 
                    type: 'inter_agent', 
                    from: 'Main Agent', 
                    to: 'Builder', 
                    content: `Thanks, I've added it to my toolkit.` 
                 });
              }

            } catch (buildError) {
               broadcastEvent({ type: 'error', content: `Builder Error: ${buildError.message}` });
            } finally {
               // Reset status
               const currentSession = sessions.get(sessionId);
               if (currentSession) {
                   currentSession.status = 'IDLE';
                   sessions.set(sessionId, currentSession);
               }
            }
        })();

        return; 
      }

      // 4. Chat Loop (Execution Phase) - Synchronous for normal chat
      
      // Merge registered tools with the native Google Search tool
      const registeredTools = toolRegistry.getDeclarations().map(d => ({ functionDeclarations: [d] }));
      const allTools = [
        ...registeredTools,
        { googleSearch: {} } // Enable Google Search Grounding for Main Agent
      ];

      const chat = ai.chats.create({
        model: 'gemini-2.5-flash',
        history: session.history,
        config: {
          tools: allTools
        }
      });

      let result = await chat.sendMessage({ message: message });
      
      let functionCallAttempts = 0;
      const MAX_FUNCTION_CALLS = 5;

      while (
        result.candidates && 
        result.candidates[0].content.parts.some(p => p.functionCall) &&
        functionCallAttempts < MAX_FUNCTION_CALLS
      ) {
        functionCallAttempts++;
        const parts = result.candidates[0].content.parts;
        const toolOutputs = [];
        
        for (const part of parts) {
          if (part.functionCall) {
            const { name, args } = part.functionCall;
            
            // Log to background stream
            broadcastEvent({ type: 'log', content: `Executing tool: ${name}...` });
            broadcastEvent({ type: 'inter_agent', from: 'Main Agent', to: 'System', content: `Calling ${name}(${JSON.stringify(args)})` });
            
            let executionResult;
            try {
               executionResult = await toolRegistry.execute(name, args);
               toolOutputs.push({
                 functionResponse: { name, response: { result: executionResult } }
               });
            } catch (err) {
               console.error(`[Main Agent] Tool execution failed: ${err.message}`);
               toolOutputs.push({
                 functionResponse: { name, response: { error: err.message } }
               });
            }
          }
        }
        
        if (toolOutputs.length > 0) {
           result = await chat.sendMessage({ message: toolOutputs });
        } else {
           // Should not happen if there was a function call, but safeguards infinite loop
           break;
        }
      }

      const finalText = result.text;
      
      session.history.push({ role: 'user', parts: [{ text: message }] });
      session.history.push({ role: 'model', parts: [{ text: finalText }] });
      sessions.set(sessionId, session);

      sendEvent({ type: 'text', content: finalText });
      sendEvent({ type: 'done' });

    } catch (e) {
      console.error("Orchestrator Critical Error:", e);
      sendEvent({ type: 'error', content: `System Error: ${e.message}` });
    }
  }
};