import Link from 'next/link';
import { requireAdmin } from '@/lib/admin';
import { Chrome } from '../chrome';
import { setFeedbackStatus } from './actions';

/**
 * What customers have told us from inside the product, newest first, with the
 * page each was sent from. Marking one seen or done shows the sender it was —
 * their own feedback page says so — and records which operator did it.
 *
 * Read through RLS as the operator; nothing here uses the service-role key.
 */
export const dynamic = 'force-dynamic';

const TABS = [
  { status: 'new', label: 'Not seen' },
  { status: 'seen', label: 'Seen' },
  { status: 'done', label: 'Done' },
  { status: null, label: 'All' },
] as const;

export default async function Feedback({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const { status: asked } = await searchParams;
  const status = TABS.find((tab) => tab.status === (asked ?? 'new'))?.status ?? null;
  const admin = await requireAdmin();
  let query = admin.db
    .from('feedback')
    .select('id, company_id, sent_by, body, page, status, handled_by, handled_at, created_at')
    .order('created_at', { ascending: false })
    .limit(200);
  if (status) query = query.eq('status', status);
  const [{ data, error }, { data: people }] = await Promise.all([query, admin.db.rpc('admin_users')]);
  const emailOf = new Map((people ?? []).map((person) => [person.user_id, person.email]));
  const companyOf = new Map((people ?? []).map((person) => [person.company_id, person.company_name]));

  return (
    <Chrome email={admin.email}>
      <h1>Feedback</h1>
      <p className="lede">
        Sent by customers from the Feedback link in the web app. The sender sees whether it has been seen and whether it is
        done.
      </p>
      <p>
        {TABS.map((tab, index) => (
          <span key={tab.label}>
            {index > 0 ? ' · ' : ''}
            {tab.status === status ? (
              <strong>{tab.label}</strong>
            ) : (
              <Link href={tab.status ? `/feedback?status=${tab.status}` : '/feedback?status=all'}>{tab.label}</Link>
            )}
          </span>
        ))}
      </p>
      {error ? <p className="tag open">{error.message}</p> : null}
      {(data ?? []).length === 0 && !error ? <p className="muted">Nothing here.</p> : null}
      {(data ?? []).map((item) => (
        <section key={item.id} className="card" style={{ marginBottom: '0.75rem' }}>
          <p style={{ whiteSpace: 'pre-wrap', marginTop: 0 }}>{item.body}</p>
          <p className="muted" style={{ fontSize: '0.85rem' }}>
            {item.sent_by ? (emailOf.get(item.sent_by) ?? 'unknown account') : 'a deleted account'} ·{' '}
            {companyOf.get(item.company_id) ?? 'a closed company'} · {item.created_at.slice(0, 16).replace('T', ' ')} UTC
            {item.page ? (
              <>
                {' '}
                · from <code>{item.page}</code>
              </>
            ) : null}
            {item.handled_by ? ` · ${item.status} by ${emailOf.get(item.handled_by) ?? 'an operator'}` : ''}
          </p>
          <form action={setFeedbackStatus} style={{ display: 'flex', gap: '0.5rem' }}>
            <input type="hidden" name="id" value={item.id} />
            {(['seen', 'done', 'new'] as const)
              .filter((next) => next !== item.status)
              .map((next) => (
                <button key={next} type="submit" name="status" value={next}>
                  {next === 'new' ? 'Mark not seen' : next === 'seen' ? 'Mark seen' : 'Mark done'}
                </button>
              ))}
          </form>
        </section>
      ))}
    </Chrome>
  );
}
