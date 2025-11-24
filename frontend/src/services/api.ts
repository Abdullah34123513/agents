const API_URL = 'http://localhost:3000/api';

export const api = {
  async sendMessage(message: string) {
    const res = await fetch(`${API_URL}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message })
    });
    return res.json();
  },

  async getTools() {
    const res = await fetch(`${API_URL}/tools`);
    return res.json();
  }
};