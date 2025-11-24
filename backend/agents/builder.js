import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';
import { toolRegistry } from '../services/toolRegistry.js';

dotenv.config();

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

const BUILDER_PROMPT = `
You are the "Builder Agent". You are a senior JavaScript engineer.
Your goal is to build a robust, ASYNCHRONOUS JavaScript tool and TEST cases for it.
The environment supports 'fetch' for network requests.
IMPORTANT: The code must be compatible with Node.js 'vm' context (no 'require', 'import', or DOM access like 'document' or 'window').

AVAILABLE GLOBALS:
- fetch, URL, URLSearchParams
- db: A simple persistent key-value store. 
    - db.set(key, value): void
    - db.get(key): any
    - db.delete(key): boolean
    - db.list(): string[] (returns keys)

Input: Tool Requirement.

Output JSON:
{
  "toolName": "camelCaseName",
  "description": "Short description",
  "parameters": {
    "type": "OBJECT",
    "properties": {
       // Open API 3.0 properties
    },
    "required": ["param1"]
  },
  "implementationBody": "// Example: db.set('username', args.name); return 'Saved ' + args.name;",
  "testCases": [
    { 
      "args": { "n": 5 }, 
      "expectedReturn": 120, 
      "description": "Should calculate factorial of 5"
    },
    {
      "args": { "query": "latest" },
      "expectedType": "array", 
      "description": "Should return a list of items for non-deterministic tools"
    }
  ]
}
`;

const FIXER_PROMPT = `
You are the "Builder Agent" fixing your own code.
The tool failed the "Perfect Check" (assertion testing).

Input:
1. Original Spec
2. Error Message from Test Execution (Expected vs Actual)

Output:
The complete, corrected JSON object (same structure as Builder).
Ensure the "toolName" remains the same unless it was invalid.
Ensure valid JSON. Do not wrap in markdown.
`;

export const builder = {
  /**
   * Orchestrates the Build -> Test -> Fix loop.
   * Now supports streaming logs via callback.
   */
  async buildAndVerify(requirement, logCallback = () => {}) {
    let attempts = 0;
    const maxAttempts = 3;
    let lastError = null;
    let currentSpec = null;

    logCallback({ type: 'log', content: `[Builder] Analyzing requirement: "${requirement}"...` });

    // 1. Initial Design
    try {
      currentSpec = await this.generateSpec(requirement);
      logCallback({ type: 'log', content: `[Builder] Generated initial design for '${currentSpec.toolName}'` });
    } catch (e) {
      throw new Error(`Failed to generate initial design: ${e.message}`);
    }

    // 2. Verify Loop
    while (attempts < maxAttempts) {
      attempts++;
      logCallback({ type: 'log', content: `[Builder] Cycle ${attempts}/${maxAttempts}: Running strict verification...` });

      try {
        // Register temporarily to test execution
        toolRegistry.register(currentSpec);
        const testResult = await this.runTests(currentSpec);

        if (testResult.success) {
          logCallback({ type: 'log', content: `[Builder] ✅ All tests passed perfectly.` });
          return {
            tool: toolRegistry.get(currentSpec.toolName),
            logs: `Builder Agent: The tool building is finished. I have built and verified '${currentSpec.toolName}'.`,
            status: 'success'
          };
        }

        // Check for specific Auth Errors (Missing API Key)
        if (testResult.isAuthError) {
           logCallback({ type: 'log', content: `[Builder] ⚠️ Authentication/API Key missing detected.` });
           return {
             tool: toolRegistry.get(currentSpec.toolName),
             logs: `Builder Agent: The tool '${currentSpec.toolName}' was built but failed authentication tests. It likely requires an API Key.`,
             status: 'missing_key'
           };
        }

        // Generic Test Failed
        lastError = testResult.error;
        logCallback({ type: 'log', content: `[Builder] ❌ Check Failed: ${lastError}. Fixing code...` });

        // 3. Self-Correction
        const originalName = currentSpec.toolName;
        currentSpec = await this.fixSpec(currentSpec, lastError);
        
        // Critical: Ensure we don't lose the tool name if the LLM hallucinated/omitted it
        if (!currentSpec.toolName && originalName) {
           currentSpec.toolName = originalName;
        }

      } catch (e) {
        console.error("Builder Loop Error:", e);
        // Use fallback error message if available
        const msg = e.message || "Unknown error";
        
        if (attempts >= maxAttempts) {
             throw new Error(`Builder Agent failed after ${maxAttempts} attempts. Last error: ${msg}`);
        }
        // If it was a registration error (invalid name), try to fix it in next loop
        lastError = msg;
      }
    }

    throw new Error(`Builder Agent failed to create a working tool after ${maxAttempts} attempts. Last error: ${lastError}`);
  },

  async generateSpec(requirement) {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: `Requirement: ${requirement}`,
      config: {
        systemInstruction: BUILDER_PROMPT,
        responseMimeType: "application/json",
        temperature: 0.2
      }
    });
    return this._parseJson(response.text);
  },

  async fixSpec(brokenSpec, errorMsg) {
    const context = `
      The tool execution failed validation.
      Current Implementation: ${brokenSpec.implementationBody}
      Test Input Causing Error: ${JSON.stringify(brokenSpec.testCases)}
      Error Output: ${errorMsg}
    `;

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: context,
      config: {
        systemInstruction: FIXER_PROMPT,
        responseMimeType: "application/json"
      }
    });
    return this._parseJson(response.text);
  },

  async runTests(spec) {
    if (!spec.testCases || spec.testCases.length === 0) {
      return { success: true }; // No tests generated
    }

    for (const [i, test] of spec.testCases.entries()) {
      try {
        // await the execution since tools are now async
        const result = await toolRegistry.execute(spec.toolName, test.args);
        
        if (result === undefined) {
           throw new Error("Function returned undefined");
        }

        // Assertion 1: Strict Equality (for deterministic tools like Math)
        if (test.expectedReturn !== undefined) {
           const actualStr = JSON.stringify(result);
           const expectedStr = JSON.stringify(test.expectedReturn);
           if (actualStr !== expectedStr) {
             throw new Error(`Assertion Failed. Expected ${expectedStr}, got ${actualStr}`);
           }
        }

        // Assertion 2: Type Check (for non-deterministic tools like News/Random)
        if (test.expectedType) {
           const type = Array.isArray(result) ? 'array' : typeof result;
           if (type !== test.expectedType) {
              throw new Error(`Type Mismatch. Expected ${test.expectedType}, got ${type}`);
           }
        }

      } catch (e) {
        // Detect Auth Errors
        const msg = e.message.toLowerCase();
        if (
            msg.includes('401') || 
            msg.includes('403') || 
            msg.includes('unauthorized') || 
            msg.includes('forbidden') || 
            msg.includes('api key') ||
            msg.includes('apikey')
        ) {
            return { success: false, error: e.message, isAuthError: true };
        }

        return { success: false, error: `Test Case #${i + 1} (${test.description || 'Unknown'}): ${e.message}` };
      }
    }

    return { success: true };
  },

  // Helper to reliably parse JSON from LLM output, stripping markdown
  _parseJson(text) {
    if (!text) throw new Error("Empty response from model");
    try {
      // Remove ```json and ``` if present
      let clean = text.replace(/```json/g, '').replace(/```/g, '').trim();
      return JSON.parse(clean);
    } catch (e) {
      console.error("JSON Parse Error. Raw text:", text);
      throw new Error("Failed to parse tool specification from model output");
    }
  }
};
