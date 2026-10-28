import type { Metadata, Viewport } from 'next';
import Link from 'next/link';
import './globals.css';

export const metadata: Metadata = {
  title: 'OAuth Readiness',
  description: 'How hard is it to ship a verified OAuth app with each provider? Guides that say how long, and who does each step.',
  metadataBase: new URL(process.env.PUBLIC_BASE_URL ?? 'http://localhost:3000'),
};
export const viewport: Viewport = { width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">
        <header className="border-b border-line">
          <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
            <Link href="/" className="font-semibold tracking-tight">OAuth Readiness</Link>
            <span className="text-sm text-muted">Registered is not the same as usable</span>
          </div>
        </header>
        {children}
      </body>
    </html>
  );
}
