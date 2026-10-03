'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { triggerAllPipelines } from '@/lib/analysisClient';

export function RunAnalysisButton({ accountId }: { accountId?: string }) {
  const [running, setRunning] = useState(false);
  const [statusText, setStatusText] = useState<string | null>(null);
  const router = useRouter();

  async function handleRun() {
    try {
      setRunning(true);
      setStatusText('Running ML Pipelines...');
      await triggerAllPipelines(accountId);
      setStatusText('Insights Updated!');
      setTimeout(() => setStatusText(null), 2500);
      router.refresh();
    } catch (err) {
      setStatusText('Analysis Failed');
      setTimeout(() => setStatusText(null), 3000);
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="flex items-center gap-3">
      <Button
        onClick={handleRun}
        disabled={running}
        size="sm"
        variant="outline"
        className="border-indigo-500/30 bg-indigo-50/50 text-indigo-700 hover:bg-indigo-100 hover:text-indigo-800 dark:border-indigo-400/30 dark:bg-indigo-950/40 dark:text-indigo-300 dark:hover:bg-indigo-900/60 transition-all shadow-sm"
      >
        <span className="mr-1.5">{running ? '⚙️' : '⚡'}</span>
        {running ? 'Running ML Engine...' : 'Run ML Analysis'}
      </Button>
      {statusText && (
        <span className="text-xs font-medium text-muted-foreground animate-fade-in">
          {statusText}
        </span>
      )}
    </div>
  );
}
