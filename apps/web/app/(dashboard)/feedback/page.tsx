import { FeedbackForm } from '@/components/feedback-form';
import { createClient } from '@/lib/supabase/server';

export const metadata = { title: 'Feedback · Tesserafy' };

const STATUS: Record<string, string> = {
  new: 'not seen yet',
  seen: 'seen',
  done: 'dealt with',
};

/**
 * Tell the Tesserafy team something: a bug, a wish, a number that looks wrong.
 * It goes to the operator console, with the page it was sent from, and what
 * you have sent is listed here with whether it has been seen.
 */
export default async function FeedbackPage({ searchParams }: { searchParams: Promise<{ from?: string }> }) {
  const { from } = await searchParams;
  // Only a path in this app; anything else is dropped rather than recorded.
  const page = from && /^\/[A-Za-z0-9/_\-[\]]*$/.test(from) && from.length <= 200 ? from : null;
  const supabase = await createClient();
  const { data: sent } = await supabase
    .from('feedback')
    .select('id, body, page, status, created_at')
    .order('created_at', { ascending: false })
    .limit(50);

  return (
    <main>
      <h1>Feedback</h1>
      <p className="muted">
        A bug, something missing, a score that looks wrong — it goes straight to the people building Tesserafy. Please leave
        out anything from a call you would not want us to read.
      </p>
      <section className="card">
        <FeedbackForm page={page} />
      </section>
      {(sent ?? []).length > 0 ? (
        <section aria-labelledby="sent-heading">
          <h2 id="sent-heading">What you have sent</h2>
          <ul className="signals">
            {(sent ?? []).map((item) => (
              <li key={item.id} className="signal">
                <p style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{item.body}</p>
                <p className="muted" style={{ fontSize: '0.82rem' }}>
                  {new Date(item.created_at).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' })} UTC
                  {item.page ? ` · from ${item.page}` : ''} · <span className={`stage stage-${item.status === 'done' ? 'approved' : 'proposed'}`}>{STATUS[item.status] ?? item.status}</span>
                </p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </main>
  );
}
