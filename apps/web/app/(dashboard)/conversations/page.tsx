import { engagementLabel, myCompanyId } from '@/lib/company';
import Link from 'next/link';
import { GettingStarted } from '@/components/getting-started';
import { ScorecardStrip } from '@/components/scorecard-strip';
import { conversationPipeline, stageOf } from '@/lib/pipeline';
import { scoreConversations } from '@/lib/scorecard';
import { fetchCriteriaSets, readAll } from '@tesserafy/db';
import {
  applyFilters,
  BANDS,
  hrefWith,
  OUTCOMES,
  isFiltered,
  likePattern,
  PAGE_SIZE,
  parseFilters,
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

interface ConversationRow {
  id: string;
  company_id: string;
  title: string;
  occurred_at: string | null;
  created_at: string;
  added_by: string | null;
  outcome: string | null;
  engagement_type: string;
  criteria_version: number;
}

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
  const [{ data: membership }, { data: team }, sets, { count: everything }] = await Promise.all([
    supabase.from('company_members').select('role').eq('user_id', user?.id ?? '').limit(1).maybeSingle(),
    supabase.rpc('company_team'),
    myCompanyId(supabase, user?.id).then((companyId) => fetchCriteriaSets(supabase, companyId)),
    supabase.from('conversations').select('id', { count: 'exact', head: true }),
  ]);
  const isOwner = membership?.role === 'owner';

  const asked = parseFilters(params);
  // A member's seller filter is themselves or nothing.
  const filters =
    asked.seller && asked.seller !== 'mine' && !isOwner ? { ...asked, seller: 'mine' } : asked;
  const sellerId = filters.seller === 'mine' ? (user?.id ?? '') : filters.seller;

  // Every call that passes the stored-column filters, not the first thousand.
  // See readAll.
  const conversations = await readAll<ConversationRow>((from, to) => {
    let query = supabase
      .from('conversations')
      .select('id, company_id, title, occurred_at, created_at, added_by, outcome, engagement_type, criteria_version');
    if (filters.q) query = query.ilike('title', likePattern(filters.q));
    if (sellerId) query = query.eq('added_by', sellerId);
    if (filters.type) query = query.eq('engagement_type', filters.type);
    if (filters.outcome === 'none') query = query.is('outcome', null);
    else if (filters.outcome) query = query.eq('outcome', filters.outcome);
    return query.order('occurred_at', { ascending: false }).order('id').range(from, to);
  }, 'Could not load conversations');
  const [scores, pipeline] = await Promise.all([
    scoreConversations(supabase, conversations),
    conversationPipeline(supabase),
  ]);

  const scored = conversations.map((conversation) => {
    const card = scores.get(conversation.id);
    const observed = card?.scorecard.criteria.some((c) => c.status !== 'unobserved') ?? false;
    return { ...conversation, card, score: card && observed ? card.scorecard.score : null };
  });
  const shown = applyFilters(scored, filters);
  const filtered = isFiltered(filters);
  const emailOf = new Map((team ?? []).map((person) => [person.user_id, person.email]));
  const types = [...new Set(sets.map((set) => set.engagementType))];
  const total = everything ?? conversations.length;

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
          <GettingStarted />
        </div>
      ) : (
        <ul className="meetings" style={{ marginTop: '1.5rem' }}>
          {shown.items.map((conversation) => {
            const card = conversation.card;
            const observed = conversation.score !== null;
            const stage = stageOf(pipeline.get(conversation.id));

            return (
              <li key={conversation.id} className="meeting">
                <Link href={`/conversations/${conversation.id}`} className="meeting-title">
                  {conversation.title}
                </Link>
                <span className="meeting-meta">
                  {when(conversation.occurred_at)} · {engagementLabel(conversation.engagement_type)}
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
