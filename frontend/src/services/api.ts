const API_URL = 'http://localhost:3000/api';

export const api = {
  // Standard fetch for tools
  async getTools() {
    const res = await fetch(`${API_URL}/tools`);
    return res.json();
  },

  // Streaming fetch for chat
  async streamChat(message: string, onChunk: (chunk: any) => void) {
    const response = await fetch(`${API_URL}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message })
    });

    const reader = response.body?.getReader();
    if (!reader) throw new Error("No response body");

    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      
      // Process all complete lines
      buffer = lines.pop() || ''; // Keep the incomplete last line in buffer

      for (const line of lines) {
        if (line.trim()) {
          try {
            const json = JSON.parse(line);
            onChunk(json);
          } catch (e) {
            console.error("Parse error", e);
          }
        }
      }
    }
  }
};