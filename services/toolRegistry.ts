import { DynamicTool, ToolBuilderResponse } from "../types";
import { FunctionDeclaration, Type } from "@google/genai";

// Helper to map string types from JSON to Gemini Type enum
const mapType = (typeStr: string): Type => {
  const t = typeStr.toUpperCase();
  switch (t) {
    case 'STRING': return Type.STRING;
    case 'NUMBER': return Type.NUMBER;
    case 'INTEGER': return Type.INTEGER;
    case 'BOOLEAN': return Type.BOOLEAN;
    case 'ARRAY': return Type.ARRAY;
    case 'OBJECT': return Type.OBJECT;
    default: return Type.STRING;
  }
};

export class ToolRegistry {
  private tools: Map<string, DynamicTool> = new Map();

  registerTool(builderResponse: ToolBuilderResponse): DynamicTool {
    // 1. Create the FunctionDeclaration for Gemini
    const declaration: FunctionDeclaration = {
      name: builderResponse.toolName,
      description: builderResponse.description,
      parameters: {
        type: Type.OBJECT,
        properties: {},
        required: builderResponse.parameters.required
      }
    };

    // Recursively map properties (simplified for depth 1 for this demo)
    for (const [key, val] of Object.entries(builderResponse.parameters.properties)) {
      if (declaration.parameters && declaration.parameters.properties) {
        declaration.parameters.properties[key] = {
            type: mapType(val.type),
            description: val.description
        };
      }
    }

    // 2. Create the DynamicTool object
    const newTool: DynamicTool = {
      name: builderResponse.toolName,
      description: builderResponse.description,
      declaration,
      implementation: builderResponse.implementationBody,
      createdAt: Date.now()
    };

    this.tools.set(newTool.name, newTool);
    return newTool;
  }

  getTools(): DynamicTool[] {
    return Array.from(this.tools.values());
  }
  
  getTool(name: string): DynamicTool | undefined {
    return this.tools.get(name);
  }

  getDeclarations(): FunctionDeclaration[] {
    return Array.from(this.tools.values()).map(t => t.declaration);
  }

  executeTool(name: string, args: any): any {
    const tool = this.tools.get(name);
    if (!tool) {
      throw new Error(`Tool ${name} not found.`);
    }

    try {
      // DANGER: In a real production app, this requires sandboxing (e.g., Web Workers, WASM).
      // For this specific agent-builder demo, we use new Function to enable the core feature.
      const keys = Object.keys(args || {});
      const values = keys.map(key => args[key]);
      
      const func = new Function(...keys, tool.implementation);
      return func(...values);
    } catch (error: any) {
      console.error(`Error executing ${name}:`, error);
      throw new Error(`Execution failed: ${error.message}`);
    }
  }
}

export const toolRegistry = new ToolRegistry();