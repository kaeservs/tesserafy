/**
 * Looking at somebody's account, on the record.
 *
 *   pnpm support --users                          who exists, and where
 *   pnpm support --companies                      tenants, size, spend, failures
 *   pnpm support --as <email> --reason "..."      open a session as that user
 *   pnpm support --end <id>                       close one early
 *   pnpm support --history [--user <email>]       every time this has happened
 *
 * This was always possible. Anyone holding the service-role key can mint a
 * session for any email through the Auth admin API — scripts/qa.ts does it for
 * the probe account, in about ten lines. What was missing was not capability
 * but accountability: no record, no expiry, and every action attributed to the
 * person being impersonated.
 *
 * So the ordering here is the point. The access is written down first, by the
 * database, as a decision the database makes; only then is a session minted.
 * If the recording fails, the access does not happen.
 *
 * The service-role key is used for exactly one thing: minting sessions. Every
 * authorisation decision — are you an admin, may you open this, for how long —
 * is made by an RPC running as *you*, because with the service-role key
 * `auth.uid()` is null and `is_platform_admin()` is false. That is deliberate.
 * A tool that authorised itself would be a tool whose audit trail records
 * whatever it felt like recording.
 *
 * Needs SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and SUPPORT_ADMIN_EMAIL.
 */
import { createTokenClient, type SupabaseClient } from '@tesserafy/db';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`support: ${name} is not set`);
    process.exit(2);
  }
  return value;
}

function flag(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

function has(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function clock(iso: string | null): string {
  if (!iso) return 'never';
  // Clamped at zero. A timestamp can sit a moment in the future — the
  // server's clock against this one, or, in the support tool, the sign-in
  // this very command just performed — and an unclamped floor renders that
  // as "-1d ago", which reads like a bug in the data rather than in the
  // arithmetic.
  const days = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000));
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  return `${days}d ago`;
}

/**
 * A session for an email, through the Auth admin API.
 *
 * The same call the QA script makes, and the same call anyone with the key
 * could make without this script. Its presence here is not what grants the
 * power; the audit row written before it is what makes using it accountable.
 */
async function sessionFor(
  url: string,
  serviceKey: string,
  email: string,
): Promise<{ token: string; link: string } | null> {
  const generated = await fetch(new URL('/auth/v1/admin/generate_link', url), {
    method: 'POST',
    headers: {
      apikey: serviceKey,
      authorization: `Bearer ${serviceKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ type: 'magiclink', email }),
  });
  if (!generated.ok) {
    console.error(`support: could not generate a link for ${email}: ${generated.status}`);
    return null;
  }

  const body = (await generated.json()) as {
    action_link?: string;
    properties?: { action_link?: string };
  };
  const link = body.action_link ?? body.properties?.action_link;
  if (!link) return null;

  const verified = await fetch(link, { redirect: 'manual' });
  const location = verified.headers.get('location') ?? '';
  const token = new URLSearchParams(location.split('#')[1] ?? '').get('access_token');
  return token ? { token, link } : null;
}

async function main(): Promise<void> {
  const url = requireEnv('SUPABASE_URL');
  const serviceKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY');
  const adminEmail = requireEnv('SUPPORT_ADMIN_EMAIL');
  // Reads go through RLS as the admin, so the browser key is the right one.
  const publishableKey = process.env['SUPABASE_PUBLISHABLE_KEY'] ?? serviceKey;

  const me = await sessionFor(url, serviceKey, adminEmail);
  if (!me) {
    console.error(`support: could not sign in as ${adminEmail}`);
    process.exit(1);
  }
  const db: SupabaseClient = createTokenClient({ url, key: publishableKey, token: me.token });

  if (has('companies')) {
    const { data, error } = await db.rpc('admin_companies');
    if (error) return fail(error.message);
    console.log('\ncompany                 plan      members  convos  segments  last    24h  30d $');
    console.log('-'.repeat(88));
    for (const row of data ?? []) {
      console.log(
        `${row.name.slice(0, 22).padEnd(22)}  ${row.plan.padEnd(8)}  ` +
          `${String(row.members).padStart(7)}  ${String(row.conversations).padStart(6)}  ` +
          `${String(row.segments).padStart(8)}  ${clock(row.last_activity).padStart(6)}  ` +
          `${String(row.failures_24h).padStart(3)}  ${Number(row.spend_30d_usd).toFixed(2).padStart(6)}`,
      );
    }
    return;
  }

  if (has('history')) {
    const subject = flag('user');
    let query = db
      .from('support_access')
      .select('id, admin_user_id, subject_user_id, reason, created_at, expires_at, ended_at')
      .order('created_at', { ascending: false })
      .limit(50);

    const { data: users } = await db.rpc('admin_users');
    const emailOf = new Map((users ?? []).map((u) => [u.user_id, u.email]));
    if (subject) {
      const id = (users ?? []).find((u) => u.email === subject)?.user_id;
      if (!id) return fail(`no user with the address ${subject}`);
      query = query.eq('subject_user_id', id);
    }

    const { data, error } = await query;
    if (error) return fail(error.message);
    if ((data ?? []).length === 0) {
      console.log('support: nobody has opened anybody. That is the expected state.');
      return;
    }
    console.log('\nwhen        who                  opened            reason');
    console.log('-'.repeat(88));
    for (const row of data ?? []) {
      const state = row.ended_at
        ? 'ended'
        : new Date(row.expires_at) > new Date()
          ? 'OPEN'
          : 'expired';
      console.log(
        `${clock(row.created_at).padEnd(10)}  ${(emailOf.get(row.admin_user_id) ?? '?').slice(0, 19).padEnd(19)}  ` +
          `${(emailOf.get(row.subject_user_id) ?? '?').slice(0, 16).padEnd(16)}  ${state}  ${row.reason}`,
      );
    }
    return;
  }

  const endId = flag('end');
  if (endId) {
    const { error } = await db.rpc('end_support_access', { p_id: endId });
    if (error) return fail(error.message);
    console.log('support: closed. The session token itself lives until Supabase expires it.');
    return;
  }

  const subject = flag('as');
  if (subject) {
    const reason = flag('reason');
    if (!reason) return fail('--as needs --reason. That is the whole point of this script.');
    const minutes = Number(flag('minutes') ?? 30);

    const { data: users, error: usersError } = await db.rpc('admin_users');
    if (usersError) return fail(usersError.message);
    const target = (users ?? []).find((u) => u.email === subject);
    if (!target) return fail(`no user with the address ${subject}`);

    // Recorded first. If this fails, nothing is minted.
    const { data: access, error } = await db.rpc('open_support_access', {
      p_subject_user_id: target.user_id,
      p_reason: reason,
      p_minutes: Number.isInteger(minutes) ? minutes : 30,
    });
    if (error) return fail(error.message);

    const theirs = await sessionFor(url, serviceKey, subject);
    if (!theirs) return fail(`recorded as ${access.id}, but no session could be minted`);

    console.log(`\nsupport: recorded ${access.id}`);
    console.log(`         as ${subject}, for ${minutes} minutes, because: ${reason}`);
    console.log('\nOpen this to be signed in as them:\n');
    console.log(`  ${theirs.link}\n`);
    console.log('Two things to hold on to:');
    console.log('  - Everything you do will be attributed to THEM. The row above is the');
    console.log('    only thing that says otherwise.');
    console.log('  - That link is a live credential and is now in your shell history.');
    console.log(`\nWhen you are done:  pnpm support --end ${access.id}`);
    return;
  }

  // Default: the people.
  const { data, error } = await db.rpc('admin_users');
  if (error) return fail(error.message);
  console.log('\nemail                          company              role    last seen  ');
  console.log('-'.repeat(80));
  for (const row of data ?? []) {
    const marks = [row.is_admin ? 'admin' : '', row.open_support ? 'OPEN SUPPORT' : '']
      .filter(Boolean)
      .join(' ');
    console.log(
      `${(row.email ?? '?').slice(0, 29).padEnd(29)}  ${(row.company_name ?? '—').slice(0, 19).padEnd(19)}  ` +
        `${(row.role ?? '—').padEnd(6)}  ${clock(row.last_sign_in).padStart(9)}  ${marks}`,
    );
  }
}

function fail(message: string): never {
  console.error(`support: ${message}`);
  process.exit(1);
}

main().catch((error: unknown) => {
  console.error(`support: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(2);
});
