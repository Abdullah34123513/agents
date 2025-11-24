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

// Get all available tools (for UI display)
app.get('/api/tools', (req, res) => {
  res.json(toolRegistry.getAll());
});

// Main Interaction Endpoint
app.post('/api/chat', async (req, res) => {
  try {
    const { message, sessionId } = req.body;
    
    // The Orchestrator handles the complexity:
    // 1. Decides intent (Chat vs Build)
    // 2. Builds tool if needed (delegating to Builder)
    // 3. Runs the conversation loop with Gemini (executing tools on backend)
    const result = await orchestrator.processUserMessage(sessionId || 'default', message);
    
    res.json(result);
  } catch (error) {
    console.error('Server Error:', error);
    res.status(500).json({ 
      text: `System Error: ${error.message}`,
      type: 'error'
    });
  }
});

app.listen(port, () => {
  console.log(`Nexus Backend listening on port ${port}`);
});