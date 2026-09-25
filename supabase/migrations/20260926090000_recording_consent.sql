-- Recording consent: who confirmed it, when, and the words they confirmed.
--
-- Nothing recorded that the people on a call agreed to be recorded. In a
-- two-party-consent jurisdiction that is the first question asked of a
-- recording, and "the product never asked" is not an answer a customer can
-- give. The data-protection note listed it as open.
--
-- One strict statement for everyone, not a model of jurisdictions: "everyone
-- on this call was told and agreed" satisfies the strictest rule, and a
-- product that guessed which rule applied would be guessing about a law.
--
-- What is recorded, and where each part comes from:
--   consent_statement     the words confirmed, verbatim. The server chooses
--                         them; storing them means rewording the product later
--                         does not change what an earlier call agreed to.
--   consent_confirmed_by  auth.uid(), taken inside the function. A caller can
--                         assert that consent was given, never who gave it.
--   consent_confirmed_at  now(), the database's clock, for the same reason.
--
-- Recorded, not yet required. The app deployed today calls these functions
-- without a statement, and refusing it here would break every upload between
-- this migration and the deploy that sends one. The app requires it from this
-- change on; a following migration makes the database refuse a signed-in
-- caller without it, once no deployed client is left that omits it.
--
-- Existing conversations keep null: they predate the question, and the
-- product says so rather than implying an answer.

alter table public.conversations
  add column consent_statement    text,
  add column consent_confirmed_by uuid references auth.users (id) on delete set null,
  add column consent_confirmed_at timestamptz,
  -- A statement without a time, or a time without a statement, is not a
  -- record of anything. The person may later be deleted; the record stays.
  add constraint conversations_consent_complete
    check ((consent_statement is null) = (consent_confirmed_at is null));

comment on column public.conversations.consent_statement is
  'The recording-consent statement confirmed for this call, verbatim. Null: never asked (predates the question, or imported by an operator without one).';


-- ---------------------------------------------------------------------------
-- The two front doors take the statement. Adding an argument changes the
-- signature, and a second overload would leave PostgREST choosing between
-- them, so each is dropped and created again with the argument last and
-- defaulted — which is what lets the deployed app keep calling it unchanged.
-- ---------------------------------------------------------------------------

drop function public.import_conversation(text, jsonb, timestamptz, text, integer, uuid);

create function public.import_conversation(
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

comment on function public.import_conversation(text, jsonb, timestamptz, text, integer, uuid, text) is
  'Writes a parsed transcript as a conversation and its segments, with no embeddings. Reachable by a member: the front door for the post-call MVP. Records the consent statement confirmed, with the caller and the time taken here.';

revoke all on function public.import_conversation(text, jsonb, timestamptz, text, integer, uuid, text)
  from public, anon;
grant execute on function public.import_conversation(text, jsonb, timestamptz, text, integer, uuid, text)
  to authenticated, service_role;


drop function public.start_live_conversation(text, text, integer, uuid);

create function public.start_live_conversation(
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

revoke all on function public.start_live_conversation(text, text, integer, uuid, text)
  from public, anon;
grant execute on function public.start_live_conversation(text, text, integer, uuid, text)
  to authenticated, service_role;
