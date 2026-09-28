-- Where a company's tickets go: its own tracker, connected by its owner.
--
-- P8 raised a ticket in one repository named in the web app's environment,
-- with one token, for every company. That was never configured, so no ticket
-- could be raised; and had it been, every brand's insights would have landed
-- in Tesserafy's repository rather than their own. A ticket belongs in the
-- tracker of the company whose customers said it.
--
-- GitHub first, the integration that already existed. `provider` is a column
-- rather than an assumption, so Jira or Linear is a new value and a new
-- client, not a new table.
--
-- The token is a secret that can write to the company's tracker, so it is
-- stored encrypted, by the web server, with a key only the web server holds
-- (TRACKER_TOKEN_KEY; ADR 0015). This database never sees it in the clear, a
-- row copied to another company does not decrypt there (the company is bound
-- into the encryption), and customers cannot select the column at all:
-- members read where tickets go and which token it is (the last four
-- characters), never the ciphertext. The one path to the ciphertext is
-- `tracker_for_ticket`, which the ticket route calls for an approved insight
-- in the caller's own company.

create table public.company_trackers (
  company_id       uuid primary key references public.companies (id) on delete cascade,
  provider         text not null check (provider in ('github')),
  -- For GitHub, owner/repository.
  target           text not null check (target ~ '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$'),
  token_ciphertext text not null check (token_ciphertext like 'v1:%'),
  -- The last four characters, so an owner can tell which token this is.
  token_hint       text not null check (length(token_hint) between 1 and 8),
  connected_by     uuid references auth.users (id) on delete set null,
  connected_at     timestamptz not null default now()
);

comment on table public.company_trackers is
  'Each company''s own tracker for tickets. The token is encrypted by the web server (ADR 0015).';

alter table public.company_trackers enable row level security;

create policy "members read their company's tracker"
  on public.company_trackers for select to authenticated
  using ((select private.is_company_member(company_id)));

create policy "admins read all trackers"
  on public.company_trackers for select to authenticated
  using ((select private.is_platform_admin()));

-- Column by column, so the ciphertext is not one of them.
revoke select on public.company_trackers from authenticated, anon;
grant select (company_id, provider, target, token_hint, connected_by, connected_at)
  on public.company_trackers to authenticated;


-- Who connected or disconnected which tracker, and when. Owners and operators
-- read it; the token never appears in it.
create table public.tracker_events (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies (id) on delete cascade,
  action      text not null check (action in ('connected', 'disconnected')),
  provider    text not null,
  target      text not null,
  actor       uuid references auth.users (id) on delete set null,
  at          timestamptz not null default now()
);

create index tracker_events_company_idx on public.tracker_events (company_id, at desc);

alter table public.tracker_events enable row level security;

create policy "owners read their company's tracker events"
  on public.tracker_events for select to authenticated
  using (exists (
    select 1 from public.company_members m
     where m.company_id = tracker_events.company_id
       and m.user_id = (select auth.uid())
       and m.role = 'owner'
  ));

create policy "admins read all tracker events"
  on public.tracker_events for select to authenticated
  using ((select private.is_platform_admin()));


create function public.connect_tracker(
  p_provider         text,
  p_target           text,
  p_token_ciphertext text,
  p_token_hint       text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company_id uuid := private.sole_company_of_caller();
begin
  if not exists (
    select 1 from public.company_members m
     where m.company_id = v_company_id and m.user_id = (select auth.uid()) and m.role = 'owner'
  ) then
    raise exception 'connect_tracker: only an owner can connect a tracker' using errcode = '42501';
  end if;

  insert into public.tracker_events (company_id, action, provider, target, actor)
  values (v_company_id, 'connected', p_provider, p_target, (select auth.uid()));

  insert into public.company_trackers (company_id, provider, target, token_ciphertext, token_hint, connected_by)
  values (v_company_id, p_provider, p_target, p_token_ciphertext, p_token_hint, (select auth.uid()))
  on conflict (company_id) do update
     set provider = excluded.provider,
         target = excluded.target,
         token_ciphertext = excluded.token_ciphertext,
         token_hint = excluded.token_hint,
         connected_by = excluded.connected_by,
         connected_at = now();
end;
$$;

revoke all on function public.connect_tracker(text, text, text, text) from public, anon;
grant execute on function public.connect_tracker(text, text, text, text) to authenticated;


create function public.disconnect_tracker()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company_id uuid := private.sole_company_of_caller();
  v_row public.company_trackers;
begin
  if not exists (
    select 1 from public.company_members m
     where m.company_id = v_company_id and m.user_id = (select auth.uid()) and m.role = 'owner'
  ) then
    raise exception 'disconnect_tracker: only an owner can disconnect a tracker' using errcode = '42501';
  end if;

  delete from public.company_trackers where company_id = v_company_id returning * into v_row;
  if v_row.company_id is null then
    raise exception 'disconnect_tracker: no tracker is connected' using errcode = '22023';
  end if;

  insert into public.tracker_events (company_id, action, provider, target, actor)
  values (v_company_id, 'disconnected', v_row.provider, v_row.target, (select auth.uid()));
end;
$$;

revoke all on function public.disconnect_tracker() from public, anon;
grant execute on function public.disconnect_tracker() to authenticated;


-- A closed company keeps no key to anyone's tracker. Closing keeps the company
-- row as a tombstone (close_company), so the cascade never fires; this does
-- what it would have, and says so in the company's tracker log.
create function private.forget_tracker_on_close()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.company_trackers;
begin
  if new.closed_at is not null and old.closed_at is null then
    delete from public.company_trackers where company_id = new.id returning * into v_row;
    if v_row.company_id is not null then
      insert into public.tracker_events (company_id, action, provider, target, actor)
      values (new.id, 'disconnected', v_row.provider, v_row.target, (select auth.uid()));
    end if;
  end if;
  return new;
end;
$$;

create trigger companies_forget_tracker_on_close
  after update of closed_at on public.companies
  for each row execute function private.forget_tracker_on_close();


-- The one way to the ciphertext: for an approved insight, in the caller's own
-- company. What comes back is still encrypted; only the web server can use it.
create function public.tracker_for_ticket(p_insight_id uuid)
returns table (provider text, target text, token_ciphertext text, company_id uuid)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_company_id uuid;
  v_status text;
begin
  select i.company_id, i.status into v_company_id, v_status
    from public.insights i where i.id = p_insight_id;

  if v_company_id is null or not (select private.is_company_member(v_company_id)) then
    raise exception 'tracker_for_ticket: insight not found' using errcode = '42501';
  end if;
  if v_status <> 'approved' then
    raise exception 'tracker_for_ticket: the insight is %; approve it first', v_status using errcode = '22023';
  end if;

  return query
    select t.provider, t.target, t.token_ciphertext, t.company_id
      from public.company_trackers t where t.company_id = v_company_id;
end;
$$;

revoke all on function public.tracker_for_ticket(uuid) from public, anon;
grant execute on function public.tracker_for_ticket(uuid) to authenticated;
