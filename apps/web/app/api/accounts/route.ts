import { NextResponse, type NextRequest } from 'next/server';
import { listAccounts } from '@/lib/accounts';
import { caller } from '@/lib/supabase/caller';

/**
 * The caller's company's accounts, most recently spoken to first — for the
 * overlay's "who is this call with" picker. Names and ids only; the brief for
 * the one chosen comes from /api/accounts/[id]/brief. RLS scopes it.
 */
export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const who = await caller(request);
  if (!who) return NextResponse.json({ error: 'not signed in' }, { status: 401 });

  const accounts = (await listAccounts(who.db))
    .sort((a, b) => (b.lastCallAt ?? '').localeCompare(a.lastCallAt ?? '') || a.name.localeCompare(b.name))
    .map((account) => ({ id: account.id, name: account.name }));
  return NextResponse.json({ accounts });
}
