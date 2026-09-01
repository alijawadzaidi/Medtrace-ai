import { Geist, Geist_Mono } from 'next/font/google';

import { SessionProvider } from '@/lib/session';
import SiteHeader from '@/components/SiteHeader';
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
        <SessionProvider>
          <SiteHeader />
          <main className="flex-1">{children}</main>
          <footer className="border-t border-border bg-surface">
            <div className="mx-auto w-full max-w-5xl px-5 py-5 text-xs leading-relaxed text-muted">
              MedTrace verifies individual packs of medicine, not batches — so a
              duplicate scan is evidence of a clone rather than ordinary traffic.
              Checking a pack never requires an account.
            </div>
          </footer>
        </SessionProvider>
      </body>
    </html>
  );
}
