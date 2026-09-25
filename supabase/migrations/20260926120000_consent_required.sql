-- Recording consent, required.
--
-- 20260926090000 recorded the statement when one was sent and left it
-- optional, because the app deployed at the time sent none and refusing it
-- would have broken every upload until the deploy. That deploy is out: both
-- routes now refuse an unconfirmed call and send the server's wording, and
-- production qa witnessed both refusals before this was written. The last
-- thing that could create an unconfirmed call is a hand-made request straight
-- to PostgREST, and this closes it.
--
-- Unconditionally. Both functions already refuse anyone who is not a signed-in
-- member of the company (is_company_member reads auth.uid()), so every caller
-- that gets this far is a person, and a person can tick a box. Operators never
-- came through here: `pnpm ingest` writes the tables directly with the service
-- role and records no consent, which the conversation page states as "no
-- recording consent on file".
--
-- Membership is still checked first, so someone outside the company learns
-- that they are not a member, not what the company's calls require.

create or replace function public.import_conversation(
  p_title             text,
  p_segments          jsonb,
  p_occurred_at       timestamptz default null,
  p_engagement_type   text        default 'discovery',
  p_criteria_version  integer     default 1,
  p_company_id        uuid        default null,
  p_consent_statement text        default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company_id uuid;
  v_id         uuid;
  v_count      integer;
  v_statement  text := nullif(trim(coalesce(p_consent_statement, '')), '');
begin
  v_company_id := coalesce(p_company_id, private.sole_company_of_caller());

  if not (select private.is_company_member(v_company_id)) then
    raise exception 'import_conversation: not a member of that company'
      using errcode = '42501';
  end if;
  if p_title is null or length(trim(p_title)) = 0 then
    raise exception 'import_conversation: a title is required' using errcode = '22023';
  end if;
  if v_statement is null then
    raise exception 'import_conversation: confirm that everyone on the call agreed to be recorded'
      using errcode = '22023';
  end if;
  if p_segments is null or jsonb_typeof(p_segments) <> 'array'
     or jsonb_array_length(p_segments) = 0 then
    raise exception 'import_conversation: a transcript needs at least one segment'
      using errcode = '22023';
  end if;

  if jsonb_array_length(p_segments) > 5000 then
    raise exception 'import_conversation: % segments is more than a transcript',
      jsonb_array_length(p_segments)
      using errcode = '22023';
  end if;

  insert into public.conversations
    (company_id, title, occurred_at, engagement_type, criteria_version,
     consent_statement, consent_confirmed_by, consent_confirmed_at)
  values
    (v_company_id, trim(p_title), p_occurred_at, p_engagement_type, p_criteria_version,
     v_statement,
     case when v_statement is not null then auth.uid() end,
     case when v_statement is not null then now() end)
  returning id into v_id;

  insert into public.segments
    (company_id, conversation_id, speaker, start_ms, end_ms, text)
  select
    v_company_id,
    v_id,
    nullif(trim(coalesce(s->>'speaker', '')), ''),
    greatest((s->>'startMs')::integer, 0),
    greatest((s->>'endMs')::integer, (s->>'startMs')::integer),
    s->>'text'
  from jsonb_array_elements(p_segments) as s
  where length(trim(coalesce(s->>'text', ''))) > 0;

  get diagnostics v_count = row_count;
  if v_count = 0 then
    raise exception 'import_conversation: every segment was empty' using errcode = '22023';
  end if;

  return v_id;
end;
$$;


create or replace function public.start_live_conversation(
  p_title             text,
  p_engagement_type   text    default 'discovery',
  p_criteria_version  integer default 1,
  p_company_id        uuid    default null,
  p_consent_statement text    default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company_id uuid;
  v_id         uuid;
  v_statement  text := nullif(trim(coalesce(p_consent_statement, '')), '');
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
  if v_statement is null then
    raise exception 'start_live_conversation: confirm that everyone on the call agreed to be recorded'
      using errcode = '22023';
  end if;

  -- occurred_at is now: a live call is happening, which is the one case where
  -- the product knows when a conversation took place without being told.
  -- source_key stays null — nothing was imported, so there is nothing to
  -- de-duplicate against.
  insert into public.conversations
    (company_id, title, occurred_at, engagement_type, criteria_version,
     consent_statement, consent_confirmed_by, consent_confirmed_at)
  values
    (v_company_id, trim(p_title), now(), p_engagement_type, p_criteria_version,
     v_statement,
     case when v_statement is not null then auth.uid() end,
     case when v_statement is not null then now() end)
  returning id into v_id;

  return v_id;
end;
$$;
