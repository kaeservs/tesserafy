-- What the AI is told about this company: guidance it learns from people's
-- corrections, instructions owners write, and what kind of call each
-- scorecard is for.
--
-- Learning, here, is memory rather than retraining. When someone presses
-- "This score is wrong" and says why, that correction becomes an example the
-- scoring detector is shown on every call the company scores afterwards —
-- "for us, 'we have forty thousand set aside' counts as Budget indicated,
-- because they named the amount". Owners can also write instructions for each
-- AI feature (scoring, insights, action items, call prep), for every call type
-- or one. All of it is listed where owners can read it, switch it off or
-- delete it: an AI that changes with no one able to see why is not one a team
-- can trust with a score.
--
-- The model still never produces a score (invariant 1): guidance changes what
-- evidence the detector reports, and packages/scoring decides from that
-- evidence exactly as before. It applies from then on; calls already scored
-- keep their evidence until someone re-scores them.
--
-- An example quotes a call. Withdrawing the correction, or deleting the call,
-- deletes the example with it (the foreign key cascades), so erasing a call
-- still erases every copy of its words.

create table public.ai_guidance (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references public.companies (id) on delete cascade,
  feature          text not null check (feature in ('scoring', 'insights', 'action_items', 'prep')),
  -- Null: every call type. Otherwise one scorecard (engagement type).
  engagement_type  text,
  -- Scoring only, optional: the criterion it is about.
  criterion_key    text,
  kind             text not null check (kind in ('instruction', 'example')),
  -- An instruction's words, or an example's reason.
  body             text not null check (length(trim(body)) between 1 and 1000),
  -- An example's quote, and whether it counts for the criterion.
  quote            text check (quote is null or length(quote) between 1 and 500),
  counts           boolean,
  source_event_id  uuid references public.criterion_events (id) on delete cascade,
  active           boolean not null default true,
  created_by       uuid references auth.users (id) on delete set null,
  created_at       timestamptz not null default now(),
  check (kind = 'instruction' or (quote is not null and counts is not null and criterion_key is not null and feature = 'scoring')),
  unique (source_event_id)
);

create index ai_guidance_company_idx on public.ai_guidance (company_id, feature, active, created_at);

comment on table public.ai_guidance is
  'What each AI feature is told about this company: examples learned from corrections, and owners'' instructions. Members read; owners change.';

alter table public.ai_guidance enable row level security;

create policy "members read their company's AI guidance"
  on public.ai_guidance for select to authenticated
  using ((select private.is_company_member(company_id)));


-- Every correction becomes an example, as it is made.
create function private.learn_from_correction()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_type text;
begin
  if new.detector <> 'person' or new.reason is null or new.quote is null then
    return new;
  end if;
  select c.engagement_type into v_type from public.conversations c where c.id = new.conversation_id;
  insert into public.ai_guidance
    (company_id, feature, engagement_type, criterion_key, kind, body, quote, counts, source_event_id, created_by)
  values
    (new.company_id, 'scoring', v_type, new.criterion_key, 'example', left(new.reason, 1000), left(new.quote, 500),
     new.kind = 'evidence', new.id, new.recorded_by)
  on conflict (source_event_id) do nothing;
  return new;
end;
$$;

create trigger criterion_events_learn
  after insert on public.criterion_events
  for each row execute function private.learn_from_correction();

-- And the corrections already made teach it from today.
insert into public.ai_guidance
  (company_id, feature, engagement_type, criterion_key, kind, body, quote, counts, source_event_id, created_by, created_at)
select e.company_id, 'scoring', c.engagement_type, e.criterion_key, 'example', left(e.reason, 1000), left(e.quote, 500),
       e.kind = 'evidence', e.id, e.recorded_by, e.created_at
  from public.criterion_events e
  join public.conversations c on c.id = e.conversation_id
 where e.detector = 'person' and e.reason is not null and e.quote is not null
on conflict (source_event_id) do nothing;


create function private.is_company_owner(p_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.company_members m
     where m.company_id = p_company_id and m.user_id = (select auth.uid()) and m.role = 'owner'
  );
$$;

-- An owner's instruction to one AI feature.
create function public.add_ai_instruction(
  p_feature         text,
  p_body            text,
  p_engagement_type text default null,
  p_criterion_key   text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company_id uuid := private.sole_company_of_caller();
  v_body       text := trim(coalesce(p_body, ''));
  v_id         uuid;
begin
  if not private.is_company_owner(v_company_id) then
    raise exception 'add_ai_instruction: only an owner tells the AI how to work' using errcode = '42501';
  end if;
  if p_feature is null or p_feature not in ('scoring', 'insights', 'action_items', 'prep') then
    raise exception 'add_ai_instruction: no such feature' using errcode = '22023';
  end if;
  if length(v_body) not between 1 and 1000 then
    raise exception 'add_ai_instruction: an instruction is 1 to 1000 characters' using errcode = '22023';
  end if;
  if p_criterion_key is not null and p_feature <> 'scoring' then
    raise exception 'add_ai_instruction: only scoring is told about a criterion' using errcode = '22023';
  end if;
  if p_engagement_type is not null and not exists (
    select 1 from public.criteria_definitions d
     where d.engagement_type = p_engagement_type and (d.company_id is null or d.company_id = v_company_id)
       and (p_criterion_key is null or d.key = p_criterion_key)
  ) then
    raise exception 'add_ai_instruction: no such scorecard or criterion' using errcode = '22023';
  end if;

  insert into public.ai_guidance (company_id, feature, engagement_type, criterion_key, kind, body, created_by)
  values (v_company_id, p_feature, p_engagement_type, p_criterion_key, 'instruction', v_body, (select auth.uid()))
  returning id into v_id;
  return v_id;
end;
$$;

-- Switch a piece of guidance off or on, or delete it. Owners.
create function public.set_ai_guidance(p_guidance_id uuid, p_active boolean default null, p_delete boolean default false)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.ai_guidance;
begin
  select * into v_row from public.ai_guidance g where g.id = p_guidance_id;
  if v_row.id is null or not (select private.is_company_member(v_row.company_id)) then
    raise exception 'set_ai_guidance: not found' using errcode = 'P0002';
  end if;
  if not private.is_company_owner(v_row.company_id) then
    raise exception 'set_ai_guidance: only an owner changes what the AI is told' using errcode = '42501';
  end if;
  if p_delete then
    delete from public.ai_guidance where id = p_guidance_id;
  elsif p_active is not null then
    update public.ai_guidance set active = p_active where id = p_guidance_id;
  end if;
end;
$$;


-- What kind of call each scorecard is for. Tesserafy's templates have a
-- default in the app; a row here is the company's own choice.
create table public.scorecard_purposes (
  company_id       uuid not null references public.companies (id) on delete cascade,
  engagement_type  text not null,
  purpose          text not null check (purpose in ('sales', 'customer_success', 'support', 'recruiting', 'internal', 'other')),
  set_by           uuid references auth.users (id) on delete set null,
  updated_at       timestamptz not null default now(),
  primary key (company_id, engagement_type)
);

alter table public.scorecard_purposes enable row level security;

create policy "members read their company's call types"
  on public.scorecard_purposes for select to authenticated
  using ((select private.is_company_member(company_id)));

-- The scorecard a new import uses when nobody picks one.
alter table public.companies add column default_engagement_type text;

create function public.set_call_type(p_engagement_type text, p_purpose text default null, p_make_default boolean default false)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company_id uuid := private.sole_company_of_caller();
begin
  if not private.is_company_owner(v_company_id) then
    raise exception 'set_call_type: only an owner sets call types' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.criteria_definitions d
     where d.engagement_type = p_engagement_type and (d.company_id is null or d.company_id = v_company_id)
  ) then
    raise exception 'set_call_type: no such scorecard' using errcode = '22023';
  end if;
  if p_purpose is not null then
    if p_purpose not in ('sales', 'customer_success', 'support', 'recruiting', 'internal', 'other') then
      raise exception 'set_call_type: no such call type' using errcode = '22023';
    end if;
    insert into public.scorecard_purposes (company_id, engagement_type, purpose, set_by)
    values (v_company_id, p_engagement_type, p_purpose, (select auth.uid()))
    on conflict (company_id, engagement_type)
    do update set purpose = excluded.purpose, set_by = excluded.set_by, updated_at = now();
  end if;
  if p_make_default then
    update public.companies set default_engagement_type = p_engagement_type where id = v_company_id;
  end if;
end;
$$;

revoke all on function public.add_ai_instruction(text, text, text, text) from public, anon;
revoke all on function public.set_ai_guidance(uuid, boolean, boolean) from public, anon;
revoke all on function public.set_call_type(text, text, boolean) from public, anon;
revoke all on function private.is_company_owner(uuid) from public, anon;
grant execute on function public.add_ai_instruction(text, text, text, text) to authenticated;
grant execute on function public.set_ai_guidance(uuid, boolean, boolean) to authenticated;
grant execute on function public.set_call_type(text, text, boolean) to authenticated;
