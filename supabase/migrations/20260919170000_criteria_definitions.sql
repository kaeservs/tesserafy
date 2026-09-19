-- Criteria as data, not code.
--
-- "A new engagement type is a row" has been the stated convention since the
-- start; P6 needed something to score against before this table existed, so
-- the discovery set has been living in a TypeScript constant. This is that
-- shortcut being paid back.
--
-- Not tenant-scoped. These are product-level definitions shared by every
-- company, which is why there is no company_id and why RLS lets any signed-in
-- user read them. A customer-specific set would add a nullable company_id and
-- a policy to match; nothing here forecloses that.
--
-- The thresholds live beside the definitions because packages/scoring takes
-- them per criterion (ADR 0003), and a criteria set whose thresholds live
-- somewhere else is a set that can be loaded wrong.

create table public.criteria_definitions (
  engagement_type        text not null check (length(trim(engagement_type)) > 0),
  version                integer not null check (version >= 1),
  key                    text not null check (length(trim(key)) > 0),
  label                  text not null check (length(trim(label)) > 0),
  -- What counts as evidence, in a sentence. This is the detector's prompt.
  definition             text not null check (length(trim(definition)) > 0),
  weight                 double precision not null default 1 check (weight > 0),
  candidate_threshold    double precision not null default 0.55,
  confirm_threshold      double precision not null default 0.8,
  corroborating_segments integer not null default 2 check (corroborating_segments >= 1),
  -- Display order. The scorecard reads top to bottom and a stable order is
  -- part of it being readable at a glance during a live call.
  position               integer not null,
  created_at             timestamptz not null default now(),

  primary key (engagement_type, version, key),
  constraint criteria_thresholds_ordered check (
    candidate_threshold > 0
    and candidate_threshold <= confirm_threshold
    and confirm_threshold <= 1
  )
);

comment on table public.criteria_definitions is
  'Engagement types and their criteria. Product-level reference data, shared by all companies; a conversation pins the version it was scored against.';

alter table public.criteria_definitions enable row level security;

create policy "signed-in users read criteria"
  on public.criteria_definitions for select to authenticated
  using (true);

-- No write policy: criteria change by migration or by an operator with the
-- service role, never from a browser.


-- ---------------------------------------------------------------------------
-- The discovery set, version 1
-- ---------------------------------------------------------------------------
-- Shipped in the migration rather than in supabase/seed/ because seeds only
-- run on a local `db reset`; a production database that came up with no
-- criteria at all would have a live path that cannot score anything. Later
-- sets can be inserted by an operator without a deploy, which is the point of
-- the table.

insert into public.criteria_definitions
  (engagement_type, version, key, label, definition, weight, position)
values
  ('discovery', 1, 'pain_quantified', 'Pain quantified',
   'The customer states what a problem costs them in time, money, headcount or accuracy. A complaint with no size is not enough.',
   1, 1),
  ('discovery', 1, 'current_process_known', 'Current process known',
   'The customer describes how the work is done today — the tools, the steps or who does it.',
   1, 2),
  ('discovery', 1, 'desired_outcome_stated', 'Desired outcome stated',
   'The customer says what they want instead, either as a request or by describing how they would like it to work.',
   1, 3),
  ('discovery', 1, 'timeline_stated', 'Timeline stated',
   'The customer names a date, deadline or period for the change they are considering. Scheduling the next meeting does not count.',
   1, 4),
  ('discovery', 1, 'budget_indicated', 'Budget indicated',
   'The customer refers to budget, funding, price sensitivity or when money can be committed.',
   1, 5)
on conflict (engagement_type, version, key) do nothing;
