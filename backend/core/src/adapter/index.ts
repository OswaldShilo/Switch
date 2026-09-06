import type { AaAdapter } from './AaAdapter.js';
import { mockAdapter } from './mockAdapter.js';
import { finvuAdapter } from './finvuAdapter.js';

export function getAdapter(): AaAdapter {
  return process.env.MOCK_MODE === 'false' ? finvuAdapter : mockAdapter;
}
