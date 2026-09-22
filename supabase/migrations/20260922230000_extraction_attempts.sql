-- "Found nothing" is a finished state.
--
-- conversation_pipeline() reported a conversation with no signals as still
-- needing extraction, which was the best it could do and is wrong half the
-- time. Two of the ten conversations in production were flagged that way; the
-- pass was run against both and stored nothing, because there genuinely was
-- nothing in them a detector could evidence. One is a check-in where the
-- customer says everything is fine.
--
-- Left alone they stay flagged for ever and re-extract on every run — Opus,
-- repeatedly, to reconfirm a zero.
--
-- The fact that settles it already exists. model_usage records one row per
-- model call with the conversation it ran against, so "extraction has been
-- attempted" is a t3 row for that conversation. Nothing new is stored: the
-- telemetry that was added because it cannot be backfilled is now load
-- bearing for something other than cost, which is the argument for having
-- added it.
--
-- It only answers for conversations processed after 2026-09-21, when
-- model_usage shipped. Anything older reads as never attempted, which is the
-- safe direction to be wrong in: it costs one extraction to find out.

-- Dropped rather than replaced: `create or replace` refuses to change a
-- function's return type (42P13), and this adds a column. Dropping takes the
-- grants with it, so they are restated at the end.
drop function if exists public.conversation_pipeline(uuid);

create function public.conversation_pipeline(p_company_id uuid default null)
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
    -- Tier, not detector: a detector version bump must not make every
    -- conversation look unextracted again.
    (select count(*)::integer
       from public.model_usage u
      where u.conversation_id = c.id and u.tier = 't3')
  from public.conversations c
  where c.company_id = v_company_id;
end;
$$;

comment on function public.conversation_pipeline(uuid) is
  'Per-conversation counts for each pipeline stage, including how many times extraction has run. Counts only — a caller learns whether a call is searchable, never what it contains.';

revoke all on function public.conversation_pipeline(uuid) from public, anon;
grant execute on function public.conversation_pipeline(uuid) to authenticated, service_role;
