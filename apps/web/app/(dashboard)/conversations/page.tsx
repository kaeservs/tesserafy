import { BulkBar } from '@/components/bulk-bar';
import { BULK_FORM } from '@/lib/bulk';
import { engagementLabel, myCompanyId, sampleCallOffered } from '@/lib/company';
import Link from 'next/link';
import { GettingStarted } from '@/components/getting-started';
import { ScorecardStrip } from '@/components/scorecard-strip';
import { conversationPipeline, stageOf } from '@/lib/pipeline';
import { fetchCriteriaSets } from '@tesserafy/db';
import { findMeetings } from '@/lib/meetings';
import {
  applyFilters,
  BANDS,
  hrefWith,
  OUTCOMES,
  isFiltered,
  PAGE_SIZE,
  SORTS,
} from '@/lib/meeting-filters';
import { createClient } from '@/lib/supabase/server';
import { OUTCOME_LABEL } from '@/lib/outcome';

/**
 * Every meeting, with how it scored — searchable, filterable, a page at a time.
 *
 * No company filter in this query, on purpose. It runs as the signed-in user,
 * so RLS alone decides which rows come back — this page is the "via API" leg
 * of the P0 gate made visible.
 *
 * Scores are computed here rather than read: `criterion_events` holds quoted
 * spans, and `score(replay(...))` turns them into a number at request time.
 * Scoring the whole list costs one query for the events and one per distinct
 * criteria set, not one per meeting.
 *
 * Filters narrow in SQL where the column is stored (title, seller,
 * scorecard), and the rest — dates, score band, sort, page — is applied after
 * scoring, because a score is not a column (lib/meeting-filters.ts). Owners
 * can pick any seller; a member can pick only their own calls, the same line
 * Reports draws.
 */

function when(occurredAt: string | null): string {
  if (!occurredAt) return 'no date';
  return new Date(occurredAt).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/**
 * A call's stage, in a brand's words. "scored" read as a verdict; what it
 * means is that the call has not been read for insights yet.
 */
const STAGE_LABEL: Record<string, string> = {
  captured: 'scoring',
  scored: 'not read for insights yet',
  empty: 'empty',
};

export default async function ConversationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const erased = typeof params['erased'] === 'string' ? params['erased'] : undefined;
  const exported = Number(params['tickets'] ?? 0);
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const [{ data: membership }, { data: team }, sets, { count: everything }, { data: accountRows }] = await Promise.all([
    supabase.from('company_members').select('role').eq('user_id', user?.id ?? '').limit(1).maybeSingle(),
    supabase.rpc('company_team'),
    myCompanyId(supabase, user?.id).then((companyId) => fetchCriteriaSets(supabase, companyId)),
    supabase.from('conversations').select('id', { count: 'exact', head: true }),
    supabase.from('accounts').select('id, name').order('name').limit(500),
  ]);
  const accountOf = new Map((accountRows ?? []).map((row) => [row.id, row.name]));
  const isOwner = membership?.role === 'owner';

  const [{ filters, meetings }, pipeline] = await Promise.all([
    findMeetings(supabase, params, { userId: user?.id ?? null, isOwner }),
    conversationPipeline(supabase),
  ]);
  const shown = applyFilters(meetings, filters);
  const filtered = isFiltered(filters);
  const emailOf = new Map((team ?? []).map((person) => [person.user_id, person.email]));
  const types = [...new Set(sets.map((set) => set.engagementType))];
  const total = everything ?? meetings.length;

  return (
    <main className="wide">
      <div className="section-head" style={{ marginTop: 0 }}>
        <h1>Meetings</h1>
        <Link href="/conversations/new">Import a transcript</Link>
      </div>
      {erased ? (
        <p className="card" role="status">
          The call was deleted, with everything derived from it.
          {exported > 0
            ? ` ${exported} ticket${exported === 1 ? ' was' : 's were'} exported from it to your ` +
              'tracker earlier; those live in the tracker and were not deleted — remove them there ' +
              'if they should go too.'
            : ''}
        </p>
      ) : null}
      {total > 0 ? (
        <form method="get" action="/conversations" className="filters" role="search" aria-label="Find a meeting">
          <div className="field">
            <label htmlFor="q">Title</label>
            <input id="q" name="q" type="search" defaultValue={filters.q} placeholder="Acme" />
          </div>
          <div className="field">
            <label htmlFor="seller">Seller</label>
            <select id="seller" name="seller" defaultValue={filters.seller ?? ''}>
              <option value="">Everyone</option>
              <option value="mine">Only my calls</option>
              {isOwner
                ? (team ?? [])
                    .filter((person) => !person.is_you)
                    .map((person) => (
                      <option key={person.user_id} value={person.user_id}>
                        {person.email}
                      </option>
                    ))
                : null}
            </select>
          </div>
          {(accountRows ?? []).length > 0 ? (
            <div className="field">
              <label htmlFor="account">Customer</label>
              <select id="account" name="account" defaultValue={filters.account ?? ''}>
                <option value="">Any</option>
                {(accountRows ?? []).map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.name}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          <div className="field">
            <label htmlFor="type">Scorecard</label>
            <select id="type" name="type" defaultValue={filters.type ?? ''}>
              <option value="">Any</option>
              {types.map((type) => (
                <option key={type} value={type}>
                  {engagementLabel(type)}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="from">From</label>
            <input id="from" name="from" type="date" defaultValue={filters.from ?? ''} />
          </div>
          <div className="field">
            <label htmlFor="to">To</label>
            <input id="to" name="to" type="date" defaultValue={filters.to ?? ''} />
          </div>
          <div className="field">
            <label htmlFor="score">Score</label>
            <select id="score" name="score" defaultValue={filters.band ?? ''}>
              <option value="">Any</option>
              {Object.entries(BANDS).map(([band, label]) => (
                <option key={band} value={band}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="outcome">Outcome</label>
            <select id="outcome" name="outcome" defaultValue={filters.outcome ?? ''}>
              <option value="">Any</option>
              {Object.entries(OUTCOMES).map(([outcome, label]) => (
                <option key={outcome} value={outcome}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="sort">Sort</label>
            <select id="sort" name="sort" defaultValue={filters.sort}>
              {Object.entries(SORTS).map(([sort, label]) => (
                <option key={sort} value={sort}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <div className="toolbar filter-actions">
            <button type="submit">Show</button>
            {filtered || filters.sort !== 'newest' ? <Link href="/conversations">Clear</Link> : null}
            {/* A download, not a page: a plain anchor, so Next does not try to route it. */}
            <a href={hrefWith(filters, { page: 1 }, '/api/export/meetings')} download>
              Download CSV
            </a>
          </div>
        </form>
      ) : null}

      <p className="muted">
        {filtered
          ? `${shown.total} of ${total} meeting${total === 1 ? '' : 's'} match.`
          : `${total} meeting${total === 1 ? '' : 's'}.`}{' '}
        {shown.pages > 1
          ? `Showing ${(shown.page - 1) * PAGE_SIZE + 1}–${(shown.page - 1) * PAGE_SIZE + shown.items.length}. `
          : ''}
        Each score is computed from the quoted evidence behind it. To search what was said, use{' '}
        <Link href="/search">Search</Link>.
      </p>

      {total > 0 && shown.total === 0 ? (
        <p className="card">
          No meetings match these filters. <Link href="/conversations">Show every meeting</Link>
        </p>
      ) : null}

      {total === 0 ? (
        <div style={{ marginTop: '1.5rem' }}>
          <GettingStarted offerSample={await sampleCallOffered(supabase)} />
        </div>
      ) : (
        <>
        {/* Acting on several at once: only for calls this person may change. */}
        {shown.items.some((conversation) => isOwner || conversation.added_by === user?.id) ? (
          <BulkBar accounts={accountRows ?? []} mayDelete={isOwner} />
        ) : null}
        <ul className="meetings" style={{ marginTop: '1.5rem' }}>
          {shown.items.map((conversation) => {
            const card = conversation.card;
            const mayChange = isOwner || conversation.added_by === user?.id;
            const observed = conversation.score !== null;
            const stage = stageOf(pipeline.get(conversation.id));

            return (
              <li key={conversation.id} className={`meeting${mayChange ? ' selectable' : ''}`}>
                {mayChange ? (
                  <input
                    type="checkbox"
                    name="ids"
                    value={conversation.id}
                    form={BULK_FORM}
                    className="meeting-pick"
                    aria-label={`Choose ${conversation.title}`}
                  />
                ) : null}
                <Link href={`/conversations/${conversation.id}`} className="meeting-title">
                  {conversation.title}
                </Link>
                <span className="meeting-meta">
                  {when(conversation.occurred_at)} · {engagementLabel(conversation.engagement_type)}
                  {conversation.account_id && accountOf.has(conversation.account_id) ? ` · ${accountOf.get(conversation.account_id)}` : ''}
                  {isOwner && conversation.added_by ? ` · ${emailOf.get(conversation.added_by) ?? 'former member'}` : ''}
                  {conversation.outcome ? (
                    <span className={`stage outcome-${conversation.outcome}`}>{OUTCOME_LABEL[conversation.outcome]}</span>
                  ) : null}
                  {/* One word for how far this call has got. An imported
                      transcript arrives finished; a live one does not, and
                      looked identical to a finished call that scored badly. */}
                  {stage !== 'processed' && <span className={`stage stage-${stage}`}>{STAGE_LABEL[stage] ?? stage}</span>}
                </span>
                <span className="meeting-score">
                  {card && observed ? (
                    <>
                      <ScorecardStrip scorecard={card.scorecard} />
                      <span className="score-figure">{Math.round(card.scorecard.score)}</span>
                    </>
                  ) : (
                    // "Not scored" and a zero look the same to a reader in a
                    // hurry and mean opposite things, so they never share a
                    // rendering.
                    <span className="muted">not scored</span>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
        </>
      )}

      {shown.pages > 1 ? (
        <nav className="toolbar pager" aria-label="Pages">
          {shown.page > 1 ? (
            <Link href={hrefWith(filters, { page: shown.page - 1 })} rel="prev">
              ← Previous
            </Link>
          ) : null}
          <span className="muted">
            Page {shown.page} of {shown.pages}
          </span>
          {shown.page < shown.pages ? (
            <Link href={hrefWith(filters, { page: shown.page + 1 })} rel="next">
              Next →
            </Link>
          ) : null}
        </nav>
      ) : null}
    </main>
  );
}
