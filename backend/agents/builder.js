import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';
import { toolRegistry } from '../services/toolRegistry.js';

dotenv.config();

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

const BUILDER_PROMPT = `
You are the "Builder Agent", an Elite Senior Software Architect.
Your goal is to build a robust, ASYNCHRONOUS JavaScript tool and comprehensive TEST cases for it.

ENVIRONMENT:
- Runtime: Node.js 'vm' sandbox.
- Network: 'fetch' is available.
- Persistence: 'db' (simple kv store).
- Utils: 'utils' object available: { sleep(ms), uuid(), safeJsonParse(str, fallback), pick(obj, keys) }.
- Globals: console, URL, URLSearchParams, setTimeout, Math, Date, JSON.

INSTRUCTIONS:
1. **Chain-of-Thought Analysis**:
   - Analyze requirements deeply.
   - Identify external dependencies (API endpoints) and potential failure modes (404, 429, 500 errors).
   - Plan for edge cases (null inputs, empty strings, network timeouts).
2. **Defensive Implementation**:
   - Validate ALL inputs at the start of the function.
   - Use 'utils.sleep' for polling or rate-limit backoff if needed.
   - Handle API errors gracefully (throw clear, descriptive errors).
3. **Verification Strategy**:
   - **Positive Tests**: Standard happy path.
   - **Negative Tests**: Invalid inputs (must throw).
   - **Edge Case Tests**: Boundary values.

Output JSON only. Structure:
{
  "thoughtProcess": "1. Analysis: ... 2. Strategy: ... 3. Risks: ...",
  "toolName": "camelCaseName",
  "description": "Clear description",
  "parameters": {
    "type": "OBJECT",
    "properties": {
       // Open API 3.0 properties with detailed descriptions
    },
    "required": ["list", "of", "required", "params"]
  },
  "implementationBody": "// Javascript code. Use async/await. \\n// Example: \\nif(!args.id) throw new Error('Missing ID');\\nconst res = await fetch('...');",
  "testCases": [
    { 
      "args": { "n": 5 }, 
      "expectedReturn": 120, 
      "description": "Should calculate factorial of 5"
    },
    {
      "args": { "n": -1 },
      "shouldError": true,
      "description": "Should throw error for negative input"
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
   */
  async buildAndVerify(requirement, logCallback = () => {}) {
    let attempts = 0;
    const maxAttempts = 3;
    let lastError = null;
    let currentSpec = null;

    logCallback({ type: 'inter_agent', from: 'Builder', to: 'Main Agent', content: `I'm analyzing the requirement: "${requirement}"...` });

    // 1. Initial Design
    try {
      currentSpec = await this.generateSpec(requirement);
      if (currentSpec.thoughtProcess) {
         // Stream the thought process in chunks if it's long, or just a summary
         logCallback({ type: 'inter_agent', from: 'Builder', to: 'Main Agent', content: `Plan: ${currentSpec.thoughtProcess.substring(0, 100)}...` });
      }
      logCallback({ type: 'inter_agent', from: 'Builder', to: 'Main Agent', content: `I've drafted a design for '${currentSpec.toolName}'. Starting implementation...` });
    } catch (e) {
      throw new Error(`Failed to generate initial design: ${e.message}`);
    }

    // 2. Verify Loop
    while (attempts < maxAttempts) {
      attempts++;
      logCallback({ type: 'log', content: `Running tests (Cycle ${attempts})...` });
      logCallback({ type: 'inter_agent', from: 'Builder', to: 'Main Agent', content: `Running strict verification cycle ${attempts}/${maxAttempts}...` });

      try {
        // Register temporarily to test execution
        toolRegistry.register(currentSpec);
        const testResult = await this.runTests(currentSpec);

        if (testResult.success) {
          logCallback({ type: 'inter_agent', from: 'Builder', to: 'Main Agent', content: `✅ All ${currentSpec.testCases.length} tests passed. The tool '${currentSpec.toolName}' is verified and ready.` });
          return {
            tool: toolRegistry.get(currentSpec.toolName),
            status: 'success'
          };
        }

        // Check for specific Auth Errors (Missing API Key)
        if (testResult.isAuthError) {
           return {
             tool: toolRegistry.get(currentSpec.toolName),
             status: 'missing_key'
           };
        }

        // Generic Test Failed
        lastError = testResult.error;
        logCallback({ type: 'inter_agent', from: 'Builder', to: 'Main Agent', content: `❌ Test failed: ${lastError}. I need to fix the code.` });

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
        // Enforce a timeout for tool execution to prevent infinite loops
        const EXECUTION_TIMEOUT = 5000;
        const executionPromise = toolRegistry.execute(spec.toolName, test.args);
        const timeoutPromise = new Promise((_, reject) => 
            setTimeout(() => reject(new Error(`Execution timed out after ${EXECUTION_TIMEOUT}ms`)), EXECUTION_TIMEOUT)
        );

        const result = await Promise.race([executionPromise, timeoutPromise]);
        
        // Negative Testing: If we expected an error but got a result, FAIL.
        if (test.shouldError) {
           throw new Error(`Expected tool to throw error, but it returned: ${JSON.stringify(result)}`);
        }
        
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
        // Negative Testing: If we expected an error and got one, SUCCESS.
        if (test.shouldError) {
            continue; // Test passed
        }

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