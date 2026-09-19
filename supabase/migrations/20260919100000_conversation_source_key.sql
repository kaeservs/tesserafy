-- Phase 4: importing in bulk without importing twice.
--
-- A run of fifty files is re-run for ordinary reasons — a failure half way,
-- a corrected credential, a second operator who did not know. Without a key,
-- every re-run doubles the corpus, and duplicate conversations are the kind
-- of damage that is discovered weeks later by someone counting.
--
-- The key is the caller's, not the file's contents: two identical exports of
-- the same call are one conversation, and a corrected transcript is a
-- deliberate decision to re-import under a new key.

alter table public.conversations
  add column source_key text check (source_key is null or length(trim(source_key)) > 0);

-- Scoped to the tenant: two companies may import a file of the same name.
-- Null keys are exempt, so a conversation created by hand or by the live path
-- needs no key at all.
create unique index conversations_company_id_source_key_idx
  on public.conversations (company_id, source_key)
  where source_key is not null;

comment on column public.conversations.source_key is
  'Stable identifier for the import that produced this conversation, unique per company. Null for conversations not created by an import.';


-- ---------------------------------------------------------------------------
-- ingest_transcript(), now recording where the transcript came from
-- ---------------------------------------------------------------------------
-- Dropped and recreated rather than overloaded: two functions differing only
-- by a defaulted argument is the kind of ambiguity that resolves to the wrong
-- one at the worst moment.

drop function if exists public.ingest_transcript(uuid, text, timestamptz, text, jsonb);

create function public.ingest_transcript(
  p_company_id  uuid,
  p_title       text,
  p_occurred_at timestamptz,
  p_model       text,
  p_segments    jsonb,
  p_source_key  text default null
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_conversation_id uuid;
begin
  if p_company_id is null then
    raise exception 'ingest_transcript: p_company_id is required';
  end if;
  if p_title is null or length(trim(p_title)) = 0 then
    raise exception 'ingest_transcript: p_title is required';
  end if;
  if p_model is null or length(trim(p_model)) = 0 then
    raise exception 'ingest_transcript: p_model is required';
  end if;
  if p_segments is null
     or jsonb_typeof(p_segments) <> 'array'
     or jsonb_array_length(p_segments) = 0 then
    raise exception 'ingest_transcript: p_segments must be a non-empty array';
  end if;

  insert into public.conversations (company_id, title, occurred_at, source_key)
  values (p_company_id, trim(p_title), p_occurred_at, nullif(trim(coalesce(p_source_key, '')), ''))
  returning id into v_conversation_id;

  insert into public.segments (id, company_id, conversation_id, speaker, start_ms, end_ms, text)
  select
    (s->>'id')::uuid,
    p_company_id,
    v_conversation_id,
    s->>'speaker',
    (s->>'start_ms')::integer,
    (s->>'end_ms')::integer,
    s->>'text'
  from jsonb_array_elements(p_segments) as s;

  insert into public.segment_embeddings (segment_id, company_id, embedding, model)
  select
    (s->>'id')::uuid,
    p_company_id,
    (s->>'embedding')::extensions.vector(768),
    p_model
  from jsonb_array_elements(p_segments) as s;

  return v_conversation_id;
end;
$$;

revoke all on function public.ingest_transcript(uuid, text, timestamptz, text, jsonb, text)
  from public, anon, authenticated;
grant execute on function public.ingest_transcript(uuid, text, timestamptz, text, jsonb, text)
  to service_role;


-- ---------------------------------------------------------------------------
-- "Have I imported this already?"
-- ---------------------------------------------------------------------------
-- A plain lookup rather than an upsert: a batch run decides for itself whether
-- to skip, and the unique index above is what actually prevents the race.

create function public.conversation_for_source(
  p_company_id uuid,
  p_source_key text
)
returns uuid
language sql
stable
security invoker
set search_path = ''
as $$
  select c.id
  from public.conversations c
  where c.company_id = p_company_id
    and c.source_key = p_source_key;
$$;

revoke all on function public.conversation_for_source(uuid, text) from public, anon, authenticated;
grant execute on function public.conversation_for_source(uuid, text) to service_role;
