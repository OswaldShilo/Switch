import { AnomalyItem } from '@/lib/analysisClient';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

export function AnomalyAlerts({ anomalies }: { anomalies: AnomalyItem[] }) {
  if (!anomalies || anomalies.length === 0) {
    return null;
  }

  // Display the top anomalies (prioritize category-level and highest score)
  const displayAnomalies = anomalies.slice(0, 5);

  return (
    <Card className="border-amber-500/30 bg-amber-500/5">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-lg">⚠️</span>
            <CardTitle className="text-base font-medium text-amber-900 dark:text-amber-300">
              Spending Anomalies Detected ({anomalies.length})
            </CardTitle>
          </div>
          <span className="text-xs text-muted-foreground">Statistical Outlier Detection</span>
        </div>
      </CardHeader>
      <CardContent className="space-y-2.5">
        {displayAnomalies.map((a) => {
          const isHigh = a.severity === 'high';
          const isMedium = a.severity === 'medium';

          return (
            <div
              key={a.id}
              className="flex items-start justify-between gap-4 rounded-lg border border-border/50 bg-background/60 p-3 text-sm shadow-xs"
            >
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-foreground">{a.category || 'General'}</span>
                  {a.month && (
                    <span className="text-xs text-muted-foreground">({a.month})</span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">{a.reason}</p>
              </div>

              <div className="flex flex-col items-end gap-1 shrink-0">
                <Badge
                  variant={isHigh ? 'destructive' : 'secondary'}
                  className={
                    isHigh
                      ? 'bg-rose-500/15 text-rose-700 dark:text-rose-400 font-semibold'
                      : isMedium
                      ? 'bg-amber-500/15 text-amber-700 dark:text-amber-400 font-semibold'
                      : 'bg-blue-500/15 text-blue-700 dark:text-blue-400 font-semibold'
                  }
                >
                  {a.severity.toUpperCase()} ({a.score > 0 ? `+${a.score.toFixed(1)}σ` : `${a.score.toFixed(1)}σ`})
                </Badge>
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
