'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

import { useSession } from '@/lib/session';
import { Button, Card, ErrorNote, Input } from '@/components/ui';

/**
 * Staff sign-in. Customers never see this page — verification is deliberately
 * account-free, and putting a login in front of it would mean nobody checks.
 */
export default function LoginPage() {
  const router = useRouter();
  const { signIn, status } = useSession();
  const [form, setForm] = useState({ email: '', password: '' });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  // Redirecting during render updates the Router while this component is
  // still rendering, which React rightly rejects. An already-signed-in user
  // landing here (a bookmark, the back button) is sent on from an effect.
  useEffect(() => {
    if (status === 'authenticated') router.replace('/dashboard');
  }, [status, router]);

  async function onSubmit(event) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await signIn(form.email, form.password);
      router.replace('/dashboard');
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-md px-5 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">Staff sign in</h1>
      <p className="mt-1 text-sm text-muted">
        For manufacturers, distributors, pharmacies and regulators. Checking a
        pack does not need an account.
      </p>

      <Card className="mt-5">
        <form onSubmit={onSubmit} className="space-y-4">
          <Input
            label="Email"
            type="email"
            autoComplete="username"
            required
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
          />
          <Input
            label="Password"
            type="password"
            autoComplete="current-password"
            required
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
          />
          <ErrorNote error={error} />
          <Button type="submit" disabled={busy} className="w-full">
            {busy ? 'Signing in…' : 'Sign in'}
          </Button>
        </form>
      </Card>
    </div>
  );
}
