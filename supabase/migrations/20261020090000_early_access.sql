-- The early-access list: who asked to be told when Tesserafy opens, from the
-- landing page, while sign-up is closed (it opens once email works).
--
-- A visitor is not signed in, so this is the one table written without an
-- account; it is written only through request_early_access, which takes an
-- address, a company and what they would use it for, and nothing else. Three
-- things stand between it and a flood: one row an address (asking twice is
-- answered the same as once, so the form cannot be used to learn who is on the
-- list), a cap on requests an hour across everyone, and a hidden field on the
-- page that only a bot fills in (the page drops those before they get here).
--
-- Operators read the list and mark who they invited; nobody else reads it.

create table public.early_access (
  id          uuid primary key default gen_random_uuid(),
  email       text not null check (email ~* '^[^@\s]{1,64}@[^@\s]{1,255}\.[^@\s]{2,}$' and length(email) <= 320),
  company     text check (company is null or length(trim(company)) between 1 and 120),
  use_case    text check (use_case is null or use_case in ('sales', 'onboarding', 'support', 'other')),
  created_at  timestamptz not null default now(),
  invited_at  timestamptz,
  invited_by  uuid references auth.users (id) on delete set null
);

create unique index early_access_email_idx on public.early_access (lower(email));

comment on table public.early_access is
  'Who asked to be told when sign-up opens, from the landing page. Used only to invite them.';

alter table public.early_access enable row level security;

-- A visitor writes only through the function below and never touches the
-- table itself; RLS would only hide the rows, this refuses the table.
revoke all on public.early_access from anon;

create policy "operators read the early-access list"
  on public.early_access for select to authenticated
  using ((select private.is_platform_admin()));


create function public.request_early_access(p_email text, p_company text default null, p_use_case text default null)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
begin
  if v_email !~* '^[^@\s]{1,64}@[^@\s]{1,255}\.[^@\s]{2,}$' or length(v_email) > 320 then
    raise exception 'request_early_access: that is not an email address' using errcode = '22023';
  end if;
  if (select count(*) from public.early_access e where e.created_at > now() - interval '1 hour') >= 60 then
    raise exception 'request_early_access: too many requests just now; try again in an hour' using errcode = '54000';
  end if;
  insert into public.early_access (email, company, use_case)
  values (v_email, nullif(left(trim(coalesce(p_company, '')), 120), ''),
          case when p_use_case in ('sales', 'onboarding', 'support', 'other') then p_use_case end)
  on conflict ((lower(email))) do nothing;
  return true;
end;
$$;

-- An operator marks someone invited (or not, to undo a slip).
create function public.admin_mark_early_access(p_id uuid, p_invited boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not (select private.is_platform_admin()) then
    raise exception 'admin_mark_early_access: operators only' using errcode = '42501';
  end if;
  update public.early_access
     set invited_at = case when p_invited then now() end,
         invited_by = case when p_invited then (select auth.uid()) end
   where id = p_id;
end;
$$;

revoke all on function public.request_early_access(text, text, text) from public;
revoke all on function public.admin_mark_early_access(uuid, boolean) from public, anon;
grant execute on function public.request_early_access(text, text, text) to anon, authenticated;
grant execute on function public.admin_mark_early_access(uuid, boolean) to authenticated;
