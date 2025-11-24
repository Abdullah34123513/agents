import express from 'express';
import cors from 'cors';
import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;
const apiKey = process.env.API_KEY;

if (!apiKey) {
  console.error("FATAL: API_KEY is missing in environment variables.");
  process.exit(1);
}

const ai = new GoogleGenAI({ apiKey });

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// --- Prompts ---

const DECISION_SYSTEM_PROMPT = `
You are the brain of an autonomous tool-building agent. 
Your goal is to decide if the user's request can be fulfilled by:
1. An existing tool in the provided list.
2. Generating a NEW tool using JavaScript.
3. Just answering with text (simple chit-chat).

Analyze the request. 
- If the user asks for a calculation, data transformation, or logic puzzle that you cannot confidently solve with simple text generation or existing tools, you MUST request a NEW tool.
- If you have an existing tool that matches the intent, use the existing tool.

Output JSON only:
{
  "decision": "USE_TOOL" | "BUILD_TOOL" | "TEXT_ONLY",
  "toolName": string (if USE_TOOL or BUILD_TOOL),
  "reasoning": string
}
`;

const BUILDER_SYSTEM_PROMPT = `
You are a senior JavaScript engineer. Your task is to generate a robust, safe, synchronous JavaScript function body based on a requirement.
The function will be executed in a browser environment using 'new Function'.

Input: A description of a tool needed.
Output: A JSON object strictly adhering to this structure:
{
  "toolName": "camelCaseName",
  "description": "Short description of what it does",
  "parameters": {
    "type": "OBJECT",
    "properties": {
       // Define parameters here using OpenAPI types (STRING, NUMBER, BOOLEAN, ARRAY, OBJECT)
       // Example: "x": { "type": "NUMBER", "description": "The first number" }
    },
    "required": ["list", "of", "required", "params"]
  },
  "implementationBody": "The pure JavaScript code that goes INSIDE the function body. It must return a value. Do not wrap in function signatures. Do not use async/await. Do not use external libraries."
}
`;

const FIX_SYSTEM_PROMPT = `
You are a senior JavaScript engineer and expert debugger.
Your task is to FIX a broken JavaScript function body based on an error report.
The function executes in a synchronous browser environment ('new Function').

Input: 
1. Original Tool Definition
2. Error Message
3. Arguments that caused the error

Output: 
A JSON object adhering to the tool definition schema.
{
  "toolName": "camelCaseName",
  "description": "Updated description if needed",
  "parameters": { 
     // Keep parameters compatible with the original call unless the error was due to parameter structure.
     "type": "OBJECT",
     "properties": { ... },
     "required": [...]
  },
  "implementationBody": "The FIXED JavaScript code. Handle edge cases. Validate inputs."
}
`;

// --- Session Store ---
const sessions = new Map();

// Cleanup
setInterval(() => {
  const now = Date.now();
  for (const [id, session] of sessions.entries()) {
    if (now - session.lastActive > 10 * 60 * 1000) {
      sessions.delete(id);
    }
  }
}, 60000);

// --- Routes ---

app.get('/health', (req, res) => res.send('Nexus Backend Online'));

app.post('/api/decide', async (req, res) => {
  try {
    const { userPrompt, availableToolNames } = req.body;
    const context = `
      User Request: "${userPrompt}"
      Available Tools: ${JSON.stringify(availableToolNames)}
    `;

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: context,
      config: {
        systemInstruction: DECISION_SYSTEM_PROMPT,
        responseMimeType: "application/json",
        temperature: 0.1,
      },
    });

    res.json(JSON.parse(response.text || '{}'));
  } catch (error) {
    console.error('Decide Error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/build', async (req, res) => {
  try {
    const { requirement } = req.body;
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: `Build a tool for: ${requirement}`,
      config: {
        systemInstruction: BUILDER_SYSTEM_PROMPT,
        responseMimeType: "application/json",
        temperature: 0.2,
      },
    });
    res.json(JSON.parse(response.text || '{}'));
  } catch (error) {
    console.error('Build Error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/fix', async (req, res) => {
  try {
    const { tool, error, args } = req.body;
    const context = `
      I have a tool that threw an error. Please fix the implementation.
      Tool Name: ${tool.name}
      Current Description: ${tool.description}
      Current Code: 
      ${tool.implementation}
      Error Message: "${error}"
      Arguments passed: ${JSON.stringify(args)}
    `;

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: context,
      config: {
        systemInstruction: FIX_SYSTEM_PROMPT,
        responseMimeType: "application/json",
        temperature: 0.1,
      },
    });
    res.json(JSON.parse(response.text || '{}'));
  } catch (error) {
    console.error('Fix Error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/chat/start', async (req, res) => {
  try {
    const { prompt, tools } = req.body;
    const sessionId = Math.random().toString(36).substring(7);
    
    // Initialize Chat
    const chat = ai.chats.create({
      model: 'gemini-2.5-flash',
      config: {
        // If no tools provided, pass undefined to avoid API error
        tools: tools && tools.length > 0 ? [{ functionDeclarations: tools }] : undefined,
      }
    });

    sessions.set(sessionId, { chat, lastActive: Date.now() });

    // Send message
    const result = await chat.sendMessage({ message: prompt });
    
    // Check for tool calls
    const toolCalls = result.candidates?.[0]?.content?.parts?.filter(p => p.functionCall);

    if (toolCalls && toolCalls.length > 0) {
      const formattedCalls = toolCalls.map(p => ({
        name: p.functionCall.name,
        args: p.functionCall.args,
        id: p.functionCall.name 
      }));

      return res.json({ 
        sessionId, 
        status: 'tool_call', 
        toolCalls: formattedCalls 
      });
    }

    res.json({ 
      sessionId, 
      status: 'complete', 
      text: result.text 
    });

  } catch (error) {
    console.error('Chat Start Error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/chat/reply', async (req, res) => {
  try {
    const { sessionId, toolOutputs } = req.body;
    const session = sessions.get(sessionId);

    if (!session) {
      return res.status(404).json({ error: "Session expired. Please restart." });
    }
    session.lastActive = Date.now();

    const responseParts = toolOutputs.map(output => ({
      functionResponse: {
        name: output.name,
        response: output.response
      }
    }));

    const result = await session.chat.sendMessage({ message: responseParts });

    const toolCalls = result.candidates?.[0]?.content?.parts?.filter(p => p.functionCall);

    if (toolCalls && toolCalls.length > 0) {
      const formattedCalls = toolCalls.map(p => ({
        name: p.functionCall.name,
        args: p.functionCall.args
      }));

      return res.json({ 
        sessionId, 
        status: 'tool_call', 
        toolCalls: formattedCalls 
      });
    }

    res.json({ 
      sessionId, 
      status: 'complete', 
      text: result.text 
    });

  } catch (error) {
    console.error('Chat Reply Error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.listen(port, () => {
  console.log(`Nexus Backend listening at http://localhost:${port}`);
});
