import Link from 'next/link';

export default function HomePage() {
  return (
    <div className="mx-auto w-full max-w-3xl px-5 py-10">
      <section className="rounded-2xl border border-border bg-surface p-6">
        <p className="text-xs font-semibold uppercase tracking-wider text-brand">
          Medicine traceability
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">
          Is your medicine genuine?
        </h1>
        <p className="mt-3 max-w-xl text-sm leading-relaxed text-muted">
          Every MedTrace pack carries its own serial number and its own QR code —
          not one code shared across a whole batch. Scan the box and you get the
          pack&rsquo;s entire journey, from the factory to the pharmacy that sold
          it to you.
        </p>

        <div className="mt-5 flex flex-wrap gap-3">
          <Link
            href="/verify"
            className="rounded-full bg-brand px-5 py-2.5 text-sm font-semibold text-background transition-opacity hover:opacity-90"
          >
            Check a pack
          </Link>
          <Link
            href="/login"
            className="rounded-full border border-border px-5 py-2.5 text-sm font-medium transition-colors hover:border-brand hover:text-brand"
          >
            Staff sign in
          </Link>
        </div>
      </section>

      <section className="mt-5 grid gap-3 sm:grid-cols-3">
        {[
          {
            title: 'One code per pack',
            body: 'A batch-wide code lets one photographed box print ten thousand valid fakes. A per-pack serial makes a duplicate scan evidence of a clone.',
          },
          {
            title: 'A journey you can read',
            body: 'Manufacturer, distributor, pharmacy — every custody change is recorded when it happens, and shown to you in plain language.',
          },
          {
            title: 'Recalls reach you',
            body: 'If a regulator withdraws a batch after it left the factory, the pack in your hand says so the moment you scan it.',
          },
        ].map((card) => (
          <div key={card.title} className="rounded-2xl border border-border bg-surface p-4">
            <h2 className="text-sm font-semibold">{card.title}</h2>
            <p className="mt-1.5 text-xs leading-relaxed text-muted">{card.body}</p>
          </div>
        ))}
      </section>
    </div>
  );
}
