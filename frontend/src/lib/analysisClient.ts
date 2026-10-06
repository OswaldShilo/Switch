const ANALYSIS_BASE_URL = process.env.NEXT_PUBLIC_ANALYSIS_API_URL || 'http://127.0.0.1:8000';

export interface AnomalyItem {
  id: string;
  transaction_id: string | null;
  category: string;
  month: string;
  severity: 'low' | 'medium' | 'high';
  score: number;
  reason: string;
}

export interface ForecastItem {
  target_month: string;
  predicted_spend: number | null;
  predicted_income: number | null;
  predicted_savings_rate: number | null;
  model_name: string;
}

export interface SubscriptionItem {
  merchant: string;
  typical_amount: number;
  cadence_days: number;
  confidence: number;
  occurrence_count: number;
  last_seen: string;
  next_expected: string | null;
}

export async function fetchAnomalies(accountId: string): Promise<AnomalyItem[]> {
  try {
    const res = await fetch(`${ANALYSIS_BASE_URL}/results/anomalies/${accountId}`, { cache: 'no-store' });
    if (!res.ok) return [];
    return await res.json();
  } catch {
    return [];
  }
}

export async function fetchForecasts(accountId: string): Promise<ForecastItem[]> {
  try {
    const res = await fetch(`${ANALYSIS_BASE_URL}/results/forecast/${accountId}`, { cache: 'no-store' });
    if (!res.ok) return [];
    return await res.json();
  } catch {
    return [];
  }
}

export async function fetchSubscriptions(accountId: string): Promise<SubscriptionItem[]> {
  try {
    const res = await fetch(`${ANALYSIS_BASE_URL}/results/subscriptions/${accountId}`, { cache: 'no-store' });
    if (!res.ok) return [];
    return await res.json();
  } catch {
    return [];
  }
}

export async function triggerAllPipelines(accountId?: string): Promise<any> {
  const url = accountId
    ? `${ANALYSIS_BASE_URL}/run/all?account_id=${accountId}`
    : `${ANALYSIS_BASE_URL}/run/all`;
  const res = await fetch(url, { method: 'POST', cache: 'no-store' });
  if (!res.ok) throw new Error('Analysis pipeline trigger failed');
  return await res.json();
}
