import { ForecastItem } from '@/lib/analysisClient';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

function formatInr(amount: number | null | undefined): string {
  if (amount === null || amount === undefined) return '—';
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(amount);
}

function formatMonth(ym: string): string {
  try {
    const [year, month] = ym.split('-');
    const date = new Date(Number(year), Number(month) - 1, 1);
    return date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
  } catch {
    return ym;
  }
}

export function ForecastCard({ forecasts }: { forecasts: ForecastItem[] }) {
  if (!forecasts || forecasts.length === 0) {
    return null;
  }

  // Deduplicate or sort by target_month
  const sorted = [...forecasts]
    .filter((f) => f.predicted_income && f.predicted_income > 0)
    .sort((a, b) => a.target_month.localeCompare(b.target_month));

  const items = sorted.length > 0 ? sorted : forecasts.slice(0, 3);
  const modelName = items[0]?.model_name || 'AutoETS';

  return (
    <Card className="border-indigo-500/20 bg-indigo-500/5">
      <CardHeader className="pb-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-lg">🔮</span>
            <CardTitle className="text-base font-medium text-indigo-950 dark:text-indigo-200">
              3-Month Financial Forecast
            </CardTitle>
          </div>
          <Badge variant="outline" className="text-xs text-indigo-700 dark:text-indigo-300 border-indigo-400/40">
            Model: {modelName}
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {items.map((f) => {
            const savingsPct = f.predicted_savings_rate !== null ? Math.round(f.predicted_savings_rate * 100) : 0;
            return (
              <div
                key={f.target_month}
                className="rounded-lg border border-border/50 bg-background/80 p-4 space-y-3 shadow-xs"
              >
                <div className="flex items-center justify-between border-b pb-2">
                  <span className="font-semibold text-foreground text-sm">{formatMonth(f.target_month)}</span>
                  <span className="text-xs text-emerald-600 dark:text-emerald-400 font-medium">
                    {savingsPct}% Savings
                  </span>
                </div>

                <div className="space-y-1.5 text-xs">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Expected Spend:</span>
                    <span className="font-medium text-foreground">{formatInr(f.predicted_spend)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Expected Income:</span>
                    <span className="font-medium text-foreground">{formatInr(f.predicted_income)}</span>
                  </div>
                </div>

                {/* Visual savings bar */}
                <div className="w-full bg-muted rounded-full h-1.5 overflow-hidden">
                  <div
                    className="bg-emerald-500 h-full rounded-full transition-all"
                    style={{ width: `${Math.min(100, Math.max(0, savingsPct))}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
