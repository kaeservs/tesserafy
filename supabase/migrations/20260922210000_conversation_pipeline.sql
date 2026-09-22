-- Where a conversation has got to.
--
-- A call goes through three stages, and until now the product showed one of
-- them. Imported transcripts arrive with all three done at once, so nothing
-- made the difference visible; a live-captured call does not, and looks
-- identical to a finished one except for a score that happens to be lower.
--
--   captured    segments exist
--   scored      criterion_events exist  (pnpm score)
--   extracted   signals exist           (pnpm process)
--   searchable  embeddings exist        (pnpm process)
--
-- The last of those is the reason this is a function rather than a query in
-- the page. ADR 0004's guard forbids anything outside packages/ai/src/retrieval
-- from naming the embeddings table, and it is right to: a page that could
-- query it is a page that could query it wrongly. Naming it here, in SQL that
-- the guard permits, lets a page ask "is this searchable" without ever being
-- able to ask "what does it contain".
--
-- SECURITY DEFINER for the same reason. segment_embeddings has no select
-- policy for a signed-in user at all, so a security invoker function would
-- fail on permissions rather than answer the question. Membership is checked
-- explicitly instead, which is the trade this file is making: a narrow
-- privileged answer in place of a broad unprivileged one.

create function public.conversation_pipeline(p_company_id uuid default null)
returns table (
  conversation_id uuid,
  segments        integer,
  embedded        integer,
  signals         integer,
  criterion_rows  integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_company_id uuid;
begin
  -- Null means "whichever company I am in", resolved rather than trusted.
  v_company_id := coalesce(p_company_id, private.sole_company_of_caller());

  if (select auth.uid()) is not null
     and not (select private.is_company_member(v_company_id)) then
    raise exception 'conversation_pipeline: not a member of that company'
      using errcode = '42501';
  end if;

  return query
  select
    c.id,
    (select count(*)::integer from public.segments s where s.conversation_id = c.id),
    (select count(*)::integer
       from public.segments s
       join public.segment_embeddings e on e.segment_id = s.id
      where s.conversation_id = c.id),
    (select count(*)::integer from public.signals g where g.conversation_id = c.id),
    (select count(*)::integer from public.criterion_events k where k.conversation_id = c.id)
  from public.conversations c
  where c.company_id = v_company_id;
end;
$$;

comment on function public.conversation_pipeline(uuid) is
  'Per-conversation counts for each pipeline stage. Counts only — a caller learns whether a call is searchable, never what it contains.';

revoke all on function public.conversation_pipeline(uuid) from public, anon;
grant execute on function public.conversation_pipeline(uuid) to authenticated, service_role;
