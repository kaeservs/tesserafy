-- The sample call: a made-up discovery call a new company imports in one
-- click, to see a scorecard, its quotes and who talked before they have a
-- transcript of their own.
--
-- A trial allows three imported calls. Charging the sample as one would spend
-- a third of a trial on a demonstration, so the web route does not charge it:
-- the one import that skips the plan's allowance, and bounded here so it stays
-- one. Each company gets one sample, ever — a unique index, not a check in the
-- app, so two clicks, two tabs or a direct call all meet the same refusal —
-- and deleting it does not bring the offer back. The words are the app's
-- (apps/web/lib/sample-call.ts); what makes it free is that only the route
-- scores it, and the route only ever sends those words.
--
-- Nobody was recorded, so the call does not claim anyone agreed to be. Its
-- consent statement says what it is, in the column that records what was
-- confirmed about every other call.

alter table public.conversations
  add column is_sample boolean not null default false;

comment on column public.conversations.is_sample is
  'The sample call Tesserafy offers a new company: invented, not recorded, one per company.';

create unique index conversations_one_sample_idx
  on public.conversations (company_id) where is_sample;

-- A company that has had its sample, even if it has since deleted it.
alter table public.companies
  add column sample_imported_at timestamptz;

create function public.import_sample_call(p_title text, p_segments jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company_id uuid := private.sole_company_of_caller();
  v_id         uuid;
begin
  if not (select private.is_company_member(v_company_id)) then
    raise exception 'import_sample_call: not a member of a company' using errcode = '42501';
  end if;
  if exists (select 1 from public.companies c where c.id = v_company_id and c.sample_imported_at is not null) then
    raise exception 'import_sample_call: your company has already had the sample call' using errcode = '23505';
  end if;

  v_id := public.import_conversation(
    p_title             => p_title,
    p_segments          => p_segments,
    p_engagement_type   => 'discovery',
    p_criteria_version  => 1,
    p_consent_statement => 'A sample call written by Tesserafy. Nobody was recorded; the people and companies in it are invented.'
  );
  update public.conversations set is_sample = true where id = v_id;
  update public.companies set sample_imported_at = now() where id = v_company_id;
  return v_id;
exception
  when unique_violation then
    raise exception 'import_sample_call: your company has already had the sample call' using errcode = '23505';
end;
$$;

revoke all on function public.import_sample_call(text, jsonb) from public, anon;
grant execute on function public.import_sample_call(text, jsonb) to authenticated;
