// Primary + fallback models for every OpenRouter call in this codebase. Pass the whole
// list as extra_body.models on each chat.completions.create() call — OpenRouter tries
// OPENROUTER_MODELS[0] first and automatically retries the next entry on rate-limiting,
// moderation, or provider downtime, billing only for whichever model actually ran.
// https://openrouter.ai/docs/guides/routing/model-fallbacks
export const OPENROUTER_MODELS = [
  'anthropic/claude-haiku-4.5',
  'anthropic/claude-3-5-haiku',
  'openai/gpt-4o-mini',
] as const;
