-- A transcript can arrive without a terminal.
--
-- Applied through the Supabase management API rather than `supabase db push`,
-- because the connection pooler was refusing every connection while the REST
-- endpoint stayed healthy. That route assigns its own timestamp, so this file
-- is named for the version actually recorded (20260923134906) rather than the
-- one it was written with. Worth confirming with `supabase migration list`
-- once the pooler is reachable: a filename that disagrees with the recorded
-- version is a migration the CLI will try to apply a second time.
--
-- The MVP is post-call: import a transcript, get evidence-backed signals, a
-- scorecard and insights. Everything downstream of the import has worked for
-- a while. The import itself has only ever been `pnpm ingest` — a terminal, a
-- service-role key and a local embedding model — so a person could read
-- everything in the product and add nothing to it. The front door did not
-- exist.
--
-- ---------------------------------------------------------------------------
-- Why this is not ingest_transcript()
-- ---------------------------------------------------------------------------
-- ingest_transcript() writes the conversation, its segments and their
-- embeddings in one transaction, and is service-role only for the reason
-- ADR 0008 gives: a vector written against the wrong tenant is a leak that
-- outlives the bug. A browser cannot produce embeddings anyway — the embedder
-- is a model on an operator's machine — so this writes the transcript and
-- leaves the vectors for `pnpm process`, which is the same shape the live
-- path already takes. A conversation with segments and no embeddings is a
-- state the product understands and shows: the pipeline column reads
-- "captured" until somebody runs the pass.
--
-- One statement rather than a segment at a time, unlike the live path. A live
-- call has no choice; a file does, and a transcript that landed half-written
-- would be a conversation nobody can tell is incomplete.
--
-- What a caller may assert is what it may assert anywhere else: that these
-- words were said. It cannot write a score, cannot write evidence, and cannot
-- reach another tenant.

create function public.import_conversation(
  p_title            text,
  p_segments         jsonb,
  p_occurred_at      timestamptz default null,
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
  v_count      integer;
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

  -- A ceiling, because this is reachable from a browser. Well above any real
  -- call: a 90-minute conversation chunks to a few hundred segments.
  if jsonb_array_length(p_segments) > 5000 then
    raise exception 'import_conversation: % segments is more than a transcript',
      jsonb_array_length(p_segments)
      using errcode = '22023';
  end if;

  insert into public.conversations
    (company_id, title, occurred_at, engagement_type, criteria_version)
  values
    (v_company_id, trim(p_title), p_occurred_at, p_engagement_type, p_criteria_version)
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
  -- Ordinality is not needed: segments are ordered by start_ms everywhere
  -- they are read, and the parser already assigns those.
  where length(trim(coalesce(s->>'text', ''))) > 0;

  get diagnostics v_count = row_count;
  if v_count = 0 then
    raise exception 'import_conversation: every segment was empty' using errcode = '22023';
  end if;

  return v_id;
end;
$$;

comment on function public.import_conversation(text, jsonb, timestamptz, text, integer, uuid) is
  'Writes a parsed transcript as a conversation and its segments, with no embeddings. Reachable by a member: the front door for the post-call MVP.';

revoke all on function public.import_conversation(text, jsonb, timestamptz, text, integer, uuid)
  from public, anon;
grant execute on function public.import_conversation(text, jsonb, timestamptz, text, integer, uuid)
  to authenticated, service_role;
