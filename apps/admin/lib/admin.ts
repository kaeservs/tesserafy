import { createClient as createServiceRoleClient } from '@supabase/supabase-js';
import type { Database, SupabaseClient } from '@tesserafy/db';
import { redirect } from 'next/navigation';
import { createClient } from './supabase/server';

/**
 * The console's two clients, and the line between them.
 *
 * This app exists as a separate deployment for one reason: it holds the
 * service-role key, and `apps/web` must never. That is not a preference, it is
 * a guard in CI — a key in the customer app is one bad import away from a
 * browser bundle, and this product's rows are other companies' customer calls.
 *
 * So the split is kept sharp here too. Everything an operator sees is read
 * through `adminClient()`, which is *them*, signed in, subject to RLS and to
 * functions that check `is_platform_admin()`. The service-role key appears in
 * exactly one function below, `mintSessionFor`, because minting a session is
 * the one thing the Auth admin API will not do for anybody else.
 *
 * Put another way: the powerful key can create a session and nothing else. It
 * cannot read a conversation, decide who is an admin, or write an audit row.
 */

export interface Admin {
  db: SupabaseClient;
  userId: string;
  email: string;
}

/**
 * Who is asking, and are they allowed in.
 *
 * The check is a read of `platform_admins`, which RLS lets a user perform only
 * for their own row. That means this cannot be fooled by a client-side claim
 * and does not depend on this app getting the check right — the database makes
 * the decision, and every admin RPC makes it again independently.
 */
export async function requireAdmin(): Promise<Admin> {
  const db: SupabaseClient = await createClient();
  const { data: auth } = await db.auth.getUser();
  if (!auth.user) redirect('/login');

  const { data } = await db
    .from('platform_admins')
    .select('user_id')
    .eq('user_id', auth.user.id)
    .maybeSingle();

  // Not "you are not an admin". Someone who is not an admin has no business
  // learning that this console exists, let alone that they failed a check on
  // it.
  if (!data) redirect('/login?denied=1');

  return { db, userId: auth.user.id, email: auth.user.email ?? 'unknown' };
}

/**
 * A live session for somebody else, and the only use of the service-role key.
 *
 * `redirectTo` is the customer app's confirm page, so the link lands where a
 * real sign-in lands and the session is an ordinary session. There is no
 * special impersonation mode in the product, which is the honest design: the
 * session genuinely is theirs, with their view and their attribution, and the
 * `support_access` row is the only thing that records otherwise.
 */
export interface MintedSession {
  readonly link: string;
  /**
   * Set when the link will not land where it was asked to. Supabase falls back
   * to the project's Site URL for a redirect it was not given, or one that is
   * not on the allow-list.
   */
  readonly landsElsewhere?: string;
}

export async function mintSessionFor(email: string): Promise<MintedSession | null> {
  const url = process.env['NEXT_PUBLIC_SUPABASE_URL'];
  const serviceKey = process.env['SUPABASE_SERVICE_ROLE_KEY'];
  const appUrl = process.env['NEXT_PUBLIC_APP_URL'];
  if (!url || !serviceKey || !appUrl) return null;

  const response = await fetch(new URL('/auth/v1/admin/generate_link', url), {
    method: 'POST',
    headers: {
      apikey: serviceKey,
      authorization: `Bearer ${serviceKey}`,
      'content-type': 'application/json',
    },
    // `redirect_to` at the top level. The JavaScript SDK spells it
    // `options: { redirectTo }` and translates; this calls the REST endpoint
    // directly, which ignores a field it does not recognise and falls back to
    // the Site URL. That nesting shipped once and was diagnosed as Supabase
    // quietly overriding the allow-list — the allow-list was correct all
    // along, and the request was wrong.
    body: JSON.stringify({
      type: 'magiclink',
      email,
      redirect_to: new URL('/auth/confirm', appUrl).toString(),
    }),
  });
  if (!response.ok) return null;

  const body = (await response.json()) as {
    action_link?: string;
    properties?: { action_link?: string };
  };
  const link = body.action_link ?? body.properties?.action_link;
  if (!link) return null;

  // Kept after the real cause turned out to be our own request, because the
  // failure it reports is real regardless of cause: a link that lands on the
  // Site URL still works and still carries a session, and looks to the
  // operator like a broken button. Asking the link where it is actually going
  // is what found the nesting bug, and it is what will find the next one.
  const asked = new URL('/auth/confirm', appUrl).toString();
  const going = new URL(link).searchParams.get('redirect_to');
  return going && going !== asked ? { link, landsElsewhere: going } : { link };
}

/**
 * Service-role reads, for the one thing RLS cannot answer.
 *
 * Deliberately unused so far, and exported only so that the next person who
 * needs it finds it here rather than building a second one. If a screen wants
 * data an admin RPC does not expose, the right move is a new RPC that checks
 * `is_platform_admin()`, not a query that skips the check.
 */
export function serviceRole(): SupabaseClient | null {
  const url = process.env['NEXT_PUBLIC_SUPABASE_URL'];
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY'];
  if (!url || !key) return null;
  return createServiceRoleClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
