import { createBrowserClient } from '@supabase/ssr';

export function getSupabaseBrowserClient() {
  // @supabase/ssr always forces flowType: 'pkce', so signInWithOtp() sends a
  // code_challenge and the email link redirects back with ?code=... (not a
  // #access_token= hash). Leave detectSessionInUrl at its default (true) so the
  // client auto-exchanges that code for a session using the code_verifier it
  // already stored in a cookie — login/page.tsx just waits on getSession().
  return createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
}
