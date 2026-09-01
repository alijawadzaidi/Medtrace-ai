import VerificationView from '@/components/VerificationView';

/**
 * The page a phone camera lands on.
 *
 * Every QR code printed on every pack encodes this URL, which is why the route
 * is short: `/v/<serial>`. It is also why the path must never change — labels
 * already in circulation cannot be reprinted.
 */
export const metadata = {
  title: 'Verifying a pack — MedTrace',
  // A verification result is about the pack in someone's hand. There is
  // nothing here worth indexing, and a search engine following these links
  // would fabricate scan events for packs nobody is holding.
  robots: { index: false, follow: false },
};

export default async function VerifyPackPage({ params }) {
  const { serial } = await params;

  return (
    <div className="mx-auto w-full max-w-3xl px-5 py-6">
      <VerificationView serial={decodeURIComponent(serial)} />
    </div>
  );
}
