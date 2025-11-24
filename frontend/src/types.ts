export interface DynamicTool {
  name: string;
  description: string;
  implementation: string;
}

export interface Message {
  id: string;
  role: 'user' | 'model' | 'system';
  content: string;
  metadata?: any;
}