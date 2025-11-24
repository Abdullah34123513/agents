import { GoogleGenAI } from '@google/genai';
import { toolRegistry } from '../services/toolRegistry.js';
import { builder } from './builder.js';
import dotenv from 'dotenv';

dotenv.config();

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

const DECISION_PROMPT = `
You are the Orchestrator. Decide the next action.
1. "BUILD_TOOL": If the user asks for a specific capability you don't have.
2. "CHAT": If you can answer with text or existing tools.

Available Tools: {{TOOLS}}

Output JSON: { "action": "BUILD_TOOL" | "CHAT", "details": "description of tool to build or empty" }
`;

// Simple in-memory session history
const sessions = new Map();

export const orchestrator = {
  async processUserMessage(sessionId, message) {
    const history = sessions.get(sessionId) || [];
    const toolNames = toolRegistry.getAll().map(t => t.name).join(', ');

    // 1. Decide Intent
    const decisionReq = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: `User Message: ${message}`,
      config: {
        systemInstruction: DECISION_PROMPT.replace('{{TOOLS}}', toolNames),
        responseMimeType: "application/json"
      }
    });
    
    const decision = JSON.parse(decisionReq.text);
    let systemResponse = "";
    let toolBuilt = null;

    // 2. Build Tool if needed
    if (decision.action === 'BUILD_TOOL') {
      try {
        const spec = await builder.build(decision.details || message);
        const tool = toolRegistry.register(spec);
        systemResponse = `[System] I have built a new tool: ${tool.name}. Now using it to answer.`;
        toolBuilt = tool;
      } catch (e) {
        return { text: `I tried to build a tool but failed: ${e.message}`, type: 'error' };
      }
    }

    // 3. Chat Loop (Run tool logic on Backend)
    // We create a fresh chat instance for the turn to include dynamic tools
    const chat = ai.chats.create({
      model: 'gemini-2.5-flash',
      history: history,
      config: {
        tools: toolRegistry.getDeclarations().length > 0 
          ? [{ functionDeclarations: toolRegistry.getDeclarations() }] 
          : undefined
      }
    });

    try {
      let result = await chat.sendMessage({ message: message });
      
      // Handle Function Calls loop
      while (result.candidates && result.candidates[0].content.parts.some(p => p.functionCall)) {
        const parts = result.candidates[0].content.parts;
        const toolOutputs = [];
        
        for (const part of parts) {
          if (part.functionCall) {
            const { name, args } = part.functionCall;
            let executionResult;
            try {
               executionResult = toolRegistry.execute(name, args);
               toolOutputs.push({
                 functionResponse: { name, response: { result: executionResult } }
               });
            } catch (err) {
               // Self-Correction Trigger could go here
               // For now, return error to model so it knows it failed
               toolOutputs.push({
                 functionResponse: { name, response: { error: err.message } }
               });
            }
          }
        }
        
        // Send results back to model
        result = await chat.sendMessage({ message: toolOutputs });
      }

      const finalText = result.text;
      
      // Update History (Simplified)
      history.push({ role: 'user', parts: [{ text: message }] });
      history.push({ role: 'model', parts: [{ text: finalText }] });
      sessions.set(sessionId, history);

      return {
        text: systemResponse ? `${systemResponse}\n\n${finalText}` : finalText,
        toolBuilt: toolBuilt,
        type: 'text'
      };

    } catch (e) {
      console.error("Orchestrator Chat Error:", e);
      return { text: "I encountered an error during conversation.", type: 'error' };
    }
  }
};