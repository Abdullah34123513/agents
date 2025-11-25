export interface DynamicTool {
  name: string;
  description: string;
  implementation: string;
}

export interface Message {
  id: string;
  role: 'user' | 'model' | 'system' | 'builder';
  content: string;
  metadata?: any;
}

export interface InterAgentMessage {
  id: string;
  from: string;
  to: string;
  content: string;
  timestamp: number;
}