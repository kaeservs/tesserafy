-- Embeddings move from nomic-embed-text on an operator's machine to gte-small
-- inside Supabase, and from 768 dimensions to 384.
--
-- The owner chose Supabase's built-in model so that meeting text goes nowhere
-- it is not already stored: gte-small runs in this project's own edge runtime
-- (supabase/functions/embed). The cost of that choice was stated up front and
-- then measured before anything here was written.
--
-- Measured against every signal and segment in production — the same
-- quote-as-query comparison the insight clustering performs:
--
--   similarity spread    nomic p10 0.37 / p50 0.46 / p90 0.71
--                        gte   p10 0.76 / p50 0.80 / p90 0.90
--   old threshold 0.6    nomic keeps 3,296 of 19,948 pairs; gte keeps all 19,948
--
-- So the threshold moves with the model, and lives beside it in packages/ai
-- rather than as a literal anywhere. Keeping 0.6 would have clustered every
-- signal with every other, without an error anywhere.
--
-- Correction, written after this was applied (comments only; the schema is
-- unchanged): this note first said 0.87, chosen for 96% agreement over all
-- quote-to-segment pairs. Replaying the real clustering showed 0.87 forms no
-- insight at all. The value is 0.82 — see RELATED_SIMILARITY for why, and for
-- the false cluster it costs.
--
-- DESTRUCTIVE, deliberately: a 768-dimension vector cannot become a 384-one,
-- so every stored embedding is deleted here and recomputed afterwards with
-- `pnpm process --embed-only`. They are derived data, rebuilt from segments;
-- nothing a customer wrote is touched.
--
-- Applied with `supabase db push`, which records the file's own version, so
-- unlike the migrations applied over the API this one needed no rename.

delete from public.segment_embeddings;

drop index if exists public.segment_embeddings_embedding_idx;

alter table public.segment_embeddings
  alter column embedding type extensions.vector(384);

create index segment_embeddings_embedding_idx
  on public.segment_embeddings
  using hnsw (embedding extensions.vector_cosine_ops);

-- The three functions that name the dimension. Function arguments ignore a
-- vector's declared size, so match_segments would in fact have accepted 384
-- unchanged — it is restated so its declaration says what it now expects.

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
security invoker
set search_path = ''
as $$
#variable_conflict use_column
begin
  if p_company_id is null then
    raise exception 'match_segments: p_company_id is required';
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

create or replace function public.ingest_transcript(
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
    (s->>'embedding')::extensions.vector(384),
    p_model
  from jsonb_array_elements(p_segments) as s;

  return v_conversation_id;
end;
$$;

create or replace function public.embed_stored_segments(
  p_company_id uuid,
  p_model      text,
  -- [{ segment_id, embedding }]
  p_rows       jsonb
)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_written integer;
begin
  if p_company_id is null then
    raise exception 'embed_stored_segments: p_company_id is required';
  end if;
  if p_model is null or length(trim(p_model)) = 0 then
    raise exception 'embed_stored_segments: p_model is required';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'embed_stored_segments: p_rows must be an array';
  end if;

  -- The join is the tenant check. A segment id belonging to another company
  -- simply does not match, so it is skipped rather than written against the
  -- company that asked for it — which is the failure this guards.
  insert into public.segment_embeddings (segment_id, company_id, embedding, model)
  select s.id, s.company_id, (r->>'embedding')::extensions.vector(384), p_model
  from jsonb_array_elements(p_rows) as r
  join public.segments s
    on s.id = (r->>'segment_id')::uuid
   and s.company_id = p_company_id
  -- Re-embedding with a newer model replaces the vector; the same model twice
  -- is a no-op worth tolerating, because a re-run after a half-finished pass
  -- is the normal way this gets used.
  on conflict (segment_id) do update
    set embedding = excluded.embedding,
        model     = excluded.model;

  get diagnostics v_written = row_count;
  return v_written;
end;
$$;

-- ---------------------------------------------------------------------------
-- A customer can embed their own call
-- ---------------------------------------------------------------------------
-- embed_stored_segments is service-role work. Uploads now embed themselves,
-- as the uploader, so the customer's session needs a write path — built on the
-- same pattern as record_criterion_events and record_extracted_signals: the
-- company comes from the conversation, the caller must be a member, and every
-- segment must belong to that conversation.
--
-- It trusts the vectors. A member could store a wrong vector for their own
-- segment, which would make their own search worse and nothing else: it
-- cannot touch another tenant's rows, and match_segments is still only
-- reachable through retrieve(), with the service role.

create function public.record_segment_embeddings(
  p_conversation_id uuid,
  p_model           text,
  p_rows            jsonb
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company_id uuid;
  v_written    integer;
begin
  select c.company_id into v_company_id
  from public.conversations c
  where c.id = p_conversation_id;

  if v_company_id is null then
    raise exception 'record_segment_embeddings: conversation % not found', p_conversation_id
      using errcode = 'P0002';
  end if;

  if not (select private.is_company_member(v_company_id)) then
    raise exception 'record_segment_embeddings: not a member of that company'
      using errcode = '42501';
  end if;

  if coalesce(trim(p_model), '') = '' or jsonb_typeof(p_rows) is distinct from 'array' then
    raise exception 'record_segment_embeddings: a model and an array of rows are required'
      using errcode = '22023';
  end if;

  -- The cast to vector(384) rejects a vector of any other length, which is
  -- the check that matters: a 768-dimension vector from the old model
  -- written here would fail loudly rather than sit unsearchable.
  insert into public.segment_embeddings (segment_id, company_id, embedding, model)
  select s.id, s.company_id, (r->>'embedding')::extensions.vector(384), p_model
  from jsonb_array_elements(p_rows) as r
  join public.segments s
    on s.id = (r->>'segment_id')::uuid
   and s.conversation_id = p_conversation_id
  on conflict (segment_id) do update
    set embedding = excluded.embedding,
        model     = excluded.model;

  get diagnostics v_written = row_count;
  return v_written;
end;
$$;

revoke all on function public.record_segment_embeddings(uuid, text, jsonb) from public, anon;
grant execute on function public.record_segment_embeddings(uuid, text, jsonb)
  to authenticated, service_role;
