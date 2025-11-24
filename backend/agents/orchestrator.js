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

1. "BUILD_TOOL": Use this ONLY if the user asks for a calculation, data processing, or logic task that CANNOT be done with text or existing tools.
2. "CHAT": Use this for general conversation, OR if you can use an EXISTING tool from the list above.

Output JSON: { "action": "BUILD_TOOL" | "CHAT", "details": "precise description of tool to build" }
`;

// In-memory session history
const sessions = new Map();

export const orchestrator = {
  async processUserMessage(sessionId, message) {
    // 1. Initialize History
    let history = sessions.get(sessionId);
    if (!history) {
      history = [
        { role: 'user', parts: [{ text: "System: You are Nexus. You work with a Builder Agent." }] },
        { role: 'model', parts: [{ text: "Understood. I am the Main Agent. I will coordinate with the Builder." }] }
      ];
    }

    const toolNames = toolRegistry.getAll().map(t => t.name).join(', ');
    let systemNarrative = "";
    let toolBuilt = null;

    try {
      // 2. Decide Intent
      const decisionReq = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: `User Message: ${message}`,
        config: {
          systemInstruction: DECISION_PROMPT.replace('{{TOOLS}}', toolNames),
          responseMimeType: "application/json"
        }
      });
      
      const decision = JSON.parse(decisionReq.text);

      // 3. Invoke Builder Agent if needed
      if (decision.action === 'BUILD_TOOL') {
        systemNarrative += `**Main Agent:** I see you need a tool for "${decision.details}". Calling Builder Agent...\n\n`;
        
        try {
          // Delegation: Wait for Builder to Finish
          const buildResult = await builder.buildAndVerify(decision.details || message);
          
          toolBuilt = buildResult.tool;
          systemNarrative += `**${buildResult.logs}**\n\n`;
          systemNarrative += `**Main Agent:** Thank you, Builder. I will now use the '${toolBuilt.name}' tool.\n\n`;

        } catch (buildError) {
          return { 
            text: `**Main Agent:** I asked the Builder to create a tool, but they encountered a critical error: ${buildError.message}`,
            type: 'error' 
          };
        }
      }

      // 4. Chat Loop (Execution Phase)
      // We create a fresh chat config with the LATEST tools (including the new one)
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
      
      // Handle Function Calls (The Main Agent "using" the tool)
      // We limit the loop to prevent infinite tool calling loops
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
            console.log(`[Main Agent] Executing tool: ${name}`);
            
            let executionResult;
            try {
               // Execute safely via Registry
               executionResult = toolRegistry.execute(name, args);
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

      return {
        text: systemNarrative + finalText,
        toolBuilt: toolBuilt,
        type: 'text'
      };

    } catch (e) {
      console.error("Orchestrator Critical Error:", e);
      return { 
        text: `**Main Agent:** I lost connection with my thought process. (Error: ${e.message}). Please try asking again.`, 
        type: 'error' 
      };
    }
  }
};