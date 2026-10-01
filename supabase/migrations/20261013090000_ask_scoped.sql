-- "Ask your calls", scoped (ADR 0018): only one account's calls, or only the
-- last so many days. Both searches the agent runs take an optional list of
-- calls. Without one they are unchanged.
--
--   match_segments   with calls named, searches exactly over just their lines
--                    (see below); the company check and the member check are
--                    unchanged, and retrieve() still checks every row.
--   search_segments  still SECURITY INVOKER: RLS decides what it considers,
--                    and the list only narrows that.
--
-- A new argument is a new signature, so each is dropped and created again
-- with the same grants rather than left beside an overload PostgREST could
-- not choose between.

drop function public.match_segments(uuid, extensions.vector, integer, double precision);
drop function public.search_segments(text, integer);

create function public.match_segments(
  p_company_id      uuid,
  p_query_embedding extensions.vector(384),
  p_match_count     integer,
  p_min_similarity  double precision,
  p_conversation_ids uuid[] default null
)
returns table (
  segment_id       uuid,
  company_id       uuid,
  conversation_id  uuid,
  speaker          text,
  start_ms         integer,
  end_ms           integer,
  text             text,
  similarity       double precision
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  if p_company_id is null then
    raise exception 'match_segments: p_company_id is required';
  end if;
  -- ADR 0011. A signed-in caller may search their own company and no other.
  -- With no caller — the service role, from operator scripts — nothing
  -- changes: retrieve() remains the control on that path, as ADR 0004 says.
  if (select auth.uid()) is not null
     and not (select private.is_company_member(p_company_id)) then
    raise exception 'match_segments: not a member of that company'
      using errcode = '42501';
  end if;
  if p_match_count is null or p_match_count < 1 or p_match_count > 100 then
    raise exception 'match_segments: p_match_count must be between 1 and 100';
  end if;

  -- Scoped to some calls ("only Acme's", "the last 30 days"): an exact search
  -- over just their lines. Filtering the nearest rows the index returns would
  -- drop rows after the limit, and a narrow scope would come back empty.
  if p_conversation_ids is not null then
    if cardinality(p_conversation_ids) > 2000 then
      raise exception 'match_segments: at most 2000 calls at once' using errcode = '22023';
    end if;
    return query
    with scoped as materialized (
      select s.id, s.company_id, s.conversation_id, s.speaker, s.start_ms, s.end_ms, s.text,
             1 - (e.embedding operator(extensions.<=>) p_query_embedding) as similarity
      from public.segments s
      join public.segment_embeddings e
        on e.company_id = s.company_id
       and e.segment_id = s.id
      where s.company_id = p_company_id
        and s.conversation_id = any(p_conversation_ids)
    )
    select scoped.id, scoped.company_id, scoped.conversation_id, scoped.speaker, scoped.start_ms,
           scoped.end_ms, scoped.text, scoped.similarity
    from scoped
    where scoped.similarity >= p_min_similarity
    order by scoped.similarity desc
    limit p_match_count;
    return;
  end if;

  return query
  select
    s.id,
    s.company_id,
    s.conversation_id,
    s.speaker,
    s.start_ms,
    s.end_ms,
    s.text,
    1 - (e.embedding operator(extensions.<=>) p_query_embedding)
  from public.segment_embeddings e
  join public.segments s
    on s.company_id = e.company_id
   and s.id = e.segment_id
  where e.company_id = p_company_id
    and 1 - (e.embedding operator(extensions.<=>) p_query_embedding) >= p_min_similarity
  order by e.embedding operator(extensions.<=>) p_query_embedding
  limit p_match_count;
end;
$$;

create function public.search_segments(p_query text, p_limit integer default 50, p_conversation_ids uuid[] default null)
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
    and (p_conversation_ids is null or s.conversation_id = any(p_conversation_ids))
  order by
    ts_rank(s.search, websearch_to_tsquery('english'::regconfig, p_query)) desc,
    s.start_ms
  limit least(greatest(p_limit, 1), 200);
$$;

revoke all on function public.match_segments(uuid, extensions.vector, integer, double precision, uuid[])
  from public, anon;
grant execute on function public.match_segments(uuid, extensions.vector, integer, double precision, uuid[])
  to authenticated, service_role;

comment on function public.search_segments(text, integer, uuid[]) is
  'Lexical search over segments the caller may read, optionally only some calls. Security invoker on purpose: RLS does the tenant scoping.';
revoke all on function public.search_segments(text, integer, uuid[]) from public, anon;
grant execute on function public.search_segments(text, integer, uuid[]) to authenticated, service_role;
