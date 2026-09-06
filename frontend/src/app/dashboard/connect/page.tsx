import { redirect } from 'next/navigation';
import type { BankDto, ConsentDto } from '@switch/shared';
import { apiGet } from '@/lib/apiClient';
import { getAccessToken } from '@/lib/dashboardData';
import { ConnectFlow } from './ConnectFlow';

export default async function ConnectPage({
  searchParams,
}: {
  searchParams: Promise<{ new?: string }>;
}) {
  const accessToken = await getAccessToken();
  const [banks, consents] = await Promise.all([
    apiGet<BankDto[]>('/api/banks', accessToken),
    apiGet<ConsentDto[]>('/api/consents', accessToken),
  ]);

  // Post-login landing spot per the product flow (landing -> signup -> connect -> dashboard):
  // skip straight to the dashboard if the user already has an active connection, unless they
  // navigated here explicitly to add another bank (?new=1, used by the dashboard nav link).
  const hasActiveConnection = consents.some((c) => c.status === 'ACTIVE');
  const params = await searchParams;
  if (hasActiveConnection && params.new !== '1') {
    redirect('/dashboard');
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold">Connect a bank account</h1>
        <p className="text-sm text-muted-foreground">
          Link a bank via the Account Aggregator consent flow so Switch can see your transactions.
        </p>
      </div>

      <ConnectFlow banks={banks} consents={consents} accessToken={accessToken} />
    </div>
  );
}
