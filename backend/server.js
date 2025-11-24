import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { orchestrator } from './agents/orchestrator.js';
import { toolRegistry } from './services/toolRegistry.js';

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Health Check
app.get('/health', (req, res) => res.send('Nexus Backend Active'));

// Get all available tools
app.get('/api/tools', (req, res) => {
  res.json(toolRegistry.getAll());
});

// Streaming Chat Endpoint
app.post('/api/chat', async (req, res) => {
  const { message, sessionId } = req.body;

  // Set headers for streaming
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Transfer-Encoding', 'chunked');

  // Callback to write data to stream
  const sendEvent = (data) => {
    // We send newline-delimited JSON
    res.write(JSON.stringify(data) + "\n");
  };

  try {
    await orchestrator.processUserMessage(sessionId || 'default', message, sendEvent);
  } catch (error) {
    console.error('Server Error:', error);
    sendEvent({ type: 'error', content: `System Error: ${error.message}` });
  } finally {
    res.end();
  }
});

app.listen(port, () => {
  console.log(`Nexus Backend listening on port ${port}`);
});