import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';
import { toolRegistry } from '../services/toolRegistry.js';

dotenv.config();

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

const BUILDER_PROMPT = `
You are the "Builder Agent". You are a senior JavaScript engineer.
Your goal is to build a robust, synchronous tool and TEST cases for it.

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
  "implementationBody": "return args.n * 2;",
  "testCases": [
    { 
      "args": { "n": 5 }, 
      "expectedOutcome": "Should return 10" 
    }
  ]
}
`;

const FIXER_PROMPT = `
You are the "Builder Agent" fixing your own code.
The tool failed during testing.

Input:
1. Original Spec
2. Error Message from Test Execution

Output:
The complete, corrected JSON object (same structure as Builder).
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
      logCallback({ type: 'log', content: `[Builder] Cycle ${attempts}/${maxAttempts}: Running tests...` });

      // Register temporarily to test execution
      toolRegistry.register(currentSpec);

      const testResult = this.runTests(currentSpec);

      if (testResult.success) {
        logCallback({ type: 'log', content: `[Builder] ✅ All tests passed.` });
        return {
          tool: toolRegistry.get(currentSpec.toolName),
          logs: `Builder Agent: I have built and tested '${currentSpec.toolName}'. It passed ${currentSpec.testCases?.length || 0} automated tests. Handing over to Main Agent.`
        };
      }

      // Test Failed
      lastError = testResult.error;
      logCallback({ type: 'log', content: `[Builder] ❌ Test failed: ${lastError}. Fixing code...` });

      // 3. Self-Correction
      try {
        currentSpec = await this.fixSpec(currentSpec, lastError);
      } catch (e) {
        throw new Error(`Builder crashed during self-correction: ${e.message}`);
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
    return JSON.parse(response.text);
  },

  async fixSpec(brokenSpec, errorMsg) {
    const context = `
      The tool execution failed.
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
    return JSON.parse(response.text);
  },

  runTests(spec) {
    if (!spec.testCases || spec.testCases.length === 0) {
      return { success: true }; // No tests generated
    }

    for (const test of spec.testCases) {
      try {
        const result = toolRegistry.execute(spec.toolName, test.args);
        if (result === undefined) {
          throw new Error("Function returned undefined");
        }
      } catch (e) {
        return { success: false, error: e.message };
      }
    }

    return { success: true };
  }
};