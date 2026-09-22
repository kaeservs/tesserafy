-- Finding a sentence somebody said.
--
-- The product could answer "how did that call go" and "what do these calls
-- say together", and not "who mentioned the audit". A transcript you cannot
-- search is an archive, and the evidence chain this product is built on is
-- worth very little if reaching a quote means remembering which call it was
-- in.
--
-- ---------------------------------------------------------------------------
-- Why this is RLS and retrieval is not
-- ---------------------------------------------------------------------------
-- ADR 0004 put every vector query behind one function because the AI pipeline
-- runs with a service-role key: RLS is not in its path, so the function is
-- the only control there is.
--
-- This is the opposite case and gets the opposite treatment. Search runs as
-- the signed-in user, where "members read their company's segments" already
-- applies to every row considered, so the database does the tenant scoping
-- and no code has to remember to. A SECURITY DEFINER function here would
-- take that protection away and hand it back to a WHERE clause somebody has
-- to keep writing correctly.
--
-- Lexical, not semantic, and deliberately. Semantic search needs the query
-- embedded, the embedder is a model on an operator's machine, and a web
-- request cannot reach it. "Find the word they used" is also a different and
-- more honest question than "find something like this" when the answer is
-- going to be quoted back to a customer.

alter table public.segments
  add column search tsvector
    generated always as (to_tsvector('english'::regconfig, text)) stored;

comment on column public.segments.search is
  'Lexical search vector over the segment text. Generated, so it can never disagree with the words it indexes.';

-- GIN rather than GiST: the table is written once per call and read for every
-- search, which is the trade GIN is built for.
create index segments_search_idx on public.segments using gin (search);


-- ---------------------------------------------------------------------------
-- The query
-- ---------------------------------------------------------------------------
-- SECURITY INVOKER, which is the whole point: the caller's own RLS decides
-- what is searched. A function here that ran as its definer would be a way
-- around the policy rather than a use of it.
--
-- websearch_to_tsquery rather than plainto_tsquery, so quoted phrases and OR
-- work the way anybody who has used a search box expects, and a stray
-- character is ignored instead of raising a syntax error at somebody who was
-- only typing.

create function public.search_segments(p_query text, p_limit integer default 50)
returns table (
  segment_id      uuid,
  conversation_id uuid,
  speaker         text,
  start_ms        integer,
  segment_text    text,
  headline        text,
  rank            real
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    s.id,
    s.conversation_id,
    s.speaker,
    s.start_ms,
    s.text,
    -- Control characters as delimiters, so the caller can split on them and
    -- render real elements. ts_headline's default markup would have to be
    -- injected as HTML, and transcript text is the last thing in this product
    -- that should ever reach a page unescaped.
    ts_headline(
      'english'::regconfig,
      s.text,
      websearch_to_tsquery('english'::regconfig, p_query),
      'StartSel=[[hl]], StopSel=[[/hl]], MaxFragments=0, HighlightAll=true'
    ),
    ts_rank(s.search, websearch_to_tsquery('english'::regconfig, p_query))
  from public.segments s
  where s.search @@ websearch_to_tsquery('english'::regconfig, p_query)
  order by
    ts_rank(s.search, websearch_to_tsquery('english'::regconfig, p_query)) desc,
    s.start_ms
  limit least(greatest(p_limit, 1), 200);
$$;

comment on function public.search_segments(text, integer) is
  'Lexical search over segments the caller may read. Security invoker on purpose: RLS does the tenant scoping.';

revoke all on function public.search_segments(text, integer) from public, anon;
grant execute on function public.search_segments(text, integer) to authenticated, service_role;
