-- Recording consent, agreed once rather than ticked every call (ADR 0020).
--
-- The overlay asked, before every call, that the seller tick "everyone on this
-- call has been told… and agreed". The owner chose Cluely's model instead: a
-- person agrees once — to tell everyone on every call they record, and that
-- doing so is their legal responsibility — and every call they record cites
-- that agreement. The record is what places the responsibility on them, so it
-- is kept with care:
--
--   * one row per person, company and version of the Terms, holding the exact
--     words agreed to, when, and where (overlay or web);
--   * the person is a plain id and an address, not a foreign key, so the
--     record outlives the account (ADR 0013 allows a plain id);
--   * the person reads their own, the company's owners read the company's,
--     operators read every one;
--   * start_live_conversation refuses a call from someone with no agreement,
--     however it is asked.
--
-- Imports keep their per-upload confirmation: that is a statement about one
-- recording that already happened, not a promise about future calls.

create table public.recording_agreements (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null,
  email          text not null,
  company_id     uuid not null references public.companies (id) on delete cascade,
  terms_version  text not null check (length(trim(terms_version)) between 1 and 40),
  statement      text not null check (length(trim(statement)) between 20 and 2000),
  surface        text not null check (surface in ('overlay', 'web')),
  agreed_at      timestamptz not null default now(),
  unique (user_id, company_id, terms_version)
);

create index recording_agreements_company_idx on public.recording_agreements (company_id, agreed_at desc);

comment on table public.recording_agreements is
  'Each person''s one-time agreement to tell everyone on every call they record: the words, the Terms version, when. Outlives the account.';

alter table public.recording_agreements enable row level security;

create policy "people read their own agreements"
  on public.recording_agreements for select to authenticated
  using (user_id = (select auth.uid()));
create policy "owners read their company's agreements"
  on public.recording_agreements for select to authenticated
  using (exists (
    select 1 from public.company_members m
     where m.company_id = recording_agreements.company_id and m.user_id = (select auth.uid()) and m.role = 'owner'
  ));
create policy "operators read every agreement"
  on public.recording_agreements for select to authenticated
  using ((select private.is_platform_admin()));


-- Agree, as the signed-in person, for their company. Agreeing twice to the
-- same version keeps the first.
create function public.agree_to_recording(p_terms_version text, p_statement text, p_surface text)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid        uuid := (select auth.uid());
  v_company_id uuid := private.sole_company_of_caller();
  v_at         timestamptz;
begin
  if v_uid is null or not (select private.is_company_member(v_company_id)) then
    raise exception 'agree_to_recording: not a member of a company' using errcode = '42501';
  end if;
  insert into public.recording_agreements (user_id, email, company_id, terms_version, statement, surface)
  values (v_uid, (select u.email from auth.users u where u.id = v_uid), v_company_id,
          trim(p_terms_version), trim(p_statement), p_surface)
  on conflict (user_id, company_id, terms_version) do nothing;
  select a.agreed_at into v_at from public.recording_agreements a
   where a.user_id = v_uid and a.company_id = v_company_id and a.terms_version = trim(p_terms_version);
  return v_at;
end;
$$;

revoke all on function public.agree_to_recording(text, text, text) from public, anon;
grant execute on function public.agree_to_recording(text, text, text) to authenticated;


-- A live call needs its recorder's agreement on file, as well as the
-- statement the route writes from it.
create or replace function public.start_live_conversation(
  p_title             text,
  p_engagement_type   text    default 'discovery',
  p_criteria_version  integer default 1,
  p_company_id        uuid    default null,
  p_consent_statement text    default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company_id uuid;
  v_id         uuid;
  v_statement  text := nullif(trim(coalesce(p_consent_statement, '')), '');
begin
  v_company_id := coalesce(p_company_id, private.sole_company_of_caller());

  if not (select private.is_company_member(v_company_id)) then
    raise exception 'start_live_conversation: not a member of that company'
      using errcode = '42501';
  end if;
  if p_title is null or length(trim(p_title)) = 0 then
    raise exception 'start_live_conversation: a title is required'
      using errcode = '22023';
  end if;
  if v_statement is null then
    raise exception 'start_live_conversation: confirm that everyone on the call agreed to be recorded'
      using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.recording_agreements a
     where a.user_id = (select auth.uid()) and a.company_id = v_company_id
  ) then
    raise exception 'start_live_conversation: agree once to tell everyone on every call you record'
      using errcode = '22023';
  end if;

  insert into public.conversations
    (company_id, title, occurred_at, engagement_type, criteria_version,
     consent_statement, consent_confirmed_by, consent_confirmed_at, added_by, captured_live)
  values
    (v_company_id, trim(p_title), now(), p_engagement_type, p_criteria_version,
     v_statement, auth.uid(), now(), auth.uid(), true)
  returning id into v_id;

  return v_id;
end;
$$;
