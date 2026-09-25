-- An owner taking a full copy of their company's data, recorded first.
--
-- A pilot that ends should be able to take its data with it before the
-- company is closed, and a customer asking "what do you hold about us" should
-- get the answer as a file rather than as an email thread. The export runs
-- in the web app, under the owner's own session, so RLS decides what it can
-- read; this migration only records that it happened.
--
-- Recorded before anything is read, in the order support sessions and
-- account provisioning already use: a copy of every call leaving the product
-- is exactly the event the data-protection note tracks, and a record written
-- afterwards is one a crash can skip. An export that fails after this row is
-- still an export someone asked for, which is what the row says.
--
-- Owners only, for the reason only owners erase and set retention: it is the
-- whole company's data, and the owner is the person answerable for it.

create table public.company_exports (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references public.companies (id) on delete cascade,
  user_id        uuid references auth.users (id) on delete set null,
  -- As it was at the time: the account may be deleted later.
  email          text not null,
  conversations  integer not null,
  requested_at   timestamptz not null default now()
);

create index company_exports_company_idx on public.company_exports (company_id, requested_at desc);

comment on table public.company_exports is
  'One row per full export an owner requested, written before any data is read. Append-only.';

alter table public.company_exports enable row level security;

create policy "owners read their company's exports"
  on public.company_exports for select to authenticated
  using (exists (
    select 1 from public.company_members m
     where m.company_id = company_exports.company_id
       and m.user_id = (select auth.uid())
       and m.role = 'owner'
  ));

create policy "admins read all exports"
  on public.company_exports for select to authenticated
  using ((select private.is_platform_admin()));


create function public.record_company_export()
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid        uuid := (select auth.uid());
  v_company_id uuid := private.sole_company_of_caller();
  v_id         uuid;
begin
  if not exists (
    select 1 from public.company_members m
     where m.company_id = v_company_id and m.user_id = v_uid and m.role = 'owner'
  ) then
    raise exception 'record_company_export: only an owner can export the company''s data'
      using errcode = '42501';
  end if;

  insert into public.company_exports (company_id, user_id, email, conversations)
  select v_company_id, v_uid, u.email,
         (select count(*)::integer from public.conversations c where c.company_id = v_company_id)
    from auth.users u where u.id = v_uid
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.record_company_export() from public, anon;
grant execute on function public.record_company_export() to authenticated;
