const API_URL = '/api'; // Use relative path since we have proxy in vite config

export const api = {
  // Standard fetch for tools
  async getTools() {
    const res = await fetch(`${API_URL}/tools`);
    return res.json();
  },

  getEventStreamUrl(sessionId: string) {
    return `${API_URL}/events?sessionId=${sessionId}`;
  },

  // Streaming fetch for chat
  async streamChat(message: string, sessionId: string, onChunk: (chunk: any) => void) {
    const response = await fetch(`${API_URL}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, sessionId })
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
      
      buffer = lines.pop() || ''; 

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