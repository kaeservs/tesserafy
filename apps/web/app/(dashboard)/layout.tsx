import Link from 'next/link';
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
      <header className="app-header">
        <nav className="toolbar">
          <strong>Tesserafy</strong>
          <Link href="/conversations">Conversations</Link>
          <Link href="/insights">Insights</Link>
          <Link href="/live/mic">Live</Link>
        </nav>
        <form action="/auth/sign-out" method="post" className="toolbar">
          <span className="muted">{user.email}</span>
          <button type="submit">Sign out</button>
        </form>
      </header>
      {children}
    </>
  );
}
