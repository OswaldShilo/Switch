import { redirect } from 'next/navigation';
import type { AccountDto } from '@switch/shared';
import { apiGet } from './apiClient';
import { getSupabaseServerClient } from './supabaseServer';

// Shared by every /dashboard/* server component: resolve the signed-in user's
// access token, then their first (only, for this demo) account. Re-fetching
// /api/accounts per page is simpler than threading a React context through
// the layout, and cheap enough at this scale (spec's own M3 plan calls this
// out as "simplicity over cleverness at this scale").
export async function getAccessToken(): Promise<string> {
  const supabase = await getSupabaseServerClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) {
    redirect('/login');
  }
  return session.access_token;
}

export async function getFirstAccount(accessToken: string): Promise<AccountDto | null> {
  const accounts = await apiGet<AccountDto[]>('/api/accounts', accessToken);
  return accounts[0] ?? null;
}
