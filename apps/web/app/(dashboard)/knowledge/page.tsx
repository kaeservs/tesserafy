import { AddKnowledge } from '@/components/knowledge-forms';
import { myCompanyId } from '@/lib/company';
import { KNOWLEDGE_TYPES, knowledgeFor } from '@/lib/knowledge';
import { createClient } from '@/lib/supabase/server';
import { deleteDocument } from './actions';

export const metadata = { title: 'Knowledge · Tesserafy' };

interface DocumentRow {
  id: string;
  title: string;
  source: 'upload' | 'pasted';
  file_name: string | null;
  characters: number;
  passages: number;
  status: 'processing' | 'ready' | 'failed';
  error: string | null;
  created_by: string | null;
  created_at: string;
}

/**
 * What the overlay answers product questions from: the company's own
 * documents. Owners add and delete them; everyone can read the list and try
 * a question to see which passages the overlay would quote.
 */
export default async function KnowledgePage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
    } = await supabase.auth.getUser();
  const companyId = await myCompanyId(supabase, user?.id);
  const [{ data: membership }, { data: documents }, { data: team }] = await Promise.all([
    supabase.from('company_members').select('role').eq('user_id', user?.id ?? '').eq('company_id', companyId ?? '').maybeSingle(),
    supabase
      .from('knowledge_documents')
      .select('id, title, source, file_name, characters, passages, status, error, created_by, created_at')
      .eq('company_id', companyId ?? '')
      .order('created_at', { ascending: false })
      .returns<DocumentRow[]>(),
    supabase.rpc('company_team'),
  ]);
  const isOwner = membership?.role === 'owner';
  const nameOf = new Map((team ?? []).map((person) => [person.user_id, person.is_you ? 'you' : person.email]));
  const rows = documents ?? [];
  const ready = rows.filter((row) => row.status === 'ready').length;

  // Try a question: the passages the overlay would be given for it.
  const question = (q ?? '').trim().slice(0, 300);
  let found: Awaited<ReturnType<typeof knowledgeFor>> = [];
  let searchError: string | null = null;
  if (question && companyId && ready > 0) {
    const token = (await supabase.auth.getSession()).data.session?.access_token;
    try {
      found = token ? await knowledgeFor(supabase, token, companyId, question, 4) : [];
    } catch {
      searchError = 'The search did not work just now. Try again shortly.';
    }
  }

  return (
    <main>
      <h1>Knowledge</h1>
      <p className="muted">
        What the overlay answers from when a customer asks about your product — pricing, rollout, features, objections. When a
        question comes up on a call, Assist and Ask find the passages that fit and quote them, naming the document. Without a
        passage that answers, the overlay never makes a fact up: it suggests confirming it instead.
      </p>

      {isOwner ? (
        <AddKnowledge accept={KNOWLEDGE_TYPES.join(',')} />
      ) : (
        <p className="muted">Owners add and remove documents; you can read the list and try a question below.</p>
      )}

      <section aria-labelledby="documents-heading">
        <h2 id="documents-heading">
          Documents ({rows.length} of 50)
        </h2>
        {rows.length === 0 ? (
          <p className="muted">None yet. A pricing sheet and a product overview are a good start.</p>
        ) : (
          <ul className="signals">
            {rows.map((row) => (
              <li key={row.id} className="signal">
                <div className="signal-kind muted">
                  {row.source === 'upload' ? row.file_name ?? 'Uploaded' : 'Pasted'} ·{' '}
                  {row.status === 'ready'
                    ? `${row.passages} passage${row.passages === 1 ? '' : 's'}`
                    : row.status === 'failed'
                      ? 'could not be read'
                      : 'being read'}{' '}
                  · {row.created_by ? (nameOf.get(row.created_by) ?? 'a former member') : 'a former member'},{' '}
                  {new Date(row.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })}
                </div>
                <div>{row.title}</div>
                {row.status === 'failed' && row.error ? <p className="muted" style={{ margin: '0.25rem 0' }}>{row.error}</p> : null}
                {isOwner ? (
                  <form action={deleteDocument} className="inline-form">
                    <input type="hidden" name="documentId" value={row.id} />
                    <button type="submit" className="link-button">
                      Delete
                    </button>
                  </form>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="try-heading" className="card">
        <h2 id="try-heading" style={{ marginTop: 0 }}>
          Try a question
        </h2>
        <form method="get" className="toolbar">
          <input name="q" defaultValue={question} maxLength={300} placeholder="How long does rollout take?" aria-label="A question a customer might ask" />
          <button type="submit" disabled={ready === 0}>
            Search
          </button>
        </form>
        {ready === 0 ? <p className="muted">Add a document first.</p> : null}
        {searchError ? <p role="alert">{searchError}</p> : null}
        {question && ready > 0 && !searchError ? (
          found.length === 0 ? (
            <p className="muted">Nothing in the knowledge fits that.</p>
          ) : (
            <ol className="evidence">
              {found.map((passage) => (
                <li key={passage.id}>
                  <span className="muted">{passage.title}:</span> {passage.text.length > 400 ? `${passage.text.slice(0, 400)}…` : passage.text}
                </li>
              ))}
            </ol>
          )
        ) : null}
      </section>
    </main>
  );
}
