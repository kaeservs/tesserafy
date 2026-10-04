-- Calendar sync: each person connects their own Google or Microsoft calendar,
-- read-only, and their upcoming meetings with people outside the company show
-- on Prepare and Home, one click from a call prep (ADR 0021).
--
-- Each person's own, never the company's: a calendar is personal. What is
-- kept is the least that makes a prep: title, time, attendees (address and
-- name), the meeting link — only for meetings with someone outside the
-- person's own email domain, and only the next fourteen days. Descriptions are
-- never read into the product. The connection's refresh token is sealed by the
-- web server before it gets here (lib/sealed.ts, CALENDAR_TOKEN_KEY), so this
-- table holds bytes, not a token.

create table public.calendar_connections (
  user_id           uuid not null references auth.users (id) on delete cascade,
  company_id        uuid not null references public.companies (id) on delete cascade,
  provider          text not null check (provider in ('google', 'microsoft')),
  account_email     text not null check (length(account_email) between 3 and 320),
  token_ciphertext  text not null check (token_ciphertext like 'v1:%' and length(token_ciphertext) <= 8000),
  connected_at      timestamptz not null default now(),
  last_synced_at    timestamptz,
  last_error        text check (last_error is null or length(last_error) <= 300),
  primary key (user_id, provider)
);

create table public.calendar_events (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  company_id   uuid not null references public.companies (id) on delete cascade,
  provider     text not null check (provider in ('google', 'microsoft')),
  external_id  text not null check (length(external_id) between 1 and 1024),
  title        text not null check (length(title) <= 300),
  starts_at    timestamptz not null,
  ends_at      timestamptz not null,
  attendees    jsonb not null default '[]'::jsonb
               check (jsonb_typeof(attendees) = 'array' and jsonb_array_length(attendees) <= 50),
  meeting_url  text check (meeting_url is null or (meeting_url ~ '^https://' and length(meeting_url) <= 2000)),
  prep_id      uuid references public.call_preps (id) on delete set null,
  synced_at    timestamptz not null default now(),
  unique (user_id, provider, external_id)
);

create index calendar_events_upcoming_idx on public.calendar_events (user_id, starts_at);

comment on table public.calendar_connections is
  'Each person''s connected calendar: provider, address, and a refresh token sealed by the web server.';
comment on table public.calendar_events is
  'A person''s upcoming meetings with people outside the company, from their calendar: title, time, attendees, link.';

alter table public.calendar_connections enable row level security;
alter table public.calendar_events enable row level security;

create policy "people read their own calendar connections"
  on public.calendar_connections for select to authenticated
  using (user_id = (select auth.uid()));
create policy "people read their own calendar events"
  on public.calendar_events for select to authenticated
  using (user_id = (select auth.uid()));


-- Connect (or reconnect) a calendar, as the person, for their company.
create function public.connect_calendar(p_provider text, p_account_email text, p_token_ciphertext text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid        uuid := (select auth.uid());
  v_company_id uuid := private.sole_company_of_caller();
begin
  if v_uid is null or not (select private.is_company_member(v_company_id)) then
    raise exception 'connect_calendar: not a member of a company' using errcode = '42501';
  end if;
  insert into public.calendar_connections (user_id, company_id, provider, account_email, token_ciphertext)
  values (v_uid, v_company_id, p_provider, trim(p_account_email), p_token_ciphertext)
  on conflict (user_id, provider) do update
    set account_email = excluded.account_email,
        token_ciphertext = excluded.token_ciphertext,
        company_id = excluded.company_id,
        connected_at = now(),
        last_error = null;
end;
$$;

-- Disconnect: the connection and every meeting it brought in go.
create function public.disconnect_calendar(p_provider text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.calendar_events where user_id = (select auth.uid()) and provider = p_provider;
  delete from public.calendar_connections where user_id = (select auth.uid()) and provider = p_provider;
end;
$$;

-- A sync's result: the upcoming meetings as the provider has them now (the
-- web app has already kept only the external ones), a rotated token if the
-- provider issued one, or the error that stopped it. Meetings that are no
-- longer there — cancelled, or no longer with anyone outside — are removed;
-- a prep already made from one stays, and only loses the link.
create function public.record_calendar_sync(
  p_provider         text,
  p_events           jsonb,
  p_token_ciphertext text default null,
  p_error            text default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid        uuid := (select auth.uid());
  v_company_id uuid;
  v_event      jsonb;
  v_ids        text[] := '{}';
  v_url        text;
  v_count      integer := 0;
begin
  select c.company_id into v_company_id from public.calendar_connections c
   where c.user_id = v_uid and c.provider = p_provider;
  if v_company_id is null then
    raise exception 'record_calendar_sync: no such calendar connected' using errcode = 'P0002';
  end if;

  if p_error is not null then
    update public.calendar_connections set last_error = left(p_error, 300), last_synced_at = now()
     where user_id = v_uid and provider = p_provider;
    return 0;
  end if;
  if jsonb_typeof(p_events) is distinct from 'array' or jsonb_array_length(p_events) > 500 then
    raise exception 'record_calendar_sync: events are a list of at most 500' using errcode = '22023';
  end if;

  for v_event in select * from jsonb_array_elements(p_events) loop
    v_url := v_event ->> 'meeting_url';
    if v_url is not null and (v_url !~ '^https://' or length(v_url) > 2000) then
      v_url := null;
    end if;
    insert into public.calendar_events
      (user_id, company_id, provider, external_id, title, starts_at, ends_at, attendees, meeting_url, synced_at)
    values
      (v_uid, v_company_id, p_provider, v_event ->> 'external_id', left(coalesce(v_event ->> 'title', ''), 300),
       (v_event ->> 'starts_at')::timestamptz, (v_event ->> 'ends_at')::timestamptz,
       coalesce(v_event -> 'attendees', '[]'::jsonb), v_url, now())
    on conflict (user_id, provider, external_id) do update
      set title = excluded.title, starts_at = excluded.starts_at, ends_at = excluded.ends_at,
          attendees = excluded.attendees, meeting_url = excluded.meeting_url, synced_at = now(),
          company_id = excluded.company_id;
    v_ids := v_ids || (v_event ->> 'external_id');
    v_count := v_count + 1;
  end loop;

  delete from public.calendar_events e
   where e.user_id = v_uid and e.provider = p_provider
     and (e.ends_at < now() - interval '1 day' or not (e.external_id = any (v_ids)));

  update public.calendar_connections
     set last_synced_at = now(), last_error = null,
         token_ciphertext = coalesce(p_token_ciphertext, token_ciphertext)
   where user_id = v_uid and provider = p_provider;
  return v_count;
end;
$$;

-- A prep made from a meeting: the link, so the meeting shows "Open prep".
create function public.link_calendar_event(p_event_id uuid, p_prep_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.calendar_events e where e.id = p_event_id and e.user_id = (select auth.uid()))
     or not exists (select 1 from public.call_preps p where p.id = p_prep_id and p.created_by = (select auth.uid())) then
    raise exception 'link_calendar_event: not your meeting or not your prep' using errcode = '42501';
  end if;
  update public.calendar_events set prep_id = p_prep_id where id = p_event_id;
end;
$$;

revoke all on function public.connect_calendar(text, text, text) from public, anon;
revoke all on function public.disconnect_calendar(text) from public, anon;
revoke all on function public.record_calendar_sync(text, jsonb, text, text) from public, anon;
revoke all on function public.link_calendar_event(uuid, uuid) from public, anon;
grant execute on function public.connect_calendar(text, text, text) to authenticated;
grant execute on function public.disconnect_calendar(text) to authenticated;
grant execute on function public.record_calendar_sync(text, jsonb, text, text) to authenticated;
grant execute on function public.link_calendar_event(uuid, uuid) to authenticated;
