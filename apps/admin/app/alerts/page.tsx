import { requireAdmin } from '@/lib/admin';
import { Chrome } from '../chrome';
import { TokenControls } from './token';

/**
 * Alerts (ADR 0019): the token the company's n8n workflow reads
 * `ops_digest` with, so a failure that needs a person, or the model provider
 * refusing us for money, becomes a message rather than a red run nobody opens.
 *
 * What the workflow reads is counts and states only — never a failure's
 * message, a company's name or anything from a call — because what it reads
 * leaves for a chat app.
 */
export const dynamic = 'force-dynamic';

interface Token {
  hint: string;
  created_at: string;
  last_used: string | null;
}

function when(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }) + ' UTC' : 'never';
}

export default async function Alerts() {
  const admin = await requireAdmin();
  const { data, error } = await admin.db.rpc('admin_ops_token');
  const token = data as unknown as Token | null;
  const publicUrl = process.env['NEXT_PUBLIC_SUPABASE_URL'] ?? process.env['SUPABASE_URL'] ?? '<your Supabase URL>';

  return (
    <Chrome email={admin.email}>
      <h1>Alerts</h1>
      <p className="lede">
        A workflow on Tesserafy&apos;s own n8n asks the database every few minutes whether anything needs a person, and
        sends a message when it does. It reads with this token and the public key, never the service-role key, and gets
        counts only: failures by kind and where, whether the model provider has refused us for money, what waits on an
        operator, and the AI spend in total.
      </p>
      {error ? <p className="tag open">{error.message}</p> : null}

      <section className="card" style={{ marginBottom: '1rem' }}>
        <h2 style={{ marginTop: 0 }}>The workflow&apos;s token</h2>
        <p>
          {token ? (
            <>
              <span className="tag">live</span> ending <code>…{token.hint}</code>, made {when(token.created_at)}, last
              used {when(token.last_used)}.
            </>
          ) : (
            <>
              <span className="tag open">none</span> No workflow can read the digest.
            </>
          )}
        </p>
        <TokenControls live={token !== null} />
      </section>

      <section className="card">
        <h2 style={{ marginTop: 0 }}>What the workflow calls</h2>
        <p className="muted">
          A POST to <code>{publicUrl}/rest/v1/rpc/ops_digest</code> with the headers <code>apikey</code> and{' '}
          <code>Authorization: Bearer</code> set to the public (publishable) key, and the body{' '}
          <code>{'{"p_token": "<the token>", "p_hours": 4}'}</code>. It answers with <code>alarming</code> (failures
          that need a person), <code>billing</code>, <code>failures</code>, <code>waiting</code>,{' '}
          <code>new_companies</code> and <code>spend_usd</code>. Send a message when <code>alarming</code> is above zero
          or <code>billing</code> is true.
        </p>
      </section>
    </Chrome>
  );
}
