import { GoogleGenAI } from '@google/genai';
import { toolRegistry } from '../services/toolRegistry.js';
import { builder } from './builder.js';
import dotenv from 'dotenv';

dotenv.config();

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

const DECISION_PROMPT = `
You are the "Main Agent". You are helpful and conversational.
Decide the next action based on the user's message and available tools.

Available Tools: {{TOOLS}}

1. "BUILD_TOOL": Use this if the user asks for:
    - A calculation, data processing, or logic task.
    - Access to **real-time data or external information** (news, weather, stock prices, web search) that you cannot answer with your internal knowledge.
    - A specific capability not in the "Available Tools" list.
2. "UPDATE_TOOL": Use this if:
    - The user specifically asks to modify, improve, fix, or change the behavior of an EXISTING tool.
    - The user PROVIDES an API Key, token, or credentials (e.g., "here is my key", "sk-...", "use this api key"). In this case, 'details' should be "Inject this API key: [KEY] into the tool [TOOL_NAME]".
3. "DELETE_TOOL": Use this if the user specifically asks to delete or remove an EXISTING tool.
4. "CHAT": Use this for general conversation, OR if you can use an EXISTING tool from the list above without modification.

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
  // Now accepts a callback 'sendEvent' to stream chunks to the frontend
  async processUserMessage(sessionId, message, sendEvent) {
    // 1. Initialize History
    let history = sessions.get(sessionId);
    if (!history) {
      history = [
        { role: 'user', parts: [{ text: "System: You are Nexus. You work with a Builder Agent. If you lack a capability (like fetching news), you should build a tool for it." }] },
        { role: 'model', parts: [{ text: "Understood. I am the Main Agent. I will coordinate with the Builder to expand my capabilities." }] }
      ];
    }

    const toolNames = toolRegistry.getAll().map(t => t.name).join(', ');

    try {
      // 2. Decide Intent
      // Include recent history for context (handle "Yes/No" flows)
      const recentHistory = history.slice(-4).map(h => `${h.role.toUpperCase()}: ${h.parts[0].text}`).join('\n');

      const decisionContext = `
      Conversation History:
      ${recentHistory}

      User Message: ${message}
      `;

      const decisionReq = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: decisionContext,
        config: {
          systemInstruction: DECISION_PROMPT.replace('{{TOOLS}}', toolNames),
          responseMimeType: "application/json"
        }
      });
      
      const decision = JSON.parse(decisionReq.text);

      // --- HANDLE DELETE ---
      if (decision.action === 'DELETE_TOOL') {
         const name = decision.toolName;
         if (toolRegistry.delete(name)) {
             sendEvent({ type: 'text', content: `I have deleted the tool "${name}" from the registry.` });
             sendEvent({ type: 'tool_update' }); // Triggers refresh on frontend
         } else {
             sendEvent({ type: 'text', content: `I couldn't find a tool named "${name}" to delete.` });
         }
         sendEvent({ type: 'done' });
         return;
      }

      // --- HANDLE UPDATE or BUILD ---
      if (decision.action === 'BUILD_TOOL' || decision.action === 'UPDATE_TOOL') {
        const isUpdate = decision.action === 'UPDATE_TOOL';
        const msg = isUpdate 
           ? `I am instructing the Builder Agent to update tool "${decision.toolName}" based on your request: "${decision.details}"...\n\n`
           : `I see you need a tool for "${decision.details}". I am instructing the Builder Agent to create it now.\n\n`;
        
        sendEvent({ type: 'text', content: msg });
        
        // If Update, construct a richer context for the builder
        let builderRequirement = decision.details || message;
        if (isUpdate) {
            const oldTool = toolRegistry.get(decision.toolName);
            if (oldTool) {
                builderRequirement = `Update the existing tool '${decision.toolName}'. \n\nOriginal Description: ${oldTool.description}\nOriginal Code: ${oldTool.implementation}\n\nModification Request: ${decision.details}`;
            } else {
                // If specific tool not found, look for most likely candidate if key provided
                // This is a basic fallback
                builderRequirement = `Update tool '${decision.toolName}'. Request: ${decision.details}`;
            }
        }

        try {
          // Delegation: Wait for Builder to Finish, while streaming logs
          const buildResult = await builder.buildAndVerify(builderRequirement, (log) => {
             // Pass builder logs to frontend
             sendEvent(log);
          });
          
          sendEvent({ type: 'log', content: buildResult.logs });
          sendEvent({ type: 'tool_update', tool: buildResult.tool }); // Signal to UI to update sidebar
          
          // Handle Missing Key Scenario
          if (buildResult.status === 'missing_key') {
             sendEvent({ type: 'text', content: `\n\n**Main Agent:** The tool '${buildResult.tool.name}' has been created, but it appears to require an API Key to function correctly.\n\nPlease provide the API Key (or URL/credentials) so I can update the tool with access.` });
             // Update history so context is aware
             history.push({ role: 'user', parts: [{ text: message }] });
             history.push({ role: 'model', parts: [{ text: `I built '${buildResult.tool.name}' but it needs an API Key.` }] });
             sessions.set(sessionId, history);
             sendEvent({ type: 'done' });
             return;
          }

          // Specific phrase requested by user (Success case)
          sendEvent({ type: 'text', content: `\n\n**Main Agent:** The tool ${isUpdate ? 'update' : 'building'} is finished. I can use the tool now.\n\n` });

        } catch (buildError) {
           sendEvent({ type: 'error', content: `Builder failed: ${buildError.message}` });
           return;
        }
      }

      // 4. Chat Loop (Execution Phase)
      const chat = ai.chats.create({
        model: 'gemini-2.5-flash',
        history: history,
        config: {
          tools: toolRegistry.getDeclarations().length > 0 
            ? [{ functionDeclarations: toolRegistry.getDeclarations() }] 
            : undefined
        }
      });

      // Send user message to model
      let result = await chat.sendMessage({ message: message });
      
      // Handle Function Calls
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
            sendEvent({ type: 'log', content: `[Main Agent] Executing tool: ${name}...` });
            
            let executionResult;
            try {
               // AWAIT the async tool execution
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
        
        // Send tool outputs back to Gemini
        result = await chat.sendMessage({ message: toolOutputs });
      }

      const finalText = result.text;
      
      // Update History
      history.push({ role: 'user', parts: [{ text: message }] });
      history.push({ role: 'model', parts: [{ text: finalText }] });
      sessions.set(sessionId, history);

      sendEvent({ type: 'text', content: finalText });
      sendEvent({ type: 'done' });

    } catch (e) {
      console.error("Orchestrator Critical Error:", e);
      sendEvent({ type: 'error', content: `System Error: ${e.message}` });
    }
  }
};
