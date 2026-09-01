'use client';

import Link from 'next/link';
import { useState } from 'react';

import { api } from '@/lib/api';
import { useApi } from '@/lib/useApi';
import { useSession } from '@/lib/session';
import { formatDate } from '@/lib/format';
import { Badge, Button, Card, Empty, ErrorNote, Input, Loading, Select } from '@/components/ui';

/** The batch list, plus the form that creates one — manufacturers only. */
export default function BatchesPage() {
  const { user, token } = useSession();
  const batches = useApi('/batches');
  const medicines = useApi('/medicines', { skip: user.role !== 'manufacturer' });
  const [creating, setCreating] = useState(false);

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Batches</h1>
          <p className="mt-1 text-sm text-muted">
            {user.role === 'regulator'
              ? 'Every batch from every manufacturer.'
              : 'Production runs you have registered.'}
          </p>
        </div>
        {user.role === 'manufacturer' && (
          <Button onClick={() => setCreating((open) => !open)}>
            {creating ? 'Cancel' : 'New batch'}
          </Button>
        )}
      </header>

      {creating && (
        <NewBatchForm
          medicines={medicines.data?.medicines || []}
          token={token}
          onCreated={() => {
            setCreating(false);
            batches.refresh();
          }}
        />
      )}

      <ErrorNote error={batches.error} />

      <Card>
        {batches.loading ? (
          <Loading />
        ) : !batches.data?.batches?.length ? (
          <Empty>No batches yet. Create one to generate its packs and QR codes.</Empty>
        ) : (
          <ul className="divide-y divide-border">
            {batches.data.batches.map((batch) => (
              <li key={batch.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <Link
                    href={`/dashboard/batches/${batch.id}`}
                    className="font-medium hover:text-brand"
                  >
                    {batch.batchNo}
                  </Link>
                  <p className="text-xs text-muted">
                    {batch.medicine?.name} {batch.medicine?.strength} · {batch.quantity} packs ·
                    made {formatDate(batch.manufacturedOn)} · expires {formatDate(batch.expiresOn)}
                  </p>
                </div>
                <Badge>{batch.status}</Badge>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

/**
 * Creating a batch generates every pack and every serial in one transaction on
 * the API side, so this form is the moment thousands of rows appear. The
 * quantity field is capped here as well as there — not for safety, but so the
 * mistake is caught while the user is still looking at the field.
 */
function NewBatchForm({ medicines, token, onCreated }) {
  const today = new Date().toISOString().slice(0, 10);
  const [form, setForm] = useState({
    medicineId: '',
    batchNo: '',
    manufacturedOn: today,
    expiresOn: '',
    quantity: 200,
  });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post(
        '/batches',
        {
          medicineId: Number(form.medicineId),
          batchNo: form.batchNo.trim(),
          manufacturedOn: form.manufacturedOn,
          expiresOn: form.expiresOn,
          quantity: Number(form.quantity),
        },
        token
      );
      onCreated();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="New batch">
      <form onSubmit={onSubmit} className="grid gap-4 sm:grid-cols-2">
        <Select
          label="Medicine"
          required
          value={form.medicineId}
          onChange={(e) => setForm({ ...form, medicineId: e.target.value })}
        >
          <option value="">Choose a product…</option>
          {medicines.map((medicine) => (
            <option key={medicine.id} value={medicine.id}>
              {medicine.name} {medicine.strength} ({medicine.form})
            </option>
          ))}
        </Select>

        <Input
          label="Batch number"
          required
          placeholder="MRD-2026-0418"
          value={form.batchNo}
          onChange={(e) => setForm({ ...form, batchNo: e.target.value })}
        />

        <Input
          label="Manufactured on"
          type="date"
          required
          value={form.manufacturedOn}
          onChange={(e) => setForm({ ...form, manufacturedOn: e.target.value })}
        />

        <Input
          label="Expires on"
          type="date"
          required
          value={form.expiresOn}
          onChange={(e) => setForm({ ...form, expiresOn: e.target.value })}
        />

        <Input
          label="Packs"
          hint="Every pack gets its own serial and QR code. Maximum 5000."
          type="number"
          min={1}
          max={5000}
          required
          value={form.quantity}
          onChange={(e) => setForm({ ...form, quantity: e.target.value })}
        />

        <div className="flex items-end">
          <Button type="submit" disabled={busy} className="w-full">
            {busy ? `Generating ${form.quantity} packs…` : 'Create batch and packs'}
          </Button>
        </div>

        <div className="sm:col-span-2">
          <ErrorNote error={error} />
        </div>
      </form>
    </Card>
  );
}
