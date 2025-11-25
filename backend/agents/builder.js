import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';
import { toolRegistry } from '../services/toolRegistry.js';
import vm from 'vm';

dotenv.config();

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

const BUILDER_PROMPT = `
You are an expert JavaScript Tool Architect specialized in sandboxed environments.
Your goal is to write **Node.js-compatible** code that runs inside a restricted \`vm\` context.

**CRITICAL EXECUTION RULES:**
1. **NO** \`require()\`, **NO** \`import\`.
2. **NO** \`window\`, \`document\`, \`alert\`, or DOM APIs.
3. **NO** \`process.env\`.
4. **YES**: You have access to:
   - \`fetch\`, \`URL\`, \`URLSearchParams\`.
   - \`console.log\`.
   - \`utils.sleep(ms)\`, \`utils.uuid()\`, \`utils.safeJsonParse(str, default)\`.
   - \`db.get(key)\`, \`db.set(key, val)\`, \`db.delete(key)\`.
5. **ASYNC**: The code MUST be wrapped in an async pattern or use await naturally.
6. **ERRORS**: Throw descriptive errors if inputs are invalid or API calls fail.

**YOUR TASK:**
Create a tool based on the user's requirement.

**OUTPUT FORMAT (JSON ONLY):**
{
  "toolName": "camelCaseName",
  "description": "Short description",
  "parameters": {
    "type": "OBJECT",
    "properties": {
       // OpenAPI 3.0 Schema
    },
    "required": ["list", "of", "params"]
  },
  "implementationBody": "The JavaScript code block. DO NOT wrap in a function signature. Just write the body. \nExample:\n if (!args.url) throw new Error('Url missing');\n const res = await fetch(args.url);\n return res.json();",
  "testCases": [
    { 
      "args": { "param": "value" }, 
      "expectedType": "object", 
      "description": "Should fetch data successfully" 
    }
  ]
}
`;

const FIXER_PROMPT = `
You are the Builder Agent fixing a broken tool.
The code failed either Syntax Check or Runtime Verification.

**CONTEXT:**
- Tool Name: {{TOOL_NAME}}
- Current Code: 
\`\`\`javascript
{{CODE}}
\`\`\`
- Error Message: "{{ERROR}}"

**INSTRUCTIONS:**
1. Analyze the error carefully. 
   - If "ReferenceError", you used a variable/library not available in the VM.
   - If "SyntaxError", you missed a bracket or semicolon.
   - If "AssertionError", the logic is wrong.
2. Rewrite the "implementationBody" completely.
3. Ensure you follow the Sandbox Rules (No require, No DOM).

**OUTPUT JSON ONLY (Same schema as Builder).**
`;

export const builder = {
  /**
   * Orchestrates the Build -> Test -> Fix loop.
   */
  async buildAndVerify(requirement, logCallback = () => {}) {
    let attempts = 0;
    const maxAttempts = 3; // Reduced to 3 to prevent rate limit exhaustion
    let lastError = null;
    let currentSpec = null;

    logCallback({ type: 'inter_agent', from: 'Builder', to: 'Main Agent', content: `I'm analyzing the requirement: "${requirement}"` });

    // 1. Initial Design
    try {
      currentSpec = await this.generateSpec(requirement);
      logCallback({ type: 'inter_agent', from: 'Builder', to: 'Main Agent', content: `Drafted '${currentSpec.toolName}'. Verifying syntax...` });
    } catch (e) {
      throw new Error(`Failed to generate initial design: ${e.message}`);
    }

    // 2. Verify Loop
    while (attempts < maxAttempts) {
      attempts++;
      logCallback({ type: 'log', content: `Verification Cycle ${attempts}/${maxAttempts}...` });

      try {
        // Step A: Syntax Check (Pre-computation)
        this.checkSyntax(currentSpec.implementationBody);

        // Step B: Register & Run Runtime Tests
        toolRegistry.register(currentSpec);
        const testResult = await this.runTests(currentSpec);

        if (testResult.success) {
          logCallback({ type: 'inter_agent', from: 'Builder', to: 'Main Agent', content: `✅ Tool '${currentSpec.toolName}' passed all checks.` });
          return {
            tool: toolRegistry.get(currentSpec.toolName),
            status: 'success'
          };
        }

        // Step C: Handle Specific Auth Errors
        if (testResult.isAuthError) {
           return {
             tool: toolRegistry.get(currentSpec.toolName),
             status: 'missing_key'
           };
        }

        // Step D: Failure -> Prepare for Fix
        lastError = testResult.error;
        logCallback({ type: 'inter_agent', from: 'Builder', to: 'Main Agent', content: `❌ Test failed: ${lastError}. Fixing...` });

        // 3. Self-Correction
        const originalName = currentSpec.toolName;
        currentSpec = await this.fixSpec(currentSpec, lastError);
        
        // Restore name if lost
        if (!currentSpec.toolName && originalName) currentSpec.toolName = originalName;

      } catch (e) {
        console.error("Builder Loop Error:", e);
        lastError = e.message;
        
        // If it's a syntax error, try to fix it immediately via the loop
        if (attempts < maxAttempts) {
            logCallback({ type: 'log', content: `Syntax Error detected: ${e.message}. Attempting fix...` });
            currentSpec = await this.fixSpec(currentSpec, e.message);
        } else {
             throw new Error(`Failed to build tool after ${maxAttempts} attempts. Error: ${lastError}`);
        }
      }
    }

    throw new Error(`Builder gave up. Last error: ${lastError}`);
  },

  async generateSpec(requirement) {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: `Requirement: ${requirement}`,
      config: {
        systemInstruction: BUILDER_PROMPT,
        responseMimeType: "application/json",
        // ENABLE THINKING: This drastically improves code quality
        thinkingConfig: { thinkingBudget: 1024 }, 
        temperature: 0.2 // Low temp for precision
      }
    });
    return this._parseJson(response.text);
  },

  async fixSpec(brokenSpec, errorMsg) {
    const prompt = FIXER_PROMPT
      .replace('{{TOOL_NAME}}', brokenSpec.toolName)
      .replace('{{CODE}}', brokenSpec.implementationBody)
      .replace('{{ERROR}}', errorMsg);

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: "Fix the tool based on the error.",
      config: {
        systemInstruction: prompt,
        responseMimeType: "application/json",
        // Smaller thinking budget for fixes is usually sufficient
        thinkingConfig: { thinkingBudget: 512 }, 
      }
    });
    return this._parseJson(response.text);
  },

  /**
   * Fast fail if code is syntactically invalid JS.
   */
  checkSyntax(code) {
    try {
      // We wrap it in an async function to allow 'await' at top level of body
      new vm.Script(`(async () => { ${code} })`);
    } catch (e) {
      throw new Error(`SyntaxError: ${e.message}`);
    }
  },

  async runTests(spec) {
    if (!spec.testCases || spec.testCases.length === 0) return { success: true };

    for (const [i, test] of spec.testCases.entries()) {
      try {
        const EXECUTION_TIMEOUT = 5000;
        const executionPromise = toolRegistry.execute(spec.toolName, test.args);
        
        const timeoutPromise = new Promise((_, reject) => 
            setTimeout(() => reject(new Error(`Execution timed out (${EXECUTION_TIMEOUT}ms)`)), EXECUTION_TIMEOUT)
        );

        const result = await Promise.race([executionPromise, timeoutPromise]);
        
        // Negative Testing
        if (test.shouldError) {
           throw new Error(`Expected error, but got result: ${JSON.stringify(result)}`);
        }
        
        if (result === undefined && !test.allowUndefined) {
           throw new Error("Function returned undefined");
        }

        // Assertions
        if (test.expectedReturn !== undefined) {
           const actualStr = JSON.stringify(result);
           const expectedStr = JSON.stringify(test.expectedReturn);
           if (actualStr !== expectedStr) {
             throw new Error(`Expected ${expectedStr}, got ${actualStr}`);
           }
        }

        if (test.expectedType) {
           const type = Array.isArray(result) ? 'array' : typeof result;
           if (type !== test.expectedType) {
              throw new Error(`Expected type '${test.expectedType}', got '${type}'`);
           }
        }

      } catch (e) {
        if (test.shouldError) continue; // Pass

        // Auth detection
        const msg = e.message.toLowerCase();
        if (msg.includes('401') || msg.includes('403') || msg.includes('key')) {
            return { success: false, error: e.message, isAuthError: true };
        }

        return { success: false, error: `Test Case ${i + 1} Failed: ${e.message}` };
      }
    }
    return { success: true };
  },

  _parseJson(text) {
    if (!text) throw new Error("Empty response");
    try {
      const clean = text.replace(/```json/g, '').replace(/```/g, '').trim();
      return JSON.parse(clean);
    } catch (e) {
      // Heuristic: sometimes thinking models output text before JSON. 
      // Try finding the first { and last }
      const first = text.indexOf('{');
      const last = text.lastIndexOf('}');
      if (first !== -1 && last !== -1) {
         return JSON.parse(text.substring(first, last + 1));
      }
      throw new Error("Invalid JSON format");
    }
  }
};
