'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

// Nothing fancy — no streaming this milestone (YAGNI; add if the demo needs the polish later).
export function ChatPanel({ accessToken }: { accessToken: string }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSend() {
    const trimmed = input.trim();
    if (!trimmed || sending) return;

    setMessages((prev) => [...prev, { role: 'user', content: trimmed }]);
    setInput('');
    setSending(true);
    setError(null);

    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_BASE_URL}/api/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ message: trimmed }),
      });
      if (!res.ok) throw new Error(`Chat request failed: ${res.status}`);
      const data = (await res.json()) as { reply: string; toolCalls: string[] };
      setMessages((prev) => [...prev, { role: 'assistant', content: data.reply }]);
    } catch {
      setError("Couldn't reach Switch — please try again.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex max-h-96 min-h-24 flex-col gap-3 overflow-y-auto">
        {messages.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No messages yet — ask about your spending, or tell Switch a rule to remember.
          </p>
        ) : (
          messages.map((m, i) => (
            <div
              key={i}
              className={
                m.role === 'user'
                  ? 'ml-auto max-w-[80%] rounded-lg bg-primary px-3 py-2 text-sm whitespace-pre-wrap text-primary-foreground'
                  : 'mr-auto max-w-[80%] rounded-lg bg-muted px-3 py-2 text-sm whitespace-pre-wrap'
              }
            >
              {m.content}
            </div>
          ))
        )}
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
          placeholder="Ask Switch a question…"
          disabled={sending}
          className="h-9 flex-1 rounded-lg border border-border bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50"
        />
        <Button onClick={handleSend} disabled={sending || input.trim().length === 0}>
          {sending ? 'Sending…' : 'Send'}
        </Button>
      </div>
    </div>
  );
}
