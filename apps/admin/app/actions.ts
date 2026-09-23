'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { mintSessionFor, requireAdmin } from '@/lib/admin';
import { createClient } from '@/lib/supabase/server';

/**
 * A text field, or nothing.
 *
 * `formData.get` returns `File | string | null`, and `String(aFile)` is the
 * literal text "[object File]" — which is not a reason, not an email and not a
 * uuid, but is long enough to satisfy a check that only asks whether something
 * was filled in. The web app's login form had the same bug; the linter found
 * both.
 */
function text(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === 'string' ? value : '';
}

export interface SessionState {
  status: 'idle' | 'ready' | 'error';
  message?: string;
  link?: string;
  accessId?: string;
  email?: string;
}

/**
 * Open a session as somebody, in the order that makes the record mean
 * something.
 *
 * `open_support_access` first. It runs as the admin, checks that they are one,
 * refuses a session on yourself, caps the duration, and writes the row. Only
 * if that returns does anything get minted. A record written afterwards would
 * be a record that a crash, a refusal or a closed tab could skip.
 */
export async function openSession(_prev: SessionState, formData: FormData): Promise<SessionState> {
  const admin = await requireAdmin();

  const subjectId = text(formData, 'subjectId');
  const email = text(formData, 'email');
  const reason = text(formData, 'reason').trim();
  const minutes = Number(formData.get('minutes') ?? 30);

  if (reason.length < 3) {
    return { status: 'error', message: 'Say why. The reason is the point of the record.' };
  }

  const { data: access, error } = await admin.db.rpc('open_support_access', {
    p_subject_user_id: subjectId,
    p_reason: reason,
    p_minutes: Number.isInteger(minutes) ? minutes : 30,
  });
  if (error) return { status: 'error', message: error.message };

  const link = await mintSessionFor(email);
  if (!link) {
    return {
      status: 'error',
      message: `Recorded as ${access.id}, but no session could be minted. Check SUPABASE_SERVICE_ROLE_KEY and NEXT_PUBLIC_APP_URL.`,
    };
  }

  revalidatePath('/');
  return { status: 'ready', link, accessId: access.id, email };
}

export async function endSession(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  await admin.db.rpc('end_support_access', { p_id: text(formData, 'id') });
  revalidatePath('/history');
  revalidatePath('/');
}

/**
 * Leave the console, and nothing else.
 *
 * Local scope for the same reason as the login path: an operator is also a
 * user, and closing the console should not close whatever they had open in
 * the product.
 */
export async function signOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut({ scope: 'local' });
  redirect('/login');
}
