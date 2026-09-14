-- Phase 0 foundation: tenants, members, conversations, transcript segments
-- and their embeddings. Enough schema to pass the P0 gate and nothing more:
--
--   Two seeded companies. User A cannot reach company B's data via API,
--   direct query, or retrieve().
--
-- Two layers, per ADR 0004:
--   1. RLS on every table. Governs the browser and any user-JWT client.
--   2. match_segments(), callable by service_role only, reached exclusively
--      through retrieve() in packages/ai. RLS does not apply to the service
--      role, so the tenant filter inside this function is the real control.
--
-- company_id is denormalised onto every tenant-owned row, and composite
-- foreign keys pin it to the parent's company_id. Without that, a segment
-- could be written with conversation X (company A) but company_id B, and a
-- perfectly correct tenant filter would still leak it.


-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.companies (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(trim(name)) > 0),
  created_at  timestamptz not null default now()
);

create table public.company_members (
  company_id  uuid not null references public.companies (id) on delete cascade,
  user_id     uuid not null references auth.users (id) on delete cascade,
  role        text not null default 'member' check (role in ('owner', 'member')),
  created_at  timestamptz not null default now(),
  primary key (company_id, user_id)
);

-- The RLS helper looks memberships up by user first.
create index company_members_user_id_idx on public.company_members (user_id);

create table public.conversations (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies (id) on delete cascade,
  title        text not null,
  occurred_at  timestamptz,
  created_at   timestamptz not null default now(),
  -- Target for the composite foreign key on segments.
  unique (company_id, id)
);

create index conversations_company_id_idx on public.conversations (company_id);

-- A segment is the unit of evidence: a quoted span with a timestamp
-- (invariant 4). Offsets are milliseconds from the start of the recording.
create table public.segments (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null,
  conversation_id  uuid not null,
  speaker          text,
  start_ms         integer not null check (start_ms >= 0),
  end_ms           integer not null,
  text             text not null check (length(text) > 0),
  created_at       timestamptz not null default now(),
  check (end_ms >= start_ms),
  unique (company_id, id),
  foreign key (company_id, conversation_id)
    references public.conversations (company_id, id) on delete cascade
);

create index segments_conversation_id_idx on public.segments (conversation_id, start_ms);

-- Separate from segments so a change of embedding model is a new column or
-- table plus a re-index, not a rewrite of evidence rows (ADR 0005).
create table public.segment_embeddings (
  segment_id  uuid primary key,
  company_id  uuid not null,
  embedding   extensions.vector(768) not null,
  model       text not null,
  created_at  timestamptz not null default now(),
  foreign key (company_id, segment_id)
    references public.segments (company_id, id) on delete cascade
);

create index segment_embeddings_company_id_idx on public.segment_embeddings (company_id);

-- Filtered HNSW scans can return fewer than `limit` rows once one tenant is a
-- small fraction of the table. pgvector 0.8 iterative scans address this;
-- revisit with real data volume in Phase 5, not before.
create index segment_embeddings_embedding_idx
  on public.segment_embeddings
  using hnsw (embedding extensions.vector_cosine_ops);


-- ---------------------------------------------------------------------------
-- Membership helper
-- ---------------------------------------------------------------------------

-- Lives in a schema PostgREST does not expose. SECURITY DEFINER so the
-- membership lookup is not itself subject to RLS on company_members, which
-- would recurse.
create schema if not exists private;

create function private.is_company_member(p_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.company_members m
    where m.company_id = p_company_id
      and m.user_id = (select auth.uid())
  );
$$;

revoke all on function private.is_company_member(uuid) from public;
grant usage on schema private to authenticated;
grant execute on function private.is_company_member(uuid) to authenticated;


-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
-- Read-only for signed-in members in P0. Writes go through server code with
-- the service role; no insert/update/delete policies exist, so user JWTs are
-- denied by default. Anonymous clients get nothing.

alter table public.companies          enable row level security;
alter table public.company_members    enable row level security;
alter table public.conversations      enable row level security;
alter table public.segments           enable row level security;
alter table public.segment_embeddings enable row level security;

create policy "members read their companies"
  on public.companies for select to authenticated
  using ((select private.is_company_member(id)));

create policy "members read their company's memberships"
  on public.company_members for select to authenticated
  using ((select private.is_company_member(company_id)));

create policy "members read their company's conversations"
  on public.conversations for select to authenticated
  using ((select private.is_company_member(company_id)));

create policy "members read their company's segments"
  on public.segments for select to authenticated
  using ((select private.is_company_member(company_id)));

-- segment_embeddings deliberately has no policy. Vectors are never served to
-- a browser; similarity search happens server-side through retrieve().
revoke all on table public.segment_embeddings from anon, authenticated;


-- ---------------------------------------------------------------------------
-- The guarded similarity search
-- ---------------------------------------------------------------------------
-- The only vector query in the system. Called exclusively by retrieve() in
-- packages/ai/src/retrieval. company_id is returned so retrieve() can verify
-- every row after the fact — a second, independent check on this filter.

create function public.match_segments(
  p_company_id      uuid,
  p_query_embedding extensions.vector(768),
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

revoke all on function public.match_segments(uuid, extensions.vector, integer, double precision)
  from public, anon, authenticated;
grant execute on function public.match_segments(uuid, extensions.vector, integer, double precision)
  to service_role;
