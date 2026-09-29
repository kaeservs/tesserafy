-- Preparing for a call: who you are about to meet, what their public profile
-- says, and a brief to read beforehand — questions aimed at what is still to
-- find out with their company, and what they have already said on earlier
-- calls.
--
-- LinkedIn is a link here, never a fetch. LinkedIn's terms forbid automated
-- collection, its pages sit behind a sign-in wall, and its APIs do not give
-- out other people's profiles; so the seller pastes what they can see (the
-- About and Experience sections, or the profile's own "Save to PDF" text) and
-- the brief quotes only that. An enrichment vendor could fill the same field
-- later, behind the same table.
--
-- A prep is personal data about someone outside the company. The pasted text
-- reaches this table already redacted (emails, phone numbers) by the web app,
-- as a transcript does; it is readable by the company, changed or deleted by
-- whoever wrote it or an owner, and forgotten when the company is closed.

create table public.call_preps (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references public.companies (id) on delete cascade,
  account_id       uuid,
  person_name      text not null check (length(trim(person_name)) between 1 and 120 and person_name = trim(person_name)),
  person_title     text check (person_title is null or length(person_title) between 1 and 200),
  -- A public profile's address and nothing else: https, linkedin.com, /in/<handle>.
  linkedin_url     text check (linkedin_url is null or linkedin_url ~ '^https://([a-z]{2,3}\.)?linkedin\.com/in/[A-Za-z0-9_%-]{2,100}/?$'),
  profile_text     text check (profile_text is null or length(profile_text) between 1 and 12000),
  engagement_type  text not null default 'discovery',
  call_at          timestamptz,
  -- What the model wrote, already checked: every claim about the person
  -- quotes profile_text word for word (packages/ai, t3-prep).
  brief            jsonb,
  brief_model      text,
  brief_at         timestamptz,
  created_by       uuid references auth.users (id) on delete set null,
  created_at       timestamptz not null default now(),
  unique (company_id, id),
  foreign key (company_id, account_id)
    references public.accounts (company_id, id) on delete set null (account_id)
);

create index call_preps_company_idx on public.call_preps (company_id, call_at);

comment on table public.call_preps is
  'Preparation for an upcoming call: who, their pasted public profile, and a quoted brief. Members read; the author or an owner changes.';

alter table public.call_preps enable row level security;

create policy "members read their company's preps"
  on public.call_preps for select to authenticated
  using ((select private.is_company_member(company_id)));


create function private.may_change_prep(p_prep public.call_preps)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.company_members m
     where m.company_id = p_prep.company_id and m.user_id = (select auth.uid())
       and (m.role = 'owner' or p_prep.created_by = (select auth.uid()))
  );
$$;


-- Save a new prep, or change one you may change (p_prep_id given).
create function public.save_call_prep(
  p_person_name     text,
  p_person_title    text        default null,
  p_linkedin_url    text        default null,
  p_profile_text    text        default null,
  p_account_id      uuid        default null,
  p_engagement_type text        default 'discovery',
  p_call_at         timestamptz default null,
  p_prep_id         uuid        default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company_id uuid := private.sole_company_of_caller();
  v_name       text := regexp_replace(trim(coalesce(p_person_name, '')), '\s+', ' ', 'g');
  v_title      text := nullif(trim(coalesce(p_person_title, '')), '');
  v_url        text := nullif(trim(coalesce(p_linkedin_url, '')), '');
  v_text       text := nullif(trim(coalesce(p_profile_text, '')), '');
  v_row        public.call_preps;
  v_id         uuid;
begin
  if not (select private.is_company_member(v_company_id)) then
    raise exception 'save_call_prep: not a member of a company' using errcode = '42501';
  end if;
  if length(v_name) not between 1 and 120 then
    raise exception 'save_call_prep: say who the call is with' using errcode = '22023';
  end if;
  if v_url is not null and v_url !~ '^https://([a-z]{2,3}\.)?linkedin\.com/in/[A-Za-z0-9_%-]{2,100}/?$' then
    raise exception 'save_call_prep: that is not a LinkedIn profile address (https://www.linkedin.com/in/…)' using errcode = '22023';
  end if;
  if v_text is not null and length(v_text) > 12000 then
    raise exception 'save_call_prep: the pasted profile is longer than 12,000 characters' using errcode = '22023';
  end if;
  if p_account_id is not null and not exists (
    select 1 from public.accounts a where a.id = p_account_id and a.company_id = v_company_id
  ) then
    raise exception 'save_call_prep: that customer was not found' using errcode = 'P0002';
  end if;
  if not exists (
    select 1 from public.criteria_definitions d
     where d.engagement_type = p_engagement_type and (d.company_id is null or d.company_id = v_company_id)
  ) then
    raise exception 'save_call_prep: no such scorecard' using errcode = '22023';
  end if;

  if p_prep_id is null then
    insert into public.call_preps
      (company_id, account_id, person_name, person_title, linkedin_url, profile_text, engagement_type, call_at, created_by)
    values
      (v_company_id, p_account_id, v_name, v_title, v_url, v_text, p_engagement_type, p_call_at, (select auth.uid()))
    returning id into v_id;
    return v_id;
  end if;

  select * into v_row from public.call_preps p where p.id = p_prep_id and p.company_id = v_company_id;
  if v_row.id is null then
    raise exception 'save_call_prep: prep not found' using errcode = 'P0002';
  end if;
  if not private.may_change_prep(v_row) then
    raise exception 'save_call_prep: only whoever wrote it, or an owner, can change it' using errcode = '42501';
  end if;
  update public.call_preps
     set account_id = p_account_id, person_name = v_name, person_title = v_title, linkedin_url = v_url,
         profile_text = v_text, engagement_type = p_engagement_type, call_at = p_call_at,
         -- A brief written from other words is not a brief of these.
         brief = case when v_text is distinct from v_row.profile_text or p_account_id is distinct from v_row.account_id
                      then null else brief end
   where id = p_prep_id;
  return p_prep_id;
end;
$$;

-- Store the checked brief. The author or an owner, as themselves.
create function public.set_call_prep_brief(p_prep_id uuid, p_brief jsonb, p_model text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.call_preps;
begin
  select * into v_row from public.call_preps p where p.id = p_prep_id;
  if v_row.id is null or not (select private.is_company_member(v_row.company_id)) then
    raise exception 'set_call_prep_brief: prep not found' using errcode = 'P0002';
  end if;
  if not private.may_change_prep(v_row) then
    raise exception 'set_call_prep_brief: only whoever wrote it, or an owner, can change it' using errcode = '42501';
  end if;
  if p_brief is null or jsonb_typeof(p_brief) <> 'object' then
    raise exception 'set_call_prep_brief: a brief is an object' using errcode = '22023';
  end if;
  update public.call_preps set brief = p_brief, brief_model = p_model, brief_at = now() where id = p_prep_id;
end;
$$;

create function public.delete_call_prep(p_prep_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.call_preps;
begin
  select * into v_row from public.call_preps p where p.id = p_prep_id;
  if v_row.id is null or not (select private.is_company_member(v_row.company_id)) then
    raise exception 'delete_call_prep: prep not found' using errcode = 'P0002';
  end if;
  if not private.may_change_prep(v_row) then
    raise exception 'delete_call_prep: only whoever wrote it, or an owner, can delete it' using errcode = '42501';
  end if;
  delete from public.call_preps where id = p_prep_id;
end;
$$;

revoke all on function public.save_call_prep(text, text, text, text, uuid, text, timestamptz, uuid) from public, anon;
revoke all on function public.set_call_prep_brief(uuid, jsonb, text) from public, anon;
revoke all on function public.delete_call_prep(uuid) from public, anon;
revoke all on function private.may_change_prep(public.call_preps) from public, anon;
grant execute on function public.save_call_prep(text, text, text, text, uuid, text, timestamptz, uuid) to authenticated;
grant execute on function public.set_call_prep_brief(uuid, jsonb, text) to authenticated;
grant execute on function public.delete_call_prep(uuid) to authenticated;


-- A closed company keeps nothing about the people it was meeting.
create function private.forget_preps_on_close()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.closed_at is not null and old.closed_at is null then
    delete from public.call_preps where company_id = new.id;
  end if;
  return new;
end;
$$;

create trigger companies_forget_preps_on_close
  after update of closed_at on public.companies
  for each row execute function private.forget_preps_on_close();
