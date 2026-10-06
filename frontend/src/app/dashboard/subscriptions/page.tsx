import type { SummaryResponse } from '@switch/shared';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { apiGet } from '@/lib/apiClient';
import { getAccessToken, getFirstAccount } from '@/lib/dashboardData';
import { fetchSubscriptions } from '@/lib/analysisClient';
import { RunAnalysisButton } from '@/components/RunAnalysisButton';

function formatInr(amount: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(amount);
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '—';
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return dateStr;
  }
}

export default async function SubscriptionsPage() {
  const accessToken = await getAccessToken();
  const account = await getFirstAccount(accessToken);

  if (!account) {
    return <p className="text-sm text-muted-foreground">No connected accounts yet.</p>;
  }

  // Parallel fetch: Core backend summary + Python ML Subscription detections
  const [summary, mlSubscriptions] = await Promise.all([
    apiGet<SummaryResponse>(
      `/api/accounts/${account.accountId}/summary?metrics=recurring_subscriptions`,
      accessToken
    ),
    fetchSubscriptions(account.accountId),
  ]);

  const recurring =
    (summary.recurringSubscriptions as Array<{ merchant: string | null; amount: string; count: number }> | undefined) ?? [];

  // Map ML subscription metadata for quick lookup
  const mlMap = new Map(mlSubscriptions.map((s) => [s.merchant.toLowerCase(), s]));

  return (
    <div className="space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Subscriptions</h1>
          <p className="text-sm text-muted-foreground">
            {account.bank} · {account.maskedNumber}
          </p>
        </div>
        <RunAnalysisButton accountId={account.accountId} />
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Recurring Subscriptions</CardTitle>
            <Badge variant="outline" className="text-xs text-indigo-700 dark:text-indigo-300 border-indigo-400/30">
              ML Cadence & Interval Model
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          {recurring.length === 0 && mlSubscriptions.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No recurring subscriptions detected yet — run ML analysis above.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Merchant</TableHead>
                  <TableHead>Monthly Amount</TableHead>
                  <TableHead>Cadence</TableHead>
                  <TableHead>Occurrences</TableHead>
                  <TableHead>Annual Cost</TableHead>
                  <TableHead>Confidence</TableHead>
                  <TableHead>Next Expected</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {/* Prioritize ML-detected subscriptions */}
                {(mlSubscriptions.length > 0 ? mlSubscriptions : recurring).map((item: any) => {
                  const merchantName = (item.merchant ?? 'Unknown').toLowerCase();
                  const ml = mlMap.get(merchantName);

                  const monthly = Number(item.typical_amount ?? item.amount ?? 0);
                  const count = item.occurrence_count ?? item.count ?? 0;
                  const cadence = ml?.cadence_days ? `${ml.cadence_days} days` : 'Monthly';
                  const confidencePct = ml?.confidence ? Math.round(ml.confidence * 100) : 90;
                  const nextExpected = ml?.next_expected ? formatDate(ml.next_expected) : '—';

                  return (
                    <TableRow key={merchantName}>
                      <TableCell className="capitalize font-medium">{merchantName}</TableCell>
                      <TableCell>{formatInr(monthly)}</TableCell>
                      <TableCell className="text-muted-foreground text-xs">{cadence}</TableCell>
                      <TableCell>{count}</TableCell>
                      <TableCell>{formatInr(monthly * 12)}</TableCell>
                      <TableCell>
                        <Badge
                          variant="secondary"
                          className={
                            confidencePct >= 90
                              ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400'
                              : 'bg-amber-500/15 text-amber-700 dark:text-amber-400'
                          }
                        >
                          {confidencePct}%
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{nextExpected}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
