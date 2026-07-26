import type { SummaryResponse } from '@switch/shared';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { apiGet } from '@/lib/apiClient';
import { getAccessToken, getFirstAccount } from '@/lib/dashboardData';
import { MomTrendChart, type MomTrendPoint } from './MomTrendChart';

function currentMonthRange(): { from: string; to: string } {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), 1);
  const to = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { from: iso(from), to: iso(to) };
}

function formatInr(amount: string | number | undefined): string {
  const n = Number(amount ?? 0);
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n);
}

export default async function OverviewPage() {
  const accessToken = await getAccessToken();
  const account = await getFirstAccount(accessToken);

  if (!account) {
    return (
      <p className="text-sm text-muted-foreground">
        No connected accounts yet. Complete a consent flow via the MCP tools to see data here.
      </p>
    );
  }

  const { from, to } = currentMonthRange();
  const summary = await apiGet<SummaryResponse>(
    `/api/accounts/${account.accountId}/summary?metrics=income,savings_rate,mom_trend&from=${from}&to=${to}`,
    accessToken
  );

  const income = summary.income as string | undefined;
  const savingsRate = summary.savingsRate as number | undefined;
  const momTrendRaw = (summary.momTrend as Array<{ month: string; total: string }> | undefined) ?? [];
  const momTrend: MomTrendPoint[] = momTrendRaw.map((r) => ({ month: r.month, total: Number(r.total) }));

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold">Overview</h1>
        <p className="text-sm text-muted-foreground">
          {account.bank} · {account.maskedNumber}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Balance</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">{formatInr(account.balance)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Income this month</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">{income ? formatInr(income) : '—'}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Savings rate</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">
              {savingsRate !== undefined ? `${Math.round(savingsRate * 100)}%` : '—'}
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Spending trend (month over month)</CardTitle>
        </CardHeader>
        <CardContent>
          <MomTrendChart data={momTrend} />
        </CardContent>
      </Card>
    </div>
  );
}
