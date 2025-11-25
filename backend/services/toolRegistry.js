import vm from 'vm';
import { Type } from '@google/genai';

class ToolRegistry {
  constructor() {
    this.tools = new Map();
    this.store = new Map(); 
  }

  register(toolSpec) {
    const nameRegex = /^[a-zA-Z_][\w.:-]{0,63}$/;
    
    if (!toolSpec.toolName || !nameRegex.test(toolSpec.toolName)) {
      throw new Error(`Invalid tool name: '${toolSpec.toolName}'.`);
    }

    const declaration = {
      name: toolSpec.toolName,
      description: toolSpec.description || "No description provided",
      parameters: {
        type: Type.OBJECT,
        properties: {},
        required: toolSpec.parameters?.required || []
      }
    };

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

    this.tools.set(tool.name, tool);
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

  delete(name) {
    return this.tools.delete(name);
  }

  async execute(name, args) {
    const tool = this.tools.get(name);
    if (!tool) throw new Error(`Tool ${name} not found`);

    try {
      // Capture logs from inside the VM
      let logs = [];
      const safeConsole = {
        log: (...args) => logs.push(args.map(a => String(a)).join(' ')),
        error: (...args) => logs.push("ERROR: " + args.map(a => String(a)).join(' ')),
        warn: (...args) => logs.push("WARN: " + args.map(a => String(a)).join(' ')),
      };

      const utils = {
        sleep: (ms) => new Promise(resolve => setTimeout(resolve, ms)),
        uuid: () => Math.random().toString(36).substring(2) + Date.now().toString(36),
        safeJsonParse: (str, fallback) => { try { return JSON.parse(str); } catch { return fallback; } },
      };

      const context = vm.createContext({ 
        console: safeConsole, 
        args, 
        utils, 
        fetch: global.fetch,
        URL: global.URL,
        URLSearchParams: global.URLSearchParams,
        setTimeout: global.setTimeout,
        clearTimeout: global.clearTimeout,
        Math: Math,
        Date: Date,
        JSON: JSON,
        db: {
          get: (k) => this.store.get(k),
          set: (k, v) => this.store.set(k, v),
          delete: (k) => this.store.delete(k)
        }
      });

      const code = `(async function() { 
        try {
          ${tool.implementation}
        } catch(e) {
          throw e;
        }
      })()`;
      
      const result = await vm.runInContext(code, context);
      return result;
    } catch (error) {
      // Clean up stack trace to hide VM internals from the LLM
      throw new Error(`Runtime Error in '${name}': ${error.message}`);
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
