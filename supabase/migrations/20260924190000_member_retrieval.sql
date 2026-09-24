-- Retrieval under the user's session (ADR 0011).
--
-- A customer can now ask for insights across their own calls, from the web
-- app, which may never hold the service-role key. So the two service-role-only
-- steps of that path get a member's route:
--
--   match_segments   becomes SECURITY DEFINER, and when there is a signed-in
--                    caller it refuses any company they are not a member of.
--                    The service-role path is unchanged.
--   record_insight   is store_insight for a member: membership-checked, and
--                    every cited signal must belong to the same company, which
--                    the composite key on insight_evidence enforces too.
--
-- The vector table stays unreadable directly; a member reaches it only through
-- match_segments, for their own company, and in code only through retrieve().

create or replace function public.match_segments(
  p_company_id      uuid,
  p_query_embedding extensions.vector(384),
  p_match_count     integer,
  p_min_similarity  double precision
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

revoke all on function public.match_segments(uuid, extensions.vector, integer, double precision)
  from public, anon;
grant execute on function public.match_segments(uuid, extensions.vector, integer, double precision)
  to authenticated, service_role;


create function public.record_insight(
  p_company_id  uuid,
  p_title       text,
  p_summary     text,
  p_synthesiser text,
  p_model       text,
  p_signal_ids  uuid[]
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_insight_id uuid;
begin
  if p_company_id is null then
    raise exception 'record_insight: p_company_id is required' using errcode = '22023';
  end if;

  if not (select private.is_company_member(p_company_id)) then
    raise exception 'record_insight: not a member of that company' using errcode = '42501';
  end if;

  if p_signal_ids is null or array_length(p_signal_ids, 1) is null then
    raise exception 'record_insight: an insight needs at least one signal' using errcode = '23514';
  end if;

  -- Checked here as well as by the composite key, so the refusal says what
  -- was wrong instead of arriving as a foreign-key violation.
  if exists (
    -- Named, not a bare `id`: inside the subquery a bare `id` resolves to
    -- s.id, the check compares a column with itself, and nothing is refused.
    select 1 from unnest(p_signal_ids) as cited(signal_id)
    where not exists (
      select 1 from public.signals s
      where s.id = cited.signal_id and s.company_id = p_company_id
    )
  ) then
    raise exception 'record_insight: every signal must belong to this company' using errcode = '42501';
  end if;

  insert into public.insights (company_id, title, summary, synthesiser, model)
  values (p_company_id, trim(p_title), trim(p_summary), p_synthesiser, p_model)
  returning id into v_insight_id;

  insert into public.insight_evidence (company_id, insight_id, signal_id)
  select p_company_id, v_insight_id, unnest(p_signal_ids);

  return v_insight_id;
end;
$$;

revoke all on function public.record_insight(uuid, text, text, text, text, uuid[]) from public, anon;
grant execute on function public.record_insight(uuid, text, text, text, text, uuid[])
  to authenticated, service_role;
