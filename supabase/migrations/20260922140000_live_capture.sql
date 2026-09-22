-- A live call that survives the tab being closed.
--
-- Until now the live path was memory only: the overlay detected, scored, and
-- lost everything when the window went away. A meeting cannot be re-run, so
-- "we will score it later from the transcript" only works if somebody kept a
-- transcript, and in a live session nobody did.
--
-- Every write in this product has so far been service-role; conversations and
-- segments are read-only to a signed-in user. Live capture has to let a
-- browser write, and the question is how much it is allowed to assert.
--
-- The line drawn here: **a caller may assert what was said. It may not assert
-- that a quote exists, invent a criterion, or write a number.**
--
--   * quote offsets are derived here from the stored segment text, never
--     taken from the request — a paraphrase is refused by the same rule that
--     governs every other quote in the product (invariant 4);
--   * a criterion key is checked against the set the conversation pins, so a
--     client cannot score itself against criteria it made up;
--   * nothing stored is a status or a score, exactly as in the batch path
--     (invariant 1);
--   * membership is re-checked in every function, so one tenant cannot write
--     into another (invariant 3).
--
-- The alternative was an RLS insert policy on these tables. It is simpler and
-- it gives the whole game away: with insert rights a client reaches
-- criterion_events through PostgREST directly and supplies its own offsets,
-- which is precisely what the quote rule exists to prevent. Hence
-- SECURITY DEFINER functions and no insert policy anywhere.

-- ---------------------------------------------------------------------------
-- Which company is the caller writing for
-- ---------------------------------------------------------------------------
-- Most people belong to exactly one. Rather than make the browser discover
-- and send a company id it could get wrong, the common case is resolved here
-- and the ambiguous one is refused loudly.

create function private.sole_company_of_caller()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_company_id uuid;
  v_count      integer;
begin
  select count(*), min(m.company_id)
    into v_count, v_company_id
  from public.company_members m
  where m.user_id = (select auth.uid());

  if v_count = 0 then
    raise exception 'not a member of any company' using errcode = '42501';
  end if;
  if v_count > 1 then
    raise exception 'member of several companies; say which one'
      using errcode = '22023';
  end if;

  return v_company_id;
end;
$$;


-- ---------------------------------------------------------------------------
-- Starting a call
-- ---------------------------------------------------------------------------

create function public.start_live_conversation(
  p_title            text,
  p_engagement_type  text default 'discovery',
  p_criteria_version integer default 1,
  p_company_id       uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company_id uuid;
  v_id         uuid;
begin
  v_company_id := coalesce(p_company_id, private.sole_company_of_caller());

  if not (select private.is_company_member(v_company_id)) then
    raise exception 'start_live_conversation: not a member of that company'
      using errcode = '42501';
  end if;
  if p_title is null or length(trim(p_title)) = 0 then
    raise exception 'start_live_conversation: a title is required'
      using errcode = '22023';
  end if;

  -- occurred_at is now: a live call is happening, which is the one case where
  -- the product knows when a conversation took place without being told.
  -- source_key stays null — nothing was imported, so there is nothing to
  -- de-duplicate against.
  insert into public.conversations
    (company_id, title, occurred_at, engagement_type, criteria_version)
  values
    (v_company_id, trim(p_title), now(), p_engagement_type, p_criteria_version)
  returning id into v_id;

  return v_id;
end;
$$;


-- ---------------------------------------------------------------------------
-- One utterance
-- ---------------------------------------------------------------------------

create function public.append_live_segment(
  p_conversation_id uuid,
  p_speaker         text,
  p_start_ms        integer,
  p_end_ms          integer,
  p_text            text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company_id uuid;
  v_id         uuid;
begin
  select c.company_id into v_company_id
  from public.conversations c
  where c.id = p_conversation_id;

  if v_company_id is null then
    raise exception 'append_live_segment: conversation % not found', p_conversation_id
      using errcode = 'P0002';
  end if;
  if not (select private.is_company_member(v_company_id)) then
    raise exception 'append_live_segment: not a member of that company'
      using errcode = '42501';
  end if;
  if p_text is null or length(trim(p_text)) = 0 then
    raise exception 'append_live_segment: empty utterance' using errcode = '22023';
  end if;

  insert into public.segments
    (company_id, conversation_id, speaker, start_ms, end_ms, text)
  values
    (v_company_id, p_conversation_id, p_speaker, p_start_ms, greatest(p_end_ms, p_start_ms), p_text)
  returning id into v_id;

  return v_id;
end;
$$;


-- ---------------------------------------------------------------------------
-- The evidence behind the live score
-- ---------------------------------------------------------------------------
-- The heart of this migration. Everything a caller sends is treated as a
-- claim about a segment the database already holds, and checked against it.

create function public.record_criterion_events(
  p_conversation_id uuid,
  p_events          jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company_id       uuid;
  v_engagement_type  text;
  v_criteria_version integer;
  v_event            jsonb;
  v_segment_text     text;
  v_offset           integer;
  v_quote            text;
  v_kind             text;
  v_recorded         integer := 0;
  v_rejected         integer := 0;
begin
  select c.company_id, c.engagement_type, c.criteria_version
    into v_company_id, v_engagement_type, v_criteria_version
  from public.conversations c
  where c.id = p_conversation_id;

  if v_company_id is null then
    raise exception 'record_criterion_events: conversation % not found', p_conversation_id
      using errcode = 'P0002';
  end if;
  if not (select private.is_company_member(v_company_id)) then
    raise exception 'record_criterion_events: not a member of that company'
      using errcode = '42501';
  end if;
  if p_events is null or jsonb_typeof(p_events) <> 'array' then
    raise exception 'record_criterion_events: p_events must be an array'
      using errcode = '22023';
  end if;

  for v_event in select * from jsonb_array_elements(p_events)
  loop
    v_quote := v_event->>'quote';
    v_kind  := coalesce(v_event->>'kind', 'evidence');

    -- The segment must belong to this conversation. Without this a caller
    -- could hang evidence for one call off a segment from another.
    select s.text into v_segment_text
    from public.segments s
    where s.id = (v_event->>'segment_id')::uuid
      and s.conversation_id = p_conversation_id
      and s.company_id = v_company_id;

    if v_segment_text is null
       or v_quote is null
       or length(trim(v_quote)) = 0
       or v_kind not in ('evidence', 'contradiction')
       -- A criterion the conversation is not scored against would be a
       -- criterion the caller invented.
       or not exists (
         select 1 from public.criteria_definitions d
         where d.engagement_type = v_engagement_type
           and d.version = v_criteria_version
           and d.key = v_event->>'criterion_key'
       )
    then
      v_rejected := v_rejected + 1;
      continue;
    end if;

    -- Derived, never accepted. position() returns 0 when the quote is not in
    -- the segment, which is how a paraphrase gets refused rather than stored
    -- with offsets that happen to be in range.
    v_offset := position(v_quote in v_segment_text);
    if v_offset = 0 then
      v_rejected := v_rejected + 1;
      continue;
    end if;

    insert into public.criterion_events
      (company_id, conversation_id, criterion_key, kind, confidence,
       segment_id, quote, quote_start, quote_end, detector, model)
    values
      (v_company_id, p_conversation_id, v_event->>'criterion_key', v_kind,
       least(greatest((v_event->>'confidence')::double precision, 0), 1),
       (v_event->>'segment_id')::uuid, v_quote, v_offset - 1,
       v_offset - 1 + length(v_quote),
       coalesce(v_event->>'detector', 'unknown'),
       coalesce(v_event->>'model', 'unknown'))
    on conflict do nothing;

    -- Overlapping windows re-observe the same span, so a conflict is the
    -- expected case rather than a failure worth reporting.
    if found then
      v_recorded := v_recorded + 1;
    end if;
  end loop;

  return jsonb_build_object('recorded', v_recorded, 'rejected', v_rejected);
end;
$$;


-- ---------------------------------------------------------------------------
-- Who may call these
-- ---------------------------------------------------------------------------
-- authenticated, because the whole point is that a browser in a live call can
-- write. anon cannot: an unauthenticated caller has no membership and would
-- fail the check anyway, and saying so here makes that explicit rather than
-- incidental.

revoke all on function private.sole_company_of_caller() from public, anon;
grant execute on function private.sole_company_of_caller() to authenticated, service_role;

revoke all on function public.start_live_conversation(text, text, integer, uuid) from public, anon;
grant execute on function public.start_live_conversation(text, text, integer, uuid)
  to authenticated, service_role;

revoke all on function public.append_live_segment(uuid, text, integer, integer, text)
  from public, anon;
grant execute on function public.append_live_segment(uuid, text, integer, integer, text)
  to authenticated, service_role;

revoke all on function public.record_criterion_events(uuid, jsonb) from public, anon;
grant execute on function public.record_criterion_events(uuid, jsonb)
  to authenticated, service_role;
