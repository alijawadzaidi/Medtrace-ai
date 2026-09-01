'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';

import { useSession } from '@/lib/session';
import { Loading } from '@/components/ui';

/**
 * One dashboard, four roles.
 *
 * Building a separate dashboard per role duplicates the same tables four
 * times and guarantees they drift. The screens are shared; what changes is
 * which tabs appear and which buttons are on them — and none of that is a
 * security boundary. The API enforces every rule again on its own: hiding the
 * recall button from a manufacturer is a courtesy, `requireRole('regulator')`
 * is the control.
 */
const TABS = [
  { href: '/dashboard', label: 'Overview', roles: ['manufacturer', 'distributor', 'pharmacy', 'regulator'] },
  { href: '/dashboard/batches', label: 'Batches', roles: ['manufacturer', 'regulator'] },
  { href: '/dashboard/shipments', label: 'Shipments', roles: ['manufacturer', 'distributor', 'pharmacy', 'regulator'] },
  { href: '/dashboard/packs', label: 'Look up a pack', roles: ['manufacturer', 'distributor', 'pharmacy', 'regulator'] },
  { href: '/dashboard/alerts', label: 'Alerts', roles: ['regulator'] },
  { href: '/dashboard/audit', label: 'Audit trail', roles: ['regulator'] },
];

export default function DashboardLayout({ children }) {
  const { status, user } = useSession();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (status === 'anonymous') router.replace('/login');
  }, [status, router]);

  if (status !== 'authenticated') {
    return (
      <div className="mx-auto w-full max-w-5xl px-5 py-10">
        <Loading label={status === 'anonymous' ? 'Redirecting to sign in…' : 'Checking your session…'} />
      </div>
    );
  }

  const tabs = TABS.filter((tab) => tab.roles.includes(user.role));

  return (
    <div className="mx-auto w-full max-w-5xl px-5 py-6">
      <nav className="mb-6 flex flex-wrap gap-2 border-b border-border pb-3">
        {tabs.map((tab) => {
          const active = tab.href === '/dashboard' ? pathname === tab.href : pathname.startsWith(tab.href);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={`rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
                active
                  ? 'bg-brand text-background'
                  : 'border border-border text-muted hover:border-brand hover:text-brand'
              }`}
            >
              {tab.label}
            </Link>
          );
        })}
      </nav>

      {children}
    </div>
  );
}
