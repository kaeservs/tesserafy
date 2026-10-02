import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { LoginForm } from './form';

/**
 * The console's front door.
 *
 * It says nothing about what is behind it. Somebody who reaches this page
 * without being an operator should learn only that their password did not work
 * — not that a cross-tenant console exists, and not that they failed a check
 * on it. Hence one message for every way in which this can fail.
 */
export const dynamic = 'force-dynamic';

export default async function Login({
  searchParams,
}: {
  searchParams: Promise<{ denied?: string }>;
}) {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  const { denied } = await searchParams;

  // A signed-in operator should not be looking at a login form.
  if (data.user && !denied) {
    const { data: admin } = await supabase
      .from('platform_admins')
      .select('user_id')
      .eq('user_id', data.user.id)
      .maybeSingle();
    if (admin) redirect('/');
  }

  return (
    <main className="auth">
      <div className="auth-card">
      <p className="brand">
        <svg width={24} height={24} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} aria-hidden="true">
          <path d="M12 2.5 20.5 7.5v9L12 21.5 3.5 16.5v-9zM12 8.5l3.5 2v3.5L12 16l-3.5-2v-3.5z" />
        </svg>
        Tesserafy <span className="operator">Operator</span>
      </p>
      <h1>Operator console</h1>
      <p className="lede">Internal. Sign in with your operator account.</p>
      <LoginForm denied={Boolean(denied)} />
      </div>
    </main>
  );
}
