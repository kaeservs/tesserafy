import type { Metadata } from 'next';
import { Poppins } from 'next/font/google';
import type { ReactNode } from 'react';
import { CatchSession } from './catch-session';
import './globals.css';

// Self-hosted by Next at build: no request reaches Google from a visitor.
const sans = Poppins({ subsets: ['latin'], weight: ['400', '500', '600'], display: 'swap', variable: '--font-sans' });

export const metadata: Metadata = {
  title: 'Tesserafy',
  description: 'Turn every conversation into product intelligence.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={sans.variable}>
      <body>
        {/* In the layout so it catches a session link wherever it lands, which
            is the point: the landing page is chosen by Supabase, not by us. */}
        <CatchSession />
        {children}
      </body>
    </html>
  );
}
