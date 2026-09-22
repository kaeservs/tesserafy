-- A past meeting's scorecard, and why it is not stored as one.
--
-- Until now criterion state lived only in a browser tab: the live path folded
-- detector events into memory, drew a score, and lost both when the tab
-- closed. Nothing on the server could answer "how did that call go" — signals
-- are keyed by kind ('problem', 'feature_request'), not by criterion, so they
-- cannot be mapped back to a criteria set.
--
-- What is stored here is evidence, not a score. Each row is one DetectorEvent
-- in the shape packages/scoring already consumes: a criterion key, a
-- confidence, and a quoted span. The status and the number are computed on
-- read by replay() and score() — the same pure functions the overlay uses.
--
-- The alternative was a snapshot: store the score and the statuses per
-- conversation. It reads faster and it rots. Change a threshold or publish a
-- new criteria version and every stored score becomes a number no function
-- would now produce, with nothing to catch it. Invariant 1 says a number that
-- came straight from a model is a bug; a number that came from a function
-- nobody has run since Tuesday is the same bug with a longer fuse.

-- ---------------------------------------------------------------------------
-- What a conversation was scored against
-- ---------------------------------------------------------------------------
-- criteria_definitions is keyed (engagement_type, version, key), so there is
-- no (engagement_type, version) unique for a foreign key to point at. A
-- trigger does the referential work instead: without it a conversation could
-- pin a set that does not exist, and the dashboard would render an empty
-- scorecard with nothing to say about why.

alter table public.conversations
  add column engagement_type  text    not null default 'discovery',
  add column criteria_version integer not null default 1;

comment on column public.conversations.engagement_type is
  'Which criteria set this conversation is scored against. Pinned, so re-scoring is a deliberate act.';

create function public.assert_criteria_set_exists()
returns trigger
language plpgsql
stable
set search_path = ''
as $fn$
begin
  if not exists (
    select 1 from public.criteria_definitions d
    where d.engagement_type = new.engagement_type
      and d.version = new.criteria_version
  ) then
    raise exception 'conversation %: no criteria set %/v%',
      new.id, new.engagement_type, new.criteria_version
      using errcode = '23503';
  end if;
  return new;
end;
$fn$;

create trigger conversations_criteria_set_exists
  before insert or update of engagement_type, criteria_version on public.conversations
  for each row execute function public.assert_criteria_set_exists();


-- ---------------------------------------------------------------------------
-- The events themselves
-- ---------------------------------------------------------------------------

create table public.criterion_events (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null,
  conversation_id uuid not null,
  criterion_key   text not null check (length(trim(criterion_key)) > 0),
  -- 'contradiction' is the only thing that may unseat a confirmed criterion
  -- (invariant 2). Absence of evidence is not an event and never will be.
  kind            text not null check (kind in ('evidence', 'contradiction')),
  confidence      double precision not null check (confidence >= 0 and confidence <= 1),
  segment_id      uuid not null,
  quote           text not null check (length(trim(quote)) > 0),
  quote_start     integer not null check (quote_start >= 0),
  quote_end       integer not null,
  -- Which detector version said so, e.g. 't1-detect@2026-09-19'. Precision is
  -- measured per detector; without this the numbers attribute to nothing.
  detector        text not null check (length(trim(detector)) > 0),
  model           text not null check (length(trim(model)) > 0),
  created_at      timestamptz not null default now(),
  check (quote_end > quote_start),
  -- The same span, for the same criterion, twice is one observation. Latching
  -- makes a repeat harmless to the score; it is still noise in the evidence
  -- list a person reads.
  unique (conversation_id, criterion_key, kind, segment_id, quote_start, quote_end),
  foreign key (company_id, conversation_id)
    references public.conversations (company_id, id) on delete cascade,
  foreign key (company_id, segment_id)
    references public.segments (company_id, id) on delete cascade
);

comment on table public.criterion_events is
  'Detector events per conversation. Evidence, never a score: status and score are computed on read by packages/scoring.';

create index criterion_events_conversation_idx
  on public.criterion_events (company_id, conversation_id, criterion_key);

-- "Which criteria does this segment support?" — the click-through from a
-- transcript line back to the scorecard.
create index criterion_events_segment_idx
  on public.criterion_events (company_id, segment_id);


-- ---------------------------------------------------------------------------
-- Quote fidelity, for this table too
-- ---------------------------------------------------------------------------
-- The existing function is already generic over its columns; only its error
-- messages named signal_evidence. Redefined to name whichever table fired it,
-- so the same guarantee covers both and a failure says where it happened.
--
-- Safe to share, unlike the tg_op branching that broke in 20260918092000:
-- both tables carry the same columns, so every new.* reference below resolves
-- for either one.

create or replace function public.assert_quote_matches_segment()
returns trigger
language plpgsql
stable
set search_path = ''
as $fn$
declare
  segment_text text;
begin
  select s.text into segment_text
  from public.segments s
  where s.id = new.segment_id
    and s.company_id = new.company_id;

  if segment_text is null then
    raise exception '%: segment % not found in company %',
      tg_table_name, new.segment_id, new.company_id
      using errcode = '23503';
  end if;

  if new.quote_end > length(segment_text) then
    raise exception '%: quote range %-% exceeds segment length %',
      tg_table_name, new.quote_start, new.quote_end, length(segment_text)
      using errcode = '23514';
  end if;

  if substring(segment_text from new.quote_start + 1 for new.quote_end - new.quote_start)
     is distinct from new.quote then
    raise exception '%: quote does not match segment % at %-% (invariant 4)',
      tg_table_name, new.segment_id, new.quote_start, new.quote_end
      using errcode = '23514';
  end if;

  return new;
end;
$fn$;

create trigger criterion_events_quote_fidelity
  before insert or update on public.criterion_events
  for each row execute function public.assert_quote_matches_segment();


-- ---------------------------------------------------------------------------
-- Who may read and write
-- ---------------------------------------------------------------------------
-- Read: members of the company, like everything else.
--
-- Write: nobody from a browser. These rows are what the score is computed
-- from, so a client that could insert them could fabricate a scorecard for
-- its own company. The scoring pass runs server-side with the service role.
-- Persisting live events from the overlay is a later step and needs an RPC
-- that re-derives the quote from the segment rather than trusting the caller.

alter table public.criterion_events enable row level security;

create policy "members read their company's criterion events"
  on public.criterion_events for select to authenticated
  using ((select private.is_company_member(company_id)));
