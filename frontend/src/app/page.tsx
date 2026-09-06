import Link from 'next/link';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

const FEATURES = [
  {
    title: 'Connect once',
    description: 'Link your bank via the RBI-regulated Account Aggregator framework — no screen scraping, no shared passwords.',
  },
  {
    title: 'See it clearly',
    description: 'Spending by category, month-over-month trends, and subscriptions you forgot you had, all in one place.',
  },
  {
    title: 'Ask anything',
    description: 'Chat grounded in your real transaction data — "how much did I spend on food last month?" just works.',
  },
];

export default function LandingPage() {
  return (
    <div className="min-h-screen">
      <header className="border-b">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <span className="text-lg font-semibold">Switch</span>
          <Link href="/login" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
            Sign in
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-20">
        <div className="max-w-2xl space-y-6">
          <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
            Your money, understood.
          </h1>
          <p className="text-lg text-muted-foreground">
            Switch connects to your bank accounts and turns raw transactions into answers —
            spending trends, subscriptions, savings rate — plus a chat that actually knows your data.
          </p>
          <Link href="/login" className={buttonVariants({ size: 'lg' })}>
            Get started
          </Link>
        </div>

        <div className="mt-16 grid grid-cols-1 gap-4 sm:grid-cols-3">
          {FEATURES.map((feature) => (
            <Card key={feature.title}>
              <CardHeader>
                <CardTitle>{feature.title}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">{feature.description}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </main>
    </div>
  );
}
