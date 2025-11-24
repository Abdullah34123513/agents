import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';
import vm from 'vm';

dotenv.config();

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

const BUILDER_PROMPT = `
You are a specialized JavaScript Tool Builder.
Your task is to write a synchronous JavaScript function body based on a requirement.
The environment is Node.js 'vm'.

Output JSON:
{
  "toolName": "camelCaseName",
  "description": "Short description",
  "parameters": {
    "type": "OBJECT",
    "properties": {
       // Open API 3.0 properties
       // Example: "n": { "type": "NUMBER", "description": "value" }
    },
    "required": ["param1"]
  },
  "implementationBody": "return args.n * 2;" // The code using 'args' object
}
`;

const FIXER_PROMPT = `
You are a Code Fixer. Fix the JavaScript function body.
Output the same JSON structure as the Builder.
`;

export const builder = {
  async build(requirement) {
    try {
      console.log(`[Builder] Designing tool for: ${requirement}`);
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: `Requirement: ${requirement}`,
        config: {
          systemInstruction: BUILDER_PROMPT,
          responseMimeType: "application/json",
          temperature: 0.2
        }
      });
      
      const spec = JSON.parse(response.text);
      
      // TEST: Syntax Check
      this.testSyntax(spec.implementationBody);
      
      return spec;
    } catch (e) {
      console.error("[Builder] Build failed:", e);
      throw e;
    }
  },

  async fix(originalSpec, errorMsg) {
    try {
      console.log(`[Builder] Fixing tool ${originalSpec.toolName} error: ${errorMsg}`);
      const context = `
        Original Code: ${originalSpec.implementationBody}
        Error: ${errorMsg}
      `;
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: context,
        config: {
          systemInstruction: FIXER_PROMPT,
          responseMimeType: "application/json"
        }
      });
      
      const spec = JSON.parse(response.text);
      this.testSyntax(spec.implementationBody);
      return spec;
    } catch (e) {
      throw e;
    }
  },

  testSyntax(code) {
    try {
      new vm.Script(`(function(){ ${code} })`);
    } catch (e) {
      throw new Error(`Syntax Error: ${e.message}`);
    }
  }
};