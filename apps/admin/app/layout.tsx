import type { Metadata } from 'next';
import { Poppins } from 'next/font/google';
import type { ReactNode } from 'react';
import './globals.css';

// Self-hosted by Next at build: no request reaches Google from a visitor.
const sans = Poppins({ subsets: ['latin'], weight: ['400', '500', '600'], display: 'swap', variable: '--font-sans' });

export const metadata: Metadata = {
  title: 'Tesserafy operator console',
  description: 'Internal. Reads across every tenant.',
  // Nothing here should ever be indexed, previewed or cached by anything.
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={sans.variable}>
      <body>{children}</body>
    </html>
  );
}
