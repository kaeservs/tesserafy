-- Phase 1: extracted signals and the evidence that backs them. ADR 0007.
--
-- A signal is something a detector claims about a conversation ("they lose a
-- Friday afternoon to this export"). Evidence is the quoted, timestamped span
-- it came from. The two are separate tables because an insight in Phase 5
-- needs several spans from several conversations, and a single segment_id
-- column on signals would have to be migrated away before that gate.
--
-- Three things the database enforces, rather than the pipeline promising them:
--
--   1. company_id is pinned by composite foreign keys, as on segments. A
--      signal cannot cite a segment belonging to another tenant.
--   2. Evidence must quote its segment exactly. A model that paraphrases
--      while claiming to quote is rejected at write time.
--   3. A signal with no evidence fails at commit. Invariant 4 stops being a
--      convention and becomes a constraint.


-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.signals (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null,
  conversation_id  uuid not null,
  -- Extend deliberately: a new kind is a migration, so the eval set and the
  -- UI are updated in the same change.
  kind             text not null check (kind in ('problem', 'feature_request')),
  summary          text not null check (length(trim(summary)) > 0),
  -- The detector's own confidence. Never a score: packages/scoring turns
  -- these into criterion states, and no number here is shown to a user as
  -- though a model produced it (invariant 1).
  confidence       double precision not null check (confidence >= 0 and confidence <= 1),
  -- Which detector said so, e.g. 't3-extract@2026-09-16'. Phase 3 measures
  -- precision per detector version; without this the numbers cannot be
  -- attributed to anything.
  detector         text not null check (length(trim(detector)) > 0),
  model            text not null check (length(trim(model)) > 0),
  created_at       timestamptz not null default now(),
  -- Target for the composite foreign key on signal_evidence.
  unique (company_id, id),
  foreign key (company_id, conversation_id)
    references public.conversations (company_id, id) on delete cascade
);

create index signals_company_id_conversation_id_idx
  on public.signals (company_id, conversation_id);

-- The evidence link. Offsets are character positions into segments.text,
-- zero-based and end-exclusive, so the UI can highlight the exact phrase
-- inside the segment it scrolls to.
create table public.signal_evidence (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null,
  signal_id    uuid not null,
  segment_id   uuid not null,
  quote        text not null check (length(trim(quote)) > 0),
  quote_start  integer not null check (quote_start >= 0),
  quote_end    integer not null,
  created_at   timestamptz not null default now(),
  check (quote_end > quote_start),
  -- One signal may cite the same segment twice only at different offsets;
  -- the same span twice is one piece of evidence.
  unique (signal_id, segment_id, quote_start, quote_end),
  foreign key (company_id, signal_id)
    references public.signals (company_id, id) on delete cascade,
  foreign key (company_id, segment_id)
    references public.segments (company_id, id) on delete cascade
);

create index signal_evidence_company_id_signal_id_idx
  on public.signal_evidence (company_id, signal_id);

-- "Which signals cite this segment?" — the click-through in the P1 gate.
create index signal_evidence_company_id_segment_id_idx
  on public.signal_evidence (company_id, segment_id);


-- ---------------------------------------------------------------------------
-- Quote fidelity
-- ---------------------------------------------------------------------------
-- An extraction model will paraphrase if left unchecked, and a paraphrase
-- presented as a quote is the failure mode this product cannot afford. The
-- stored quote must be exactly what the segment says at those offsets.

create function public.assert_quote_matches_segment()
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
    raise exception 'signal_evidence: segment % not found in company %',
      new.segment_id, new.company_id
      using errcode = '23503';
  end if;

  if new.quote_end > length(segment_text) then
    raise exception 'signal_evidence: quote range %-% exceeds segment length %',
      new.quote_start, new.quote_end, length(segment_text)
      using errcode = '23514';
  end if;

  if substring(segment_text from new.quote_start + 1 for new.quote_end - new.quote_start)
     is distinct from new.quote then
    raise exception 'signal_evidence: quote does not match segment % at %-% (invariant 4)',
      new.segment_id, new.quote_start, new.quote_end
      using errcode = '23514';
  end if;

  return new;
end;
$fn$;

create trigger signal_evidence_quote_fidelity
  before insert or update on public.signal_evidence
  for each row execute function public.assert_quote_matches_segment();


-- ---------------------------------------------------------------------------
-- No signal without evidence
-- ---------------------------------------------------------------------------
-- Deferred to commit, because a signal and its evidence are written in that
-- order inside one transaction. Checked again when evidence is removed, so
-- the guarantee cannot be deleted out from under a signal.

create function public.assert_signal_has_evidence()
returns trigger
language plpgsql
stable
set search_path = ''
as $fn$
declare
  target uuid := case tg_op when 'DELETE' then old.signal_id else new.id end;
begin
  -- The signal itself may have been deleted in the same transaction, which is
  -- the cascade doing its job, not a violation.
  if not exists (select 1 from public.signals s where s.id = target) then
    return null;
  end if;

  if not exists (select 1 from public.signal_evidence e where e.signal_id = target) then
    raise exception 'signal % has no evidence (invariant 4)', target
      using errcode = '23514';
  end if;

  return null;
end;
$fn$;

create constraint trigger signals_require_evidence
  after insert on public.signals
  deferrable initially deferred
  for each row execute function public.assert_signal_has_evidence();

create constraint trigger signal_evidence_keeps_signal_backed
  after delete on public.signal_evidence
  deferrable initially deferred
  for each row execute function public.assert_signal_has_evidence();


-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
-- The P0 shape: members read their own company's rows, writes belong to
-- server code holding the service role. No insert, update or delete policy
-- exists, so a user JWT is denied by default.

alter table public.signals         enable row level security;
alter table public.signal_evidence enable row level security;

create policy "members read their company's signals"
  on public.signals for select to authenticated
  using ((select private.is_company_member(company_id)));

create policy "members read their company's signal evidence"
  on public.signal_evidence for select to authenticated
  using ((select private.is_company_member(company_id)));
