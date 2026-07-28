import { createBrowserClient } from '@supabase/ssr';

export function getSupabaseBrowserClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      auth: {
        // @supabase/ssr always forces flowType: 'pkce' (non-overridable), but our
        // dev login flow uses the Admin API's generateLink() to sidestep Supabase's
        // OTP-send rate limit, which produces classic implicit-grant hash tokens
        // (#access_token=...), not a PKCE `code`. The built-in detectSessionInUrl
        // rejects that mismatch silently (AuthPKCEGrantCodeExchangeError, swallowed
        // internally, never logged) instead of picking up the session, so we parse
        // the hash and call setSession() ourselves in login/page.tsx instead.
        detectSessionInUrl: false,
      },
    }
  );
}
