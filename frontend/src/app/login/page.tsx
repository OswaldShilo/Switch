'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { getSupabaseBrowserClient } from '@/lib/supabaseClient';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'checking' | 'idle' | 'sending' | 'sent' | 'error'>('checking');
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    // detectSessionInUrl (default true, unset in getSupabaseBrowserClient) already
    // exchanges ?code=... for a session during client construction above; awaiting
    // getSession() here just waits for that in-flight exchange to finish.
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        if (window.location.search) {
          window.history.replaceState(null, '', window.location.pathname);
        }
        router.replace('/dashboard/connect');
        return;
      }
      setStatus('idle');
    });
  }, [router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus('sending');
    setError(null);
    const supabase = getSupabaseBrowserClient();
    // Without this, Supabase falls back to its dashboard-configured Site URL for the
    // post-verify redirect (often just "/"), which middleware.ts then intercepts server-side
    // (no session cookie yet), redirecting to /login via `new URL('/login', request.url)` —
    // that constructor drops the original ?code=... query string, so the PKCE code never
    // reaches client JS to be exchanged. Sending users straight to /login (a public path)
    // means middleware never touches the redirect and the code survives.
    const { error: authError } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/login` },
    });
    if (authError) {
      setStatus('error');
      setError(authError.message);
      return;
    }
    setStatus('sent');
  }

  if (status === 'checking') {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-sm text-muted-foreground">Checking session…</p>
      </div>
    );



  }

  return (
    <div className="flex min-h-screen items-center justify-center p-8">
      <div className="w-full max-w-sm space-y-4">
        <h1 className="text-2xl font-semibold">Sign in to Switch</h1>
        <p className="text-sm text-muted-foreground">
          Enter your email and we&apos;ll send you a magic link to sign in.
        </p>
        <form onSubmit={handleSubmit} className="space-y-3">
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          />
          <Button type="submit" className="w-full" disabled={status === 'sending'}>
            {status === 'sending' ? 'Sending…' : 'Send magic link'}
          </Button>
        </form>
        {status === 'sent' && (
          <p className="text-sm text-green-600">
            Check your email for a sign-in link.
          </p>
        )}
        {status === 'error' && error && <p className="text-sm text-red-600">{error}</p>}
      </div>
    </div>
  );
}
