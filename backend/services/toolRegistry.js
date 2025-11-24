import vm from 'vm';
import { Type } from '@google/genai';

class ToolRegistry {
  constructor() {
    this.tools = new Map();
  }

  register(toolSpec) {
    // Convert simplified JSON schema to Gemini FunctionDeclaration
    const declaration = {
      name: toolSpec.toolName,
      description: toolSpec.description,
      parameters: {
        type: Type.OBJECT,
        properties: {},
        required: toolSpec.parameters?.required || []
      }
    };

    // Map properties if they exist
    if (toolSpec.parameters?.properties) {
      for (const [key, val] of Object.entries(toolSpec.parameters.properties)) {
        declaration.parameters.properties[key] = {
          type: this._mapType(val.type),
          description: val.description
        };
      }
    }

    const tool = {
      name: toolSpec.toolName,
      description: toolSpec.description,
      declaration: declaration,
      implementation: toolSpec.implementationBody,
      createdAt: Date.now()
    };

    // Overwrite if exists (useful for the Builder's fix loop)
    this.tools.set(tool.name, tool);
    console.log(`[Registry] Registered tool: ${tool.name}`);
    return tool;
  }

  get(name) {
    return this.tools.get(name);
  }

  getAll() {
    return Array.from(this.tools.values());
  }

  getDeclarations() {
    return Array.from(this.tools.values()).map(t => t.declaration);
  }

  async execute(name, args) {
    const tool = this.tools.get(name);
    if (!tool) throw new Error(`Tool ${name} not found`);

    try {
      // Execute in a fresh context (Sandbox) with FETCH and common Globals
      const context = vm.createContext({ 
        console, 
        args, 
        fetch: global.fetch,
        URL: global.URL,
        URLSearchParams: global.URLSearchParams,
        setTimeout: global.setTimeout,
        clearTimeout: global.clearTimeout,
        setInterval: global.setInterval,
        clearInterval: global.clearInterval
      });

      // Wrap code in an async IIFE
      const code = `(async function() { 
        try {
          ${tool.implementation}
        } catch(e) {
          throw e;
        }
      })()`;
      
      // Run and await the promise
      const result = await vm.runInContext(code, context);
      return result;
    } catch (error) {
      console.error(`[Registry] Execution failed for ${name}:`, error);
      throw new Error(`Tool execution error: ${error.message}`);
    }
  }

  _mapType(typeStr) {
    if (!typeStr) return Type.STRING;
    const map = {
      'STRING': Type.STRING,
      'NUMBER': Type.NUMBER,
      'INTEGER': Type.INTEGER,
      'BOOLEAN': Type.BOOLEAN,
      'ARRAY': Type.ARRAY,
      'OBJECT': Type.OBJECT
    };
    return map[typeStr.toUpperCase()] || Type.STRING;
  }
}

export const toolRegistry = new ToolRegistry();