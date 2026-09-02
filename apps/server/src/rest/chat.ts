import { Router } from 'express';
import { sendChatMessage } from '../chat/chatService.js';
import { requireUser } from '../auth/requireUser.js';

// DI-via-factory-function: tests inject a stub `sendMessage` here instead of mocking the
// `chatService` module, since the default `sendChatMessage` would otherwise reach for the
// real Anthropic API. Production code (router.ts) uses the default export, `chatRouter`.
export function createChatRouter(sendMessage: typeof sendChatMessage = sendChatMessage) {
  const router = Router();

  router.post('/chat', requireUser, async (req, res) => {
    const { message, memory_enabled } = req.body as { message?: unknown; memory_enabled?: unknown };
    if (typeof message !== 'string' || message.trim().length === 0) {
      res.status(400).json({ error: 'message is required' });
      return;
    }
    if (memory_enabled !== undefined && typeof memory_enabled !== 'boolean') {
      res.status(400).json({ error: 'memory_enabled must be a boolean' });
      return;
    }
    try {
      const result = await sendMessage(req.userId!, message, { memoryEnabled: memory_enabled ?? true });
      res.json(result);
    } catch (err) {
      // Without this, an error anywhere in the LLM call or tool-handler chain
      // becomes an unhandled promise rejection, which crashes the whole
      // process (Node's default since v15) instead of just failing this request.
      console.error('POST /api/chat failed:', err);
      res.status(502).json({ error: 'Failed to reach the chat model' });
    }
  });

  return router;
}

export const chatRouter = createChatRouter();
