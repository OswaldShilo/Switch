import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

// Next.js 15 made `cookies()` async, so this factory is async too (Server
// Components / Route Handlers must `await getSupabaseServerClient()`).
// Writing cookies from a Server Component is a no-op in Next.js (components
// can't set response cookies) — that's fine here because middleware.ts is
// the one place in this app responsible for refreshing/writing the session
// cookie back to the response.
export async function getSupabaseServerClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Called from a Server Component render — cookies can't be written
            // here. Safe to ignore as long as middleware.ts also refreshes the
            // session, which it does.
          }
        },
      },
    }
  );
}
