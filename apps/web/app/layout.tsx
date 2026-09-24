import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { CatchSession } from './catch-session';
import './globals.css';

export const metadata: Metadata = {
  title: 'Tesserafy',
  description: 'Turn every conversation into product intelligence.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        {/* In the layout so it catches a session link wherever it lands, which
            is the point: the landing page is chosen by Supabase, not by us. */}
        <CatchSession />
        {children}
      </body>
    </html>
  );
}
