/**
 * Erasing a meeting, and ageing meetings out.
 *
 *   pnpm erase --conversation <uuid>            one, on request
 *   pnpm erase --company <uuid> --retention 90  set a retention period
 *   pnpm erase --purge [--company <uuid>]       erase everything past it
 *   pnpm erase --log --company <uuid>           what has been erased
 *
 * Deliberately a script and not a button. Erasure cannot be undone, the log
 * cannot bring anything back, and a confirmation dialog is a weaker guard
 * than having to be an operator at a terminal. A customer-facing delete is a
 * later decision, and the database is already ready for it: erase_conversation
 * accepts an owner as well as the service role.
 *
 * Nothing here prints a transcript, a title or a quote. An operator running an
 * erasure does not need to see what they are erasing, and a terminal
 * scrollback is one more copy of it.
 */
import { createServiceClient, type SupabaseClient } from '@tesserafy/db';

function flag(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`erase: ${name} is not set`);
    process.exit(2);
  }
  return value;
}

interface ErasureSummary {
  conversation_id: string;
  segments_removed: number;
  signals_removed: number;
  events_removed: number;
  insights_removed: number;
  exported_tickets: { provider: string; url: string }[];
}

function report(summary: ErasureSummary): void {
  console.info(
    `erased ${summary.conversation_id}: ${summary.segments_removed} segments, ` +
      `${summary.signals_removed} signals, ${summary.events_removed} criterion events, ` +
      `${summary.insights_removed} insights`,
  );

  if (summary.exported_tickets.length > 0) {
    // The one thing this command cannot finish. Quotes reached a tracker
    // before the erasure and no amount of SQL recalls them.
    console.warn(
      `\n  ${summary.exported_tickets.length} ticket(s) already carry quotes from this conversation ` +
        `into an external tracker. Delete them by hand:`,
    );
    for (const ticket of summary.exported_tickets) console.warn(`    ${ticket.url}`);
    console.warn('');
  }
}

async function eraseOne(db: SupabaseClient, id: string, reason: string): Promise<void> {
  const { data, error } = await db.rpc('erase_conversation', {
    p_conversation_id: id,
    p_reason: reason,
  });
  if (error) throw new Error(`erasing ${id} failed: ${error.message}`);
  // The function returns jsonb, so the generated type is Json and the shape
  // is this script's own reading of it. Through unknown, because a cast that
  // tsc cannot follow should look like the assertion it is.
  report(data as unknown as ErasureSummary);
}

async function setRetention(db: SupabaseClient, companyId: string, days: number): Promise<void> {
  const { error } = await db
    .from('companies')
    .update({ retention_days: days })
    .eq('id', companyId);
  if (error) throw new Error(`setting retention failed: ${error.message}`);
  console.info(
    `retention for ${companyId} is now ${days} days. ` +
      `Nothing is erased until --purge runs; this only says what is past due.`,
  );
}

async function purge(db: SupabaseClient, companyId: string | undefined): Promise<void> {
  const { data, error } = await db.rpc('purge_expired_conversations', {
    // Omitted rather than null: the function reads it as "every company I am
    // allowed to purge", which is what an operator running --purge means.
    ...(companyId ? { p_company_id: companyId } : {}),
    p_limit: 500,
  });
  if (error) throw new Error(`purge failed: ${error.message}`);

  const erased = (data as { erased: number }).erased;
  console.info(
    erased === 0
      ? 'Nothing past its retention period.'
      : `Erased ${erased} conversation(s) past their retention period.`,
  );
  if (erased > 0) {
    console.info('See `pnpm erase --log --company <uuid>` for any tickets still to be deleted.');
  }
}

async function showLog(db: SupabaseClient, companyId: string): Promise<void> {
  const { data, error } = await db
    .from('erasure_events')
    .select('conversation_id, reason, segments_removed, insights_removed, exported_tickets, created_at')
    .eq('company_id', companyId)
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) throw new Error(`reading the log failed: ${error.message}`);

  const rows = (data ?? []) as {
    conversation_id: string;
    reason: string;
    segments_removed: number;
    insights_removed: number;
    exported_tickets: { url: string }[];
    created_at: string;
  }[];

  if (rows.length === 0) {
    console.info('Nothing has been erased for that company.');
    return;
  }

  for (const row of rows) {
    const tickets = row.exported_tickets.length;
    console.info(
      `${row.created_at.slice(0, 19)}  ${row.reason.padEnd(9)} ${row.conversation_id}  ` +
        `${row.segments_removed} segments, ${row.insights_removed} insights` +
        (tickets > 0 ? `  · ${tickets} ticket(s) exported before erasure` : ''),
    );
  }
}

async function main(): Promise<void> {
  const conversationId = flag('--conversation');
  const companyId = flag('--company');
  const retention = flag('--retention');
  const wantsPurge = process.argv.includes('--purge');
  const wantsLog = process.argv.includes('--log');

  const db = createServiceClient({
    url: requireEnv('SUPABASE_URL'),
    key: requireEnv('SUPABASE_SERVICE_ROLE_KEY'),
  });

  if (conversationId) {
    await eraseOne(db, conversationId, 'request');
    return;
  }
  if (retention) {
    if (!companyId) {
      console.error('erase: --retention needs --company <uuid>');
      process.exit(2);
    }
    const days = Number(retention);
    if (!Number.isInteger(days) || days < 1 || days > 3650) {
      console.error(`erase: --retention wants a whole number of days from 1 to 3650, got ${retention}`);
      process.exit(2);
    }
    await setRetention(db, companyId, days);
    return;
  }
  if (wantsPurge) {
    await purge(db, companyId);
    return;
  }
  if (wantsLog) {
    if (!companyId) {
      console.error('erase: --log needs --company <uuid>');
      process.exit(2);
    }
    await showLog(db, companyId);
    return;
  }

  console.error(
    'usage: pnpm erase --conversation <uuid>\n' +
      '       pnpm erase --company <uuid> --retention <days>\n' +
      '       pnpm erase --purge [--company <uuid>]\n' +
      '       pnpm erase --log --company <uuid>',
  );
  process.exit(2);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
