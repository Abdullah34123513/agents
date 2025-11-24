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

// --- Server-Sent Events (SSE) Setup ---
const sseClients = new Map(); // sessionId -> res

const notifySession = (sessionId, data) => {
  const client = sseClients.get(sessionId);
  if (client) {
    // SSE format: data: JSON_STRING\n\n
    client.write(`data: ${JSON.stringify(data)}\n\n`);
  }
};

app.get('/api/events', (req, res) => {
  const { sessionId } = req.query;
  
  if (!sessionId) {
    return res.status(400).send('Missing sessionId');
  }

  // Set headers for SSE
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  console.log(`[SSE] Client connected: ${sessionId}`);
  sseClients.set(sessionId, res);

  // Send initial ping
  res.write(`data: ${JSON.stringify({ type: 'ping' })}\n\n`);

  // Cleanup on close
  req.on('close', () => {
    console.log(`[SSE] Client disconnected: ${sessionId}`);
    sseClients.delete(sessionId);
  });
});

// --- Chat Endpoint ---
app.post('/api/chat', async (req, res) => {
  const { message, sessionId } = req.body;

  if (!sessionId) {
    return res.status(400).json({ error: "Session ID required" });
  }

  // Set headers for streaming the immediate response
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Transfer-Encoding', 'chunked');

  // Callback to write data to the CURRENT HTTP response (Immediate Chat)
  const sendEvent = (data) => {
    res.write(JSON.stringify(data) + "\n");
  };

  // Callback to write data to the BACKGROUND SSE connection (Builder Logs)
  const broadcastEvent = (data) => {
    notifySession(sessionId, data);
  };

  try {
    // We pass both the immediate responder and the background broadcaster
    await orchestrator.processUserMessage(sessionId, message, sendEvent, broadcastEvent);
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