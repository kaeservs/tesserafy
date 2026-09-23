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
    <main style={{ maxWidth: '22rem', marginTop: '18vh' }}>
      <h1>Operator console</h1>
      <p className="lede">Internal. Sign in with your operator account.</p>
      <LoginForm denied={Boolean(denied)} />
    </main>
  );
}
