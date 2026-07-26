import Link from 'next/link';
import { getSupabaseServerClient } from '@/lib/supabaseServer';

const NAV_LINKS = [
  { href: '/dashboard', label: 'Overview' },
  { href: '/dashboard/spending', label: 'Spending' },
  { href: '/dashboard/subscriptions', label: 'Subscriptions' },
  { href: '/dashboard/consents', label: 'Consents' },
];

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  // middleware.ts already redirects unauthenticated requests to /login before
  // this layout ever renders; this is just for showing the signed-in email.
  const supabase = await getSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <div className="min-h-screen">
      <header className="border-b">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <span className="text-lg font-semibold">Switch</span>
          <nav className="flex gap-6 text-sm">
            {NAV_LINKS.map((link) => (
              <Link key={link.href} href={link.href} className="text-muted-foreground hover:text-foreground">
                {link.label}
              </Link>
            ))}
          </nav>
          {user?.email && <span className="text-sm text-muted-foreground">{user.email}</span>}
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-6 py-8">{children}</main>
    </div>
  );
}
