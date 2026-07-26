import { Router } from 'express';
import { sendChatMessage } from '../chat/chatService.js';
import { requireUser } from '../auth/requireUser.js';

// DI-via-factory-function: tests inject a stub `sendMessage` here instead of mocking the
// `chatService` module, since the default `sendChatMessage` would otherwise reach for the
// real Anthropic API. Production code (router.ts) uses the default export, `chatRouter`.
export function createChatRouter(sendMessage: typeof sendChatMessage = sendChatMessage) {
  const router = Router();

  router.post('/chat', requireUser, async (req, res) => {
    const { message } = req.body as { message?: unknown };
    if (typeof message !== 'string' || message.trim().length === 0) {
      res.status(400).json({ error: 'message is required' });
      return;
    }
    const result = await sendMessage(req.userId!, message);
    res.json(result);
  });

  return router;
}

export const chatRouter = createChatRouter();
