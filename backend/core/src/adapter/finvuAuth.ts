import { randomUUID } from 'node:crypto';
import { getFinvuConfig } from './finvuConfig.js';

let cachedToken: { token: string; expiresAt: number } | null = null;

function envelope(body: unknown) {
  return { header: { rid: randomUUID(), ts: new Date().toISOString(), channelId: 'finsense' }, body };
}

// fetchImpl is injectable (same DI seam as categorize/llmFallback.ts's classifyBatchWithClaude)
// so tests can stub the Finvu login round-trip and never touch the real sandbox network.
export async function getFinvuToken(fetchImpl: typeof fetch = fetch): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now()) return cachedToken.token;

  const config = getFinvuConfig();
  const res = await fetchImpl(`${config.baseUrl}/User/Login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(envelope({ userId: config.channelUserId, password: config.channelPassword })),
  });
  if (!res.ok) throw new Error(`Finvu login failed: ${res.status}`);
  const json = (await res.json()) as { body: { token: string } };

  // Token cache is valid 24h per the Finfactor docs; refresh a little early (23h) for safety margin.
  cachedToken = { token: json.body.token, expiresAt: Date.now() + 23 * 60 * 60 * 1000 };
  return cachedToken.token;
}

export function resetFinvuTokenCache(): void {
  cachedToken = null;
}
