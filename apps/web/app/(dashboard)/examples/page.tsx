import Link from 'next/link';
import { batches, fetchCriterionLabels, readAll } from '@tesserafy/db';
import { RemoveExample } from '@/components/remove-example';
import { engagementLabel, myCompanyId } from '@/lib/company';
import { clock } from '@/lib/highlight';
import { createClient } from '@/lib/supabase/server';

/**
 * Examples: moments from real calls, filed under the criterion each shows
 * being met. The first thing to hand a new seller — this is what "getting the
 * budget" sounds like on one of our calls.
 *
 * The words are the stored line of the transcript, not a copy, and each links
 * to its place in the call. Anyone in the company saves them from a call page;
 * whoever saved one, or an owner, takes it out.
 */

interface MomentRow {
  id: string;
  conversation_id: string;
  segment_id: string;
  engagement_type: string;
  criterion_key: string;
  note: string | null;
  saved_by: string | null;
  created_at: string;
}

export default async function ExamplesPage({
  searchParams,
}: {
  searchParams: Promise<{ criterion?: string }>;
}) {
  const { criterion: asked } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const companyId = await myCompanyId(supabase, user?.id);

  const [moments, labels, { data: team }, { data: membership }] = await Promise.all([
    readAll<MomentRow>(
      (from, to) =>
        supabase
          .from('moments')
          .select('id, conversation_id, segment_id, engagement_type, criterion_key, note, saved_by, created_at')
          .order('created_at', { ascending: false })
          .order('id')
          .range(from, to),
      'Could not load examples',
    ),
    fetchCriterionLabels(supabase, companyId),
    supabase.rpc('company_team'),
    supabase.from('company_members').select('role').eq('user_id', user?.id ?? '').limit(1).maybeSingle(),
  ]);
  const isOwner = membership?.role === 'owner';
  const emailOf = new Map((team ?? []).map((person) => [person.user_id, person.is_you ? 'you' : person.email]));

  const segmentIds = [...new Set(moments.map((moment) => moment.segment_id))];
  const callIds = [...new Set(moments.map((moment) => moment.conversation_id))];
  const [segmentRows, callRows] = await Promise.all([
    Promise.all(
      batches(segmentIds).map(async (ids) => (await supabase.from('segments').select('id, speaker, start_ms, text').in('id', ids)).data ?? []),
    ),
    Promise.all(
      batches(callIds).map(
        async (ids) => (await supabase.from('conversations').select('id, title, occurred_at, created_at').in('id', ids)).data ?? [],
      ),
    ),
  ]);
  const segmentOf = new Map(segmentRows.flat().map((row) => [row.id, row]));
  const callOf = new Map(callRows.flat().map((row) => [row.id, row]));

  const countOf = new Map<string, number>();
  for (const moment of moments) {
    const id = `${moment.engagement_type}/${moment.criterion_key}`;
    countOf.set(id, (countOf.get(id) ?? 0) + 1);
  }
  const types = [...new Set(labels.map((label) => label.engagementType))];
  const shown = asked ? moments.filter((moment) => `${moment.engagement_type}/${moment.criterion_key}` === asked) : moments;
  const labelOf = new Map(labels.map((label) => [`${label.engagementType}/${label.key}`, label.label]));

  return (
    <main>
      <h1>Examples</h1>
      <p className="muted">
        Moments from your calls that show a criterion being met, saved by your team. Save one from any call: under a line of
        the transcript, choose <em>Save as an example</em>.
      </p>

      {moments.length > 0 ? (
        <nav aria-label="Criteria" className="card">
          {types.map((type) => (
            <p key={type} style={{ margin: '0.2rem 0' }}>
              {types.length > 1 ? <strong>{engagementLabel(type)}: </strong> : null}
              {labels
                .filter((label) => label.engagementType === type)
                .map((label, index) => {
                  const id = `${type}/${label.key}`;
                  const count = countOf.get(id) ?? 0;
                  return (
                    <span key={id}>
                      {index > 0 ? ' · ' : ''}
                      {count > 0 ? (
                        <Link href={`/examples?criterion=${encodeURIComponent(id)}`} aria-current={asked === id ? 'page' : undefined}>
                          {label.label} ({count})
                        </Link>
                      ) : (
                        <span className="muted">{label.label} (0)</span>
                      )}
                    </span>
                  );
                })}
            </p>
          ))}
          {asked ? (
            <p style={{ marginBottom: 0 }}>
              <Link href="/examples">Show every example</Link>
            </p>
          ) : null}
        </nav>
      ) : null}

      {shown.length === 0 ? (
        <p className="muted">
          {moments.length === 0
            ? 'None saved yet. A good first one is the moment on a call where someone got the budget, or put a number on the pain.'
            : 'None saved for this criterion yet.'}
        </p>
      ) : (
        <ul className="signals">
          {shown.map((moment) => {
            const segment = segmentOf.get(moment.segment_id);
            const call = callOf.get(moment.conversation_id);
            const mayRemove = isOwner || (user !== null && moment.saved_by === user.id);
            return (
              <li key={moment.id} className="signal">
                <div className="signal-kind muted">
                  {labelOf.get(`${moment.engagement_type}/${moment.criterion_key}`) ?? moment.criterion_key}
                  {types.length > 1 ? ` · ${engagementLabel(moment.engagement_type)}` : ''}
                </div>
                {segment ? (
                  <blockquote className="example-quote">
                    “{segment.text}”
                    <footer className="muted">
                      {segment.speaker ?? 'Unnamed speaker'}, at{' '}
                      <Link href={`/conversations/${moment.conversation_id}#segment-${moment.segment_id}`}>
                        {clock(segment.start_ms)} in {call?.title ?? 'the call'}
                      </Link>
                      {call ? ` · ${(call.occurred_at ?? call.created_at).slice(0, 10)}` : ''}
                    </footer>
                  </blockquote>
                ) : null}
                {moment.note ? <p>{moment.note}</p> : null}
                <p className="muted" style={{ fontSize: '0.82rem' }}>
                  Saved by {moment.saved_by ? (emailOf.get(moment.saved_by) ?? 'a former member') : 'a former member'}
                  {mayRemove ? (
                    <>
                      {' · '}
                      <RemoveExample momentId={moment.id} conversationId={moment.conversation_id} />
                    </>
                  ) : null}
                </p>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
