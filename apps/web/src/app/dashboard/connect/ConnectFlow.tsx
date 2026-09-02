'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { BankDto, ConsentDto } from '@switch/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

type Step = 'select' | 'pending' | 'fetching' | 'done' | 'error';

interface ConsentState {
  consentId: string;
  approvalUrl: string;
  status: string;
}

async function postJson(path: string, accessToken: string, body?: unknown) {
  const res = await fetch(`${process.env.NEXT_PUBLIC_API_BASE_URL}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.message ?? `Request failed: ${res.status}`);
  return data;
}

export function ConnectFlow({
  banks,
  consents,
  accessToken,
}: {
  banks: BankDto[];
  consents: ConsentDto[];
  accessToken: string;
}) {
  const router = useRouter();
  const connectedFipIds = new Set(consents.filter((c) => c.status === 'ACTIVE').map((c) => c.fipId));

  const [fipId, setFipId] = useState('');
  const [mobile, setMobile] = useState('');
  const [step, setStep] = useState<Step>('select');
  const [consent, setConsent] = useState<ConsentState | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleConnect() {
    if (!fipId || !mobile.trim()) return;
    setError(null);
    try {
      const data = (await postJson('/api/consents', accessToken, { fipId, mobile })) as ConsentState;
      setConsent(data);
      if (data.status === 'ACTIVE') {
        await fetchData(data.consentId);
      } else {
        setStep('pending');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
      setStep('error');
    }
  }

  async function handleCheckApproval() {
    if (!consent) return;
    setError(null);
    try {
      const data = (await postJson(`/api/consents/${consent.consentId}/activate`, accessToken)) as {
        status: string;
      };
      setConsent({ ...consent, status: data.status });
      if (data.status === 'ACTIVE') {
        await fetchData(consent.consentId);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
      setStep('error');
    }
  }

  async function fetchData(consentId: string) {
    setStep('fetching');
    try {
      await postJson(`/api/consents/${consentId}/fetch-data`, accessToken);
      setStep('done');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
      setStep('error');
    }
  }

  function reset() {
    setFipId('');
    setMobile('');
    setConsent(null);
    setError(null);
    setStep('select');
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Supported banks</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {banks.map((bank) => {
              const isConnected = connectedFipIds.has(bank.fipId);
              return (
                <button
                  key={bank.fipId}
                  type="button"
                  disabled={isConnected || step !== 'select'}
                  onClick={() => setFipId(bank.fipId)}
                  className={`flex items-center justify-between rounded-md border px-4 py-3 text-left text-sm transition disabled:cursor-not-allowed disabled:opacity-60 ${
                    fipId === bank.fipId ? 'border-primary bg-primary/5' : 'border-input'
                  }`}
                >
                  <span>{bank.name}</span>
                  {isConnected && <Badge>Connected</Badge>}
                </button>
              );
            })}
          </div>

          {step === 'select' && fipId && (
            <div className="space-y-3 border-t pt-4">
              <label className="block text-sm">
                Mobile number registered with {banks.find((b) => b.fipId === fipId)?.name}
                <input
                  type="tel"
                  value={mobile}
                  onChange={(e) => setMobile(e.target.value)}
                  placeholder="9999999999"
                  className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                />
              </label>
              <Button onClick={handleConnect} disabled={mobile.trim().length === 0}>
                Connect
              </Button>
            </div>
          )}

          {step === 'pending' && consent && (
            <div className="space-y-3 border-t pt-4">
              <p className="text-sm text-muted-foreground">
                Approve the consent request to continue:{' '}
                <a
                  href={consent.approvalUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-primary underline"
                >
                  Open approval link
                </a>
              </p>
              <Button onClick={handleCheckApproval}>I&apos;ve approved — check status</Button>
            </div>
          )}

          {step === 'fetching' && <p className="text-sm text-muted-foreground">Fetching account data…</p>}

          {step === 'done' && (
            <div className="space-y-3 border-t pt-4">
              <p className="text-sm text-green-600">Account connected — data is ready.</p>
              <div className="flex gap-2">
                <Button onClick={() => router.push('/dashboard')}>Go to Overview</Button>
                <Button variant="secondary" onClick={reset}>
                  Connect another
                </Button>
              </div>
            </div>
          )}

          {error && <p className="text-sm text-destructive">{error}</p>}
        </CardContent>
      </Card>
    </div>
  );
}
