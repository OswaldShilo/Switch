import type { SummaryResponse } from '@switch/shared';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { apiGet } from '@/lib/apiClient';
import { getAccessToken, getFirstAccount } from '@/lib/dashboardData';

function formatInr(amount: number): string {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(amount);
}

export default async function SubscriptionsPage() {
  const accessToken = await getAccessToken();
  const account = await getFirstAccount(accessToken);

  if (!account) {
    return <p className="text-sm text-muted-foreground">No connected accounts yet.</p>;
  }

  const summary = await apiGet<SummaryResponse>(
    `/api/accounts/${account.accountId}/summary?metrics=recurring_subscriptions`,
    accessToken
  );

  const recurring =
    (summary.recurringSubscriptions as Array<{ merchant: string | null; amount: string; count: number }> | undefined) ?? [];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold">Subscriptions</h1>
        <p className="text-sm text-muted-foreground">
          {account.bank} · {account.maskedNumber}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recurring merchants</CardTitle>
        </CardHeader>
        <CardContent>
          {recurring.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No recurring subscriptions detected yet — run categorize_transactions first.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Merchant</TableHead>
                  <TableHead>Monthly amount</TableHead>
                  <TableHead>Occurrences</TableHead>
                  {/* Presentation-layer arithmetic on an already-DB-computed amount — not
                      a new backend metric, and not the LLM inventing a figure. */}
                  <TableHead>Annual cost</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recurring.map((row) => {
                  const monthly = Number(row.amount);
                  return (
                    <TableRow key={row.merchant ?? 'unknown'}>
                      <TableCell className="capitalize">{row.merchant ?? 'Unknown'}</TableCell>
                      <TableCell>{formatInr(monthly)}</TableCell>
                      <TableCell>{row.count}</TableCell>
                      <TableCell>{formatInr(monthly * 12)}</TableCell>
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
