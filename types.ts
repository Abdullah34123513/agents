import { FunctionDeclaration } from "@google/genai";

export enum MessageRole {
  USER = 'user',
  MODEL = 'model',
  SYSTEM = 'system'
}

export interface Message {
  id: string;
  role: MessageRole;
  content: string;
  type?: 'text' | 'tool-build' | 'error';
  metadata?: {
    toolName?: string;
    code?: string;
  };
}

export interface DynamicTool {
  name: string;
  description: string;
  declaration: FunctionDeclaration;
  implementation: string; // The function body as a string
  createdAt: number;
}

export interface ToolBuilderResponse {
  toolName: string;
  description: string;
  // We use a simplified schema structure for the builder to return, 
  // which we then convert to the strict FunctionDeclaration format
  parameters: {
    type: string;
    properties: Record<string, any>;
    required: string[];
  };
  implementationBody: string; // The JS code inside the function
}

export interface AgentState {
  status: 'idle' | 'analyzing' | 'building' | 'executing';
  currentTask?: string;
}
