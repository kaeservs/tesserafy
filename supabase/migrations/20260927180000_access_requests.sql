-- An owner asking for someone to be added, and the operator answering.
--
-- Adding a person creates an account, which needs the service-role key, which
-- only the operator console holds (invariant 3, ADR 0012). So an owner cannot
-- add a teammate themselves — and until now could not even ask from inside
-- the product: Settings said "ask Tesserafy support" and left them to find
-- out how. This is the asking half. The console already has the doing half.
--
-- An owner records the request against their own company (from the session,
-- never an argument). The operator sees it, adds the person through the same
-- provisioning path as always — recorded, one-time link — and closes it; or
-- declines it with a reason the owner can read. Nothing here creates an
-- account or a membership: a request is a request.

create table public.access_requests (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies (id) on delete cascade,
  requested_by    uuid references auth.users (id) on delete set null,
  email           text not null check (email = lower(trim(email)) and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  role            text not null check (role in ('owner', 'member')),
  note            text check (note is null or length(note) <= 500),
  created_at      timestamptz not null default now(),
  resolved_at     timestamptz,
  resolved_by     uuid references auth.users (id) on delete set null,
  resolution      text check (resolution in ('added', 'declined')),
  -- Why it was declined, for the owner to read. Not required when added.
  resolution_note text check (resolution_note is null or length(resolution_note) <= 500),
  check ((resolved_at is null) = (resolution is null))
);

-- One open request per address per company: asking twice is not two requests.
create unique index access_requests_one_open
  on public.access_requests (company_id, email) where resolved_at is null;
create index access_requests_open_idx on public.access_requests (created_at) where resolved_at is null;

comment on table public.access_requests is
  'An owner asking for someone to be added to their company, and how the operator answered. Creates nothing by itself.';

alter table public.access_requests enable row level security;

create policy "owners read their company's requests"
  on public.access_requests for select to authenticated
  using (exists (
    select 1 from public.company_members m
     where m.company_id = access_requests.company_id
       and m.user_id = (select auth.uid())
       and m.role = 'owner'
  ));

create policy "admins read all requests"
  on public.access_requests for select to authenticated
  using ((select private.is_platform_admin()));


create function public.request_teammate(p_email text, p_role text, p_note text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid        uuid := (select auth.uid());
  v_company_id uuid := private.sole_company_of_caller();
  v_email      text := lower(trim(coalesce(p_email, '')));
  v_id         uuid;
begin
  if not exists (
    select 1 from public.company_members m
     where m.company_id = v_company_id and m.user_id = v_uid and m.role = 'owner'
  ) then
    raise exception 'request_teammate: only an owner can ask for someone to be added' using errcode = '42501';
  end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'request_teammate: that is not an email address' using errcode = '22023';
  end if;
  if p_role is null or p_role not in ('owner', 'member') then
    raise exception 'request_teammate: role is owner or member' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.company_members m join auth.users u on u.id = m.user_id
     where m.company_id = v_company_id and lower(u.email) = v_email
  ) then
    raise exception 'request_teammate: % already has access', v_email using errcode = '22023';
  end if;
  if exists (
    select 1 from public.access_requests r
     where r.company_id = v_company_id and r.email = v_email and r.resolved_at is null
  ) then
    raise exception 'request_teammate: % has already been asked for', v_email using errcode = '22023';
  end if;

  insert into public.access_requests (company_id, requested_by, email, role, note)
  values (v_company_id, v_uid, v_email, p_role, nullif(trim(coalesce(p_note, '')), ''))
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.request_teammate(text, text, text) from public, anon;
grant execute on function public.request_teammate(text, text, text) to authenticated;


-- The operator's answer. Added only once the person really is in the
-- company — the console runs provisioning first, and this checks rather than
-- trusts that it worked.
create function public.resolve_access_request(
  p_id         uuid,
  p_resolution text,
  p_note       text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.access_requests;
begin
  if not (select private.is_platform_admin()) then
    raise exception 'resolve_access_request: not a platform admin' using errcode = '42501';
  end if;

  select * into v_row from public.access_requests where id = p_id for update;
  if v_row.id is null or v_row.resolved_at is not null then
    raise exception 'resolve_access_request: no open request %', p_id using errcode = '22023';
  end if;
  if p_resolution is null or p_resolution not in ('added', 'declined') then
    raise exception 'resolve_access_request: added or declined' using errcode = '22023';
  end if;
  if p_resolution = 'declined' and length(trim(coalesce(p_note, ''))) = 0 then
    raise exception 'resolve_access_request: say why, for the owner who asked' using errcode = '22023';
  end if;
  if p_resolution = 'added' and not exists (
    select 1 from public.company_members m join auth.users u on u.id = m.user_id
     where m.company_id = v_row.company_id and lower(u.email) = v_row.email
  ) then
    raise exception 'resolve_access_request: % is not in the company yet', v_row.email using errcode = '22023';
  end if;

  update public.access_requests
     set resolved_at = now(),
         resolved_by = (select auth.uid()),
         resolution = p_resolution,
         resolution_note = nullif(trim(coalesce(p_note, '')), '')
   where id = p_id;
end;
$$;

revoke all on function public.resolve_access_request(uuid, text, text) from public, anon;
grant execute on function public.resolve_access_request(uuid, text, text) to authenticated;


-- The console's list: open requests with the company's name and who asked,
-- which an operator cannot read through RLS (they are in no company).
create function public.admin_access_requests()
returns table (
  id           uuid,
  company_id   uuid,
  company_name text,
  email        text,
  role         text,
  note         text,
  requested_by text,
  created_at   timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (select private.is_platform_admin()) then
    raise exception 'admin_access_requests: not a platform admin' using errcode = '42501';
  end if;

  return query
  select r.id, r.company_id, c.name, r.email, r.role, r.note,
         coalesce(u.email::text, 'a deleted account'), r.created_at
    from public.access_requests r
    join public.companies c on c.id = r.company_id
    left join auth.users u on u.id = r.requested_by
   where r.resolved_at is null
   order by r.created_at;
end;
$$;

revoke all on function public.admin_access_requests() from public, anon;
grant execute on function public.admin_access_requests() to authenticated;
