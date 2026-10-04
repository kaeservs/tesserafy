-- Which overlay each person runs, so an operator can see who is behind the
-- newest release (an overlay that predates a server change — the one-time
-- recording agreement, say — cannot start a call until it is updated).
--
-- The overlay names its version and platform on every request; the web app
-- records them when the overlay reads its setup, at sign-in and before each
-- call. One row a person and platform. A version, a platform and a time:
-- nothing about the computer or the calls.

create table public.overlay_seen (
  user_id   uuid not null references auth.users (id) on delete cascade,
  platform  text not null check (platform in ('win32', 'darwin', 'linux')),
  version   text not null check (version ~ '^[0-9]{1,4}\.[0-9]{1,4}\.[0-9]{1,4}$'),
  seen_at   timestamptz not null default now(),
  primary key (user_id, platform)
);

comment on table public.overlay_seen is
  'Which overlay version each person last ran, per platform, and when. Version and platform only.';

alter table public.overlay_seen enable row level security;

create policy "people read their own overlay"
  on public.overlay_seen for select to authenticated
  using (user_id = (select auth.uid()));

-- As the signed-in person; a version or platform that is not one is refused.
create function public.record_overlay_seen(p_version text, p_platform text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'record_overlay_seen: not signed in' using errcode = '42501';
  end if;
  if p_version is null or p_version !~ '^[0-9]{1,4}\.[0-9]{1,4}\.[0-9]{1,4}$'
     or p_platform is null or p_platform not in ('win32', 'darwin', 'linux') then
    raise exception 'record_overlay_seen: not a version and platform' using errcode = '22023';
  end if;
  insert into public.overlay_seen (user_id, platform, version, seen_at)
  values ((select auth.uid()), p_platform, p_version, now())
  on conflict (user_id, platform) do update set version = excluded.version, seen_at = excluded.seen_at;
end;
$$;

-- The console: every person who has run the overlay, with their company.
create function public.admin_overlay_seen()
returns table (
  email      text,
  company    text,
  platform   text,
  version    text,
  seen_at    timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (select private.is_platform_admin()) then
    raise exception 'admin_overlay_seen: not a platform admin' using errcode = '42501';
  end if;
  return query
  select u.email::text,
         (select c.name from public.company_members m join public.companies c on c.id = m.company_id
           where m.user_id = s.user_id order by m.created_at limit 1),
         s.platform, s.version, s.seen_at
    from public.overlay_seen s
    join auth.users u on u.id = s.user_id
   order by s.seen_at desc;
end;
$$;

revoke all on function public.record_overlay_seen(text, text) from public, anon;
revoke all on function public.admin_overlay_seen() from public, anon;
grant execute on function public.record_overlay_seen(text, text) to authenticated;
grant execute on function public.admin_overlay_seen() to authenticated;
