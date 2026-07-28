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

    async function handleAuthRedirect() {
      const hash = new URLSearchParams(window.location.hash.slice(1));
      const access_token = hash.get('access_token');
      const refresh_token = hash.get('refresh_token');

      if (access_token && refresh_token) {
        const { error: sessionError } = await supabase.auth.setSession({ access_token, refresh_token });
        window.history.replaceState(null, '', window.location.pathname);
        if (sessionError) {
          setStatus('error');
          setError(sessionError.message);
          return;
        }
        router.replace('/dashboard');
        return;
      }

      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        router.replace('/dashboard');
        return;
      }
      setStatus('idle');
    }

    handleAuthRedirect();
  }, [router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus('sending');
    setError(null);
    const supabase = getSupabaseBrowserClient();
    const { error: authError } = await supabase.auth.signInWithOtp({ email });
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
