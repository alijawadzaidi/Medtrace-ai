import { Geist, Geist_Mono } from 'next/font/google';
import Link from 'next/link';
import './globals.css';

const geistSans = Geist({ variable: '--font-geist-sans', subsets: ['latin'] });
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] });

export const metadata = {
  title: 'MedTrace — verify your medicine',
  description:
    'Scan the QR code on a pack of medicine to check whether it is genuine, where it has been, and whether it has been recalled.',
};

export const viewport = {
  themeColor: '#0f766e',
  // The scanner is a camera viewport on a phone. Letting the page zoom while
  // someone is lining up a QR code makes it harder to hold steady.
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col font-sans">
        <header className="border-b border-border bg-surface">
          <div className="mx-auto flex w-full max-w-3xl items-center justify-between px-5 py-3">
            <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
              <span
                aria-hidden
                className="inline-block h-5 w-5 rounded-md bg-brand"
              />
              MedTrace
            </Link>
            <Link
              href="/verify"
              className="rounded-full border border-border px-3 py-1.5 text-sm font-medium text-muted transition-colors hover:border-brand hover:text-brand"
            >
              Check a pack
            </Link>
          </div>
        </header>

        <main className="flex-1">{children}</main>

        <footer className="border-t border-border bg-surface">
          <div className="mx-auto w-full max-w-3xl px-5 py-5 text-xs leading-relaxed text-muted">
            MedTrace verifies individual packs of medicine, not batches — so a
            duplicate scan is evidence of a clone rather than ordinary traffic.
            Checking a pack never requires an account.
          </div>
        </footer>
      </body>
    </html>
  );
}
