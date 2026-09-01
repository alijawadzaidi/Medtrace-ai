'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';

import { useSession, roleLabel } from '@/lib/session';

export default function SiteHeader() {
  const { status, user, signOut } = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const onDashboard = pathname.startsWith('/dashboard');

  return (
    <header className="border-b border-border bg-surface">
      <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-3 px-5 py-3">
        <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
          <span aria-hidden className="inline-block h-5 w-5 rounded-md bg-brand" />
          MedTrace
        </Link>

        <nav className="flex items-center gap-2 text-sm">
          {!onDashboard && (
            <Link
              href="/verify"
              className="rounded-full border border-border px-3 py-1.5 font-medium text-muted transition-colors hover:border-brand hover:text-brand"
            >
              Check a pack
            </Link>
          )}

          {status === 'authenticated' ? (
            <>
              <span className="hidden text-xs text-muted sm:inline">
                {user.organization.name} · {roleLabel(user.role)}
              </span>
              {!onDashboard && (
                <Link
                  href="/dashboard"
                  className="rounded-full border border-border px-3 py-1.5 font-medium transition-colors hover:border-brand hover:text-brand"
                >
                  Dashboard
                </Link>
              )}
              <button
                type="button"
                onClick={() => {
                  signOut();
                  router.push('/');
                }}
                className="rounded-full border border-border px-3 py-1.5 font-medium text-muted transition-colors hover:border-brand hover:text-brand"
              >
                Sign out
              </button>
            </>
          ) : (
            status === 'anonymous' && (
              <Link
                href="/login"
                className="rounded-full border border-border px-3 py-1.5 font-medium text-muted transition-colors hover:border-brand hover:text-brand"
              >
                Staff sign in
              </Link>
            )
          )}
        </nav>
      </div>
    </header>
  );
}
