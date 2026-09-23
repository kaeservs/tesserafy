import Link from 'next/link';
import { clock, splitHeadline } from '@/lib/highlight';
import { createClient } from '@/lib/supabase/server';

/**
 * Finding a sentence somebody said.
 *
 * The product could answer "how did that call go" and "what do these calls
 * say together", and not "who mentioned the audit". A transcript you cannot
 * search is an archive, and an evidence chain is worth very little if
 * reaching a quote means remembering which call it was in.
 *
 * No company filter in this query, on purpose, and more deliberately here
 * than anywhere else: `search_segments` is SECURITY INVOKER, so the same RLS
 * policy that governs the transcript governs every row it considers. The
 * tenant scoping is the database's, not this page's.
 *
 * Lexical rather than semantic. Semantic search needs the query embedded and
 * the embedder is a model on an operator's machine that a web request cannot
 * reach — and "find the word they used" is the more honest question anyway,
 * when the answer is going to be quoted back to a customer.
 */

interface Hit {
  segment_id: string;
  conversation_id: string;
  speaker: string | null;
  start_ms: number;
  segment_text: string;
  headline: string;
  rank: number;
}

const LIMIT = 50;

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const query = (q ?? '').trim();
  const supabase = await createClient();

  let hits: Hit[] = [];
  let failed: string | null = null;

  if (query.length > 0) {
    const { data, error } = await supabase.rpc('search_segments', {
      p_query: query,
      p_limit: LIMIT,
    });
    if (error) failed = error.message;
    else hits = (data ?? []) as Hit[];
  }

  // Titles in a second query: segments reach conversations through a
  // composite (company_id, id) key, which PostgREST cannot resolve into an
  // embed.
  const conversationIds = [...new Set(hits.map((hit) => hit.conversation_id))];
  const titles = new Map<string, string>();
  if (conversationIds.length > 0) {
    const { data } = await supabase
      .from('conversations')
      .select('id, title')
      .in('id', conversationIds);
    for (const row of (data ?? [])) {
      titles.set(row.id, row.title);
    }
  }

  return (
    <main>
      <h1>Search</h1>

      <form method="get" className="toolbar" role="search">
        <input
          type="search"
          name="q"
          defaultValue={query}
          placeholder="audit, &quot;manual export&quot;, spreadsheets"
          aria-label="Search transcripts"
          className="grow"
          autoFocus
        />
        <button type="submit">Search</button>
      </form>
      <p className="muted" style={{ fontSize: '0.85rem' }}>
        Words as they were said, across every transcript you can see. Quoted phrases and{' '}
        <code>or</code> work.
      </p>

      {failed && <p role="alert">Search failed: {failed}</p>}

      {query.length > 0 && !failed && (
        <p className="muted">
          {hits.length === 0
            ? 'Nothing matched.'
            : `${hits.length}${hits.length === LIMIT ? '+' : ''} matching utterance${
                hits.length === 1 ? '' : 's'
              } in ${conversationIds.length} conversation${conversationIds.length === 1 ? '' : 's'}.`}
        </p>
      )}

      <ul className="signals">
        {hits.map((hit) => (
          <li key={hit.segment_id} className="signal">
            <div className="muted segment-meta">
              <Link href={`/conversations/${hit.conversation_id}`}>
                {titles.get(hit.conversation_id) ?? 'Unknown conversation'}
              </Link>{' '}
              · {clock(hit.start_ms)} · {hit.speaker ?? 'unknown'}
            </div>
            {/* The link goes to the words, not to the call: landing on the
                transcript at the exact utterance is the whole point of
                searching rather than scrolling. */}
            <p>
              <a
                href={`/conversations/${hit.conversation_id}#segment-${hit.segment_id}`}
                className="meeting-title"
              >
                {splitHeadline(hit.headline).map((piece, index) =>
                  piece.highlighted ? (
                    <mark key={index}>{piece.text}</mark>
                  ) : (
                    <span key={index}>{piece.text}</span>
                  ),
                )}
              </a>
            </p>
          </li>
        ))}
      </ul>
    </main>
  );
}
