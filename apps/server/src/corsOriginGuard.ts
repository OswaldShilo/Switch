// cors() treats `origin: undefined` as "reflect any request Origin", which is a
// silent CORS-to-`*` relaxation with no other signal. That's fine for local dev
// (nobody wants a hard crash just for forgetting to set an env var), but on a real
// deployment (e.g. Railway) it would quietly widen who can call this API with
// credentials. Pulled out of index.ts so it can be unit tested directly rather
// than only exercised through a full app boot.
export function warnIfWebOriginMissing(env: NodeJS.ProcessEnv = process.env): void {
  if (!env.WEB_ORIGIN) {
    console.warn('WEB_ORIGIN is not set — CORS will allow requests from any origin. Set WEB_ORIGIN in production.');
  }
}
