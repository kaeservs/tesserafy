-- Fixes from reading the whole project through (2026-10-14).
--
--   1. "Find insights in this call" disappeared from any call whose action
--      items or follow-up had been drafted. conversation_pipeline counted
--      every T3 row on a call as an extraction run, and action items and the
--      follow-up are T3 too, so the call read as "extracted, found nothing"
--      and the button was hidden. Only the extractor's own rows count now.

-- 1 ---------------------------------------------------------------------------

create or replace function public.conversation_pipeline(p_company_id uuid default null)
returns table (
  conversation_id  uuid,
  segments         integer,
  embedded         integer,
  signals          integer,
  criterion_rows   integer,
  extraction_runs  integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_company_id uuid;
begin
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
    (select count(*)::integer from public.criterion_events k where k.conversation_id = c.id),
    -- The extractor's family, not its version: a version bump must not make
    -- every conversation look unextracted again, and the other T3 work on a
    -- call (action items, the follow-up) is not extraction. A row with no
    -- detector is from before detectors were recorded, and counts as it did.
    (select count(*)::integer
       from public.model_usage u
      where u.conversation_id = c.id and u.tier = 't3'
        and (u.detector is null or u.detector like 't3-extract@%'))
  from public.conversations c
  where c.company_id = v_company_id;
end;
$$;
