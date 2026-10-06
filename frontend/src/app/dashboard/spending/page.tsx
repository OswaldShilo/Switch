import type { SummaryResponse } from '@switch/shared';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { apiGet } from '@/lib/apiClient';
import { getAccessToken, getFirstAccount } from '@/lib/dashboardData';
import { fetchAnomalies } from '@/lib/analysisClient';
import { CategoryDonut, type CategorySpend } from './CategoryDonut';
import { MonthlySpendBarChart, type MonthlyTotal } from './MonthlySpendBarChart';
import { AnomalyAlerts } from '@/components/AnomalyAlerts';
import { RunAnalysisButton } from '@/components/RunAnalysisButton';

const WIDE_RANGE = { from: '2000-01-01', to: '2999-12-31' };

export default async function SpendingPage() {
  const accessToken = await getAccessToken();
  const account = await getFirstAccount(accessToken);

  if (!account) {
    return <p className="text-sm text-muted-foreground">No connected accounts yet.</p>;
  }

  // Parallel fetch: Core backend summary + ML Anomalies
  const [summary, anomalies] = await Promise.all([
    apiGet<SummaryResponse>(
      `/api/accounts/${account.accountId}/summary?metrics=spend_by_category,mom_trend&from=${WIDE_RANGE.from}&to=${WIDE_RANGE.to}`,
      accessToken
    ),
    fetchAnomalies(account.accountId),
  ]);

  const spendByCategoryRaw = (summary.spendByCategory as Array<{ category: string | null; total: string }> | undefined) ?? [];
  const spendByCategory: CategorySpend[] = spendByCategoryRaw.map((r) => ({
    category: r.category,
    total: Number(r.total),
  }));

  const momTrendRaw = (summary.momTrend as Array<{ month: string; total: string }> | undefined) ?? [];
  const momTrend: MonthlyTotal[] = momTrendRaw.map((r) => ({ month: r.month, total: Number(r.total) }));

  return (
    <div className="space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Spending</h1>
          <p className="text-sm text-muted-foreground">
            {account.bank} · {account.maskedNumber}
          </p>
        </div>
        <RunAnalysisButton accountId={account.accountId} />
      </div>

      {/* ML Anomalies Banner */}
      <AnomalyAlerts anomalies={anomalies} />

      <Card>
        <CardHeader>
          <CardTitle>Spend by category</CardTitle>
        </CardHeader>
        <CardContent>
          <CategoryDonut data={spendByCategory} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Monthly totals</CardTitle>
        </CardHeader>
        <CardContent>
          <MonthlySpendBarChart data={momTrend} />
        </CardContent>
      </Card>
    </div>
  );
}
