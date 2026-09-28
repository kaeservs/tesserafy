-- "This score is wrong": a person's correction, as evidence.
--
-- A seller could not dispute a criterion, so a detector that missed a moment,
-- or claimed one that was not there, left a score nobody believed. The fix
-- must not break the invariants that make the score worth having:
--
--   1. The score comes from the engine, never from a typed number.
--   2. A confirmed criterion is unseated only by an explicit, recorded
--      contradiction.
--   5. Every claim rests on a quoted span.
--
-- So a correction is evidence, from a person instead of a detector:
--   "it was met"     → an evidence event on the words they point at, at
--                      confidence 1, which confirms it;
--   "it wasn't met"  → a contradiction event on the claimed words, which is
--                      exactly what invariant 2 allows to unseat it.
-- The engine then scores the call as it always does. The detector's own
-- evidence stays beside it, the correction says who and why, and every
-- correction is a labelled example for measuring the detector.
--
-- A correction is made by the same people who may correct the call — its
-- company's owner or whoever added it — and withdrawn by its author or an
-- owner. detector = 'person' marks it; only dispute_criterion writes one, with
-- a reason, and a check refuses a 'person' row without one, so a client cannot
-- pass a detector's claim off as a person's through record_criterion_events.

alter table public.criterion_events
  add column reason      text check (reason is null or length(trim(reason)) between 3 and 500),
  add column recorded_by uuid references auth.users (id) on delete set null,
  add column by_person   boolean generated always as (detector = 'person') stored,
  add constraint criterion_events_person_has_reason check ((detector = 'person') = (reason is not null));

-- A person's correction on the same words the model quoted is a second
-- observation, not a duplicate: one of each may exist.
do $$
declare
  v_name text;
begin
  select c.conname into v_name
    from pg_constraint c
   where c.conrelid = 'public.criterion_events'::regclass and c.contype = 'u';
  execute format('alter table public.criterion_events drop constraint %I', v_name);
end;
$$;

alter table public.criterion_events add constraint criterion_events_one_observation
  unique (conversation_id, criterion_key, kind, segment_id, quote_start, quote_end, by_person);


create function public.dispute_criterion(
  p_conversation_id uuid,
  p_criterion_key   text,
  p_kind            text,
  p_segment_id      uuid,
  p_quote           text,
  p_reason          text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row     public.conversations;
  v_text    text;
  v_offset  integer;
  v_quote   text := trim(coalesce(p_quote, ''));
  v_reason  text := trim(coalesce(p_reason, ''));
  v_id      uuid;
begin
  select * into v_row from public.conversations c where c.id = p_conversation_id;
  if v_row.id is null or not (select private.is_company_member(v_row.company_id)) then
    raise exception 'dispute_criterion: call not found' using errcode = 'P0002';
  end if;
  if not private.may_edit_conversation(v_row.company_id, v_row.added_by) then
    raise exception 'dispute_criterion: only an owner, or whoever added the call, can correct its score'
      using errcode = '42501';
  end if;
  if p_kind not in ('evidence', 'contradiction') then
    raise exception 'dispute_criterion: a correction says it was met, or that it was not' using errcode = '22023';
  end if;
  if length(v_reason) not between 3 and 500 then
    raise exception 'dispute_criterion: say why, in a few words' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.criteria_definitions d
     where d.engagement_type = v_row.engagement_type
       and d.version = v_row.criteria_version
       and d.key = p_criterion_key
       and (d.company_id is null or d.company_id = v_row.company_id)
  ) then
    raise exception 'dispute_criterion: that is not a criterion of this call''s scorecard' using errcode = '22023';
  end if;

  -- The words must be in the moment pointed at: a correction is evidence too.
  select s.text into v_text
    from public.segments s
   where s.id = p_segment_id and s.conversation_id = v_row.id and s.company_id = v_row.company_id;
  if v_text is null then
    raise exception 'dispute_criterion: that moment is not in this call' using errcode = '22023';
  end if;
  v_offset := position(v_quote in v_text);
  if length(v_quote) = 0 or v_offset = 0 then
    raise exception 'dispute_criterion: quote the words as they appear in that moment' using errcode = '22023';
  end if;

  insert into public.criterion_events
    (company_id, conversation_id, criterion_key, kind, confidence, segment_id, quote, quote_start, quote_end,
     detector, model, reason, recorded_by)
  values
    (v_row.company_id, v_row.id, p_criterion_key, p_kind, 1, p_segment_id, v_quote, v_offset - 1,
     v_offset - 1 + length(v_quote), 'person', 'person', v_reason, (select auth.uid()))
  returning id into v_id;
  return v_id;
exception
  when unique_violation then
    raise exception 'dispute_criterion: that correction is already recorded' using errcode = '23505';
end;
$$;

-- Its author, or an owner, takes it back. Only a person's correction: a
-- detector's evidence is not withdrawn by hand.
create function public.withdraw_dispute(p_event_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.criterion_events e
   where e.id = p_event_id
     and e.detector = 'person'
     and (e.recorded_by = (select auth.uid())
          or exists (select 1 from public.company_members m
                      where m.company_id = e.company_id
                        and m.user_id = (select auth.uid())
                        and m.role = 'owner'));
  if not found then
    raise exception 'withdraw_dispute: only whoever made a correction, or an owner, can withdraw it' using errcode = '42501';
  end if;
end;
$$;

revoke all on function public.dispute_criterion(uuid, text, text, uuid, text, text) from public, anon;
revoke all on function public.withdraw_dispute(uuid) from public, anon;
grant execute on function public.dispute_criterion(uuid, text, text, uuid, text, text) to authenticated;
grant execute on function public.withdraw_dispute(uuid) to authenticated;
