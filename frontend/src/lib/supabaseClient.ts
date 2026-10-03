import { createBrowserClient } from '@supabase/ssr';

export function getSupabaseBrowserClient() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    return {
      auth: {
        getSession: async () => ({
          data: {
            session: {
              access_token: 'demo-token',
              token_type: 'bearer',
              expires_in: 3600,
              user: { id: 'demo-user-id', email: 'demo@switch.app' },
            },
          },
          error: null,
        }),
        getUser: async () => ({
          data: { user: { id: 'demo-user-id', email: 'demo@switch.app' } },
          error: null,
        }),
        signInWithOtp: async () => ({
          data: null,
          error: null,
        }),
        onAuthStateChange: () => ({
          data: { subscription: { unsubscribe: () => {} } },
        }),
        signOut: async () => ({ error: null }),
      },
    } as any;
  }

  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
}
