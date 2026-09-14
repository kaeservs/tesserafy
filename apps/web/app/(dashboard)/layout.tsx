import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { createClient } from '@/lib/supabase/server';

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  return (
    <>
      <header
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: '1rem',
          padding: '0.75rem 1rem',
          borderBottom: '1px solid var(--border)',
        }}
      >
        <strong>Tesserafy</strong>
        <form action="/auth/sign-out" method="post" style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
          <span className="muted">{user.email}</span>
          <button type="submit">Sign out</button>
        </form>
      </header>
      {children}
    </>
  );
}
