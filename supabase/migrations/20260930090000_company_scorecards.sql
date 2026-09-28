-- A company's own scorecards (ADR 0016).
--
-- Criteria sets were product-level reference data: one table, no company,
-- written only by an operator from a terminal. A brand could not score its
-- calls against its own playbook — its demo, its renewal, its way of running
-- discovery — which, for a product that scores calls, is the thing it is for.
--
-- The migration that made this table said what a customer-specific set would
-- need: "a nullable company_id and a policy to match". That, and one rule.
--
--   company_id null   a template, published by an operator; everyone reads it.
--   company_id set    that company's own set; only its members read it.
--
-- The rule: a company's set may not take a template's name, and a template may
-- not take a name some company already uses. So for any one company an
-- engagement type means exactly one set, and a conversation's pinned
-- (engagement_type, criteria_version) stays unambiguous without a new column
-- on every table that reads criteria. Two companies may each have a "demo";
-- neither can see the other's.
--
-- Owners publish through `publish_scorecard`, which validates everything the
-- scoring engine and the detector depend on. A published version is still
-- immutable — calls pin the version they were scored against — so a change is
-- a new version, as before. Templates stay an operator's (`pnpm criteria`).

alter table public.criteria_definitions
  add column company_id   uuid references public.companies (id) on delete cascade,
  add column published_by uuid references auth.users (id) on delete set null,
  add column id           uuid not null default gen_random_uuid();

-- The old key could not hold two companies' "demo" v1; this one can, while
-- still refusing a duplicate criterion within any one set.
alter table public.criteria_definitions drop constraint criteria_definitions_pkey;
alter table public.criteria_definitions add primary key (id);
create unique index criteria_definitions_scope_key
  on public.criteria_definitions (
    coalesce(company_id, '00000000-0000-0000-0000-000000000000'::uuid),
    engagement_type, version, key
  );
create index criteria_definitions_company_idx
  on public.criteria_definitions (company_id, engagement_type, version)
  where company_id is not null;

comment on table public.criteria_definitions is
  'Criteria sets. company_id null: a template every company reads; set: that company''s own (ADR 0016). A conversation pins the version it was scored against.';

drop policy "signed-in users read criteria" on public.criteria_definitions;
create policy "templates, and a member's own company's sets"
  on public.criteria_definitions for select to authenticated
  using (
    company_id is null
    or (select private.is_company_member(company_id))
    or (select private.is_platform_admin())
  );


-- The one rule, in both directions.
create function private.criteria_name_is_free()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.company_id is null and exists (
    select 1 from public.criteria_definitions d
     where d.company_id is not null and d.engagement_type = new.engagement_type
  ) then
    raise exception 'criteria: a company already has a scorecard called %', new.engagement_type
      using errcode = '23505';
  end if;
  if new.company_id is not null and exists (
    select 1 from public.criteria_definitions d
     where d.company_id is null and d.engagement_type = new.engagement_type
  ) then
    raise exception 'criteria: % is a template''s name', new.engagement_type
      using errcode = '23505';
  end if;
  return new;
end;
$$;

create trigger criteria_definitions_name_is_free
  before insert or update of engagement_type, company_id on public.criteria_definitions
  for each row execute function private.criteria_name_is_free();


-- A conversation may pin a template or its own company's set, never another
-- company's.
create or replace function public.assert_criteria_set_exists()
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
      and (d.company_id is null or d.company_id = new.company_id)
  ) then
    raise exception 'conversation %: no criteria set %/v%',
      new.id, new.engagement_type, new.criteria_version
      using errcode = '23503';
  end if;
  return new;
end;
$fn$;


-- Evidence for a criterion of the conversation's own set, in its own scope.
-- Unchanged but for that scope: another company's set with the same name and
-- key must not make a claim acceptable.
create or replace function public.record_criterion_events(
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

    select s.text into v_segment_text
    from public.segments s
    where s.id = (v_event->>'segment_id')::uuid
      and s.conversation_id = p_conversation_id
      and s.company_id = v_company_id;

    if v_segment_text is null
       or v_quote is null
       or length(trim(v_quote)) = 0
       or v_kind not in ('evidence', 'contradiction')
       or not exists (
         select 1 from public.criteria_definitions d
         where d.engagement_type = v_engagement_type
           and d.version = v_criteria_version
           and d.key = v_event->>'criterion_key'
           and (d.company_id is null or d.company_id = v_company_id)
       )
    then
      v_rejected := v_rejected + 1;
      continue;
    end if;

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

    if found then
      v_recorded := v_recorded + 1;
    end if;
  end loop;

  return jsonb_build_object('recorded', v_recorded, 'rejected', v_rejected);
end;
$$;


-- An owner publishes a set, or a new version of one, for their own company.
-- Everything the scoring engine and the detector rely on is checked here, so a
-- set that would score nonsense cannot be stored. Returns the version made.
create function public.publish_scorecard(p_engagement_type text, p_criteria jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company_id uuid := private.sole_company_of_caller();
  v_uid        uuid := (select auth.uid());
  v_version    integer;
  v_item       jsonb;
  v_position   integer := 0;
  v_keys       text[] := '{}';
  v_key        text;
  v_label      text;
  v_definition text;
  v_weight     double precision;
  v_candidate  double precision;
  v_confirm    double precision;
  v_segments   integer;
begin
  if not exists (
    select 1 from public.company_members m
     where m.company_id = v_company_id and m.user_id = v_uid and m.role = 'owner'
  ) then
    raise exception 'publish_scorecard: only an owner can publish a scorecard' using errcode = '42501';
  end if;

  if p_engagement_type is null or p_engagement_type !~ '^[a-z][a-z0-9-]{1,39}$' then
    raise exception 'publish_scorecard: a scorecard''s name is 2 to 40 lower-case letters, digits and hyphens'
      using errcode = '22023';
  end if;
  if exists (
    select 1 from public.criteria_definitions d
     where d.company_id is null and d.engagement_type = p_engagement_type
  ) then
    raise exception 'publish_scorecard: that is the name of a Tesserafy template; choose another'
      using errcode = '22023';
  end if;

  if p_criteria is null or jsonb_typeof(p_criteria) <> 'array'
     or jsonb_array_length(p_criteria) < 2 or jsonb_array_length(p_criteria) > 12 then
    raise exception 'publish_scorecard: a scorecard has 2 to 12 criteria' using errcode = '22023';
  end if;

  select coalesce(max(d.version), 0) + 1 into v_version
    from public.criteria_definitions d
   where d.company_id = v_company_id and d.engagement_type = p_engagement_type;

  for v_item in select * from jsonb_array_elements(p_criteria)
  loop
    v_position   := v_position + 1;
    v_key        := v_item->>'key';
    v_label      := trim(coalesce(v_item->>'label', ''));
    v_definition := trim(coalesce(v_item->>'definition', ''));
    v_weight     := coalesce((v_item->>'weight')::double precision, 1);
    v_candidate  := coalesce((v_item->>'candidate_threshold')::double precision, 0.55);
    v_confirm    := coalesce((v_item->>'confirm_threshold')::double precision, 0.8);
    v_segments   := coalesce((v_item->>'corroborating_segments')::integer, 2);

    if v_key is null or v_key !~ '^[a-z][a-z0-9_]{1,39}$' or v_key = any (v_keys) then
      raise exception 'publish_scorecard: criterion % needs its own key of lower-case letters, digits and underscores', v_position
        using errcode = '22023';
    end if;
    if length(v_label) < 1 or length(v_label) > 60 then
      raise exception 'publish_scorecard: criterion %''s name is 1 to 60 characters', v_position using errcode = '22023';
    end if;
    if length(v_definition) < 20 or length(v_definition) > 600 then
      raise exception 'publish_scorecard: criterion %''s description is 20 to 600 characters — it is what the detector listens for', v_position
        using errcode = '22023';
    end if;
    if v_weight < 0.5 or v_weight > 3 then
      raise exception 'publish_scorecard: criterion %''s weight is between 0.5 and 3', v_position using errcode = '22023';
    end if;
    if v_candidate <= 0 or v_candidate > v_confirm or v_confirm > 1 or v_segments < 1 or v_segments > 5 then
      raise exception 'publish_scorecard: criterion %''s thresholds are out of range', v_position using errcode = '22023';
    end if;

    v_keys := v_keys || v_key;
    insert into public.criteria_definitions
      (company_id, engagement_type, version, key, label, definition, weight,
       candidate_threshold, confirm_threshold, corroborating_segments, position, published_by)
    values
      (v_company_id, p_engagement_type, v_version, v_key, v_label, v_definition, v_weight,
       v_candidate, v_confirm, v_segments, v_position, v_uid);
  end loop;

  return v_version;
end;
$$;

revoke all on function public.publish_scorecard(text, jsonb) from public, anon;
grant execute on function public.publish_scorecard(text, jsonb) to authenticated;
