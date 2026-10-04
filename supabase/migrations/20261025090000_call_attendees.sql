-- A call's meeting: who from outside was invited, kept with the call (ADR 0026).
--
-- Calendar meetings are each person's own and leave the calendar a day after
-- they end (ADR 0021), so whoever drafts the call's follow-up or logs it to
-- the CRM — often a colleague — could not see who was on it. When a call
-- starts, the meeting it is in is found in the caller's own calendar and its
-- outside attendees (address and name, nothing else) are copied onto the call,
-- where the company can read them, as it reads the call. They go with the
-- call when it is erased.
--
-- Found by the database, never named by the client: the caller's meeting that
-- is under way, or starts within fifteen minutes, when the call begins. If the
-- call has no customer yet and one of the company's customers has an
-- attendee's email domain, that becomes the call's customer.

create table public.call_attendees (
  company_id       uuid not null references public.companies (id) on delete cascade,
  conversation_id  uuid not null,
  email            text not null check (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' and length(email) <= 320),
  name             text check (name is null or length(name) <= 200),
  meeting_title    text check (meeting_title is null or length(meeting_title) <= 300),
  primary key (conversation_id, email),
  foreign key (company_id, conversation_id)
    references public.conversations (company_id, id) on delete cascade
);

comment on table public.call_attendees is
  'Who from outside was invited to a call''s meeting, copied from the caller''s calendar when the call started (ADR 0026).';

alter table public.call_attendees enable row level security;

create policy "members read their company's call attendees"
  on public.call_attendees for select to authenticated
  using ((select private.is_company_member(company_id)));


create function public.link_call_to_meeting(p_conversation_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid      uuid := (select auth.uid());
  v_call     public.conversations;
  v_at       timestamptz;
  v_event    public.calendar_events;
  v_count    integer;
  v_account  uuid;
begin
  select * into v_call from public.conversations c where c.id = p_conversation_id;
  if v_uid is null or v_call.id is null or not (select private.is_company_member(v_call.company_id)) then
    raise exception 'link_call_to_meeting: call not found' using errcode = 'P0002';
  end if;
  v_at := coalesce(v_call.occurred_at, v_call.created_at);

  -- The caller's own meeting at that time: under way, or about to start.
  select * into v_event from public.calendar_events e
   where e.user_id = v_uid and e.company_id = v_call.company_id
     and e.starts_at - interval '15 minutes' <= v_at and v_at <= e.ends_at
   order by abs(extract(epoch from (e.starts_at - v_at)))
   limit 1;
  if v_event.id is null then
    return 0;
  end if;

  insert into public.call_attendees (company_id, conversation_id, email, name, meeting_title)
  select v_call.company_id, v_call.id, lower(trim(a ->> 'email')), left(nullif(trim(a ->> 'name'), ''), 200), left(v_event.title, 300)
    from jsonb_array_elements(v_event.attendees) as a
   where coalesce(a ->> 'email', '') ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' and length(a ->> 'email') <= 320
  on conflict (conversation_id, email) do nothing;
  get diagnostics v_count = row_count;

  if v_call.account_id is null then
    select acc.id into v_account
      from public.call_attendees t
      join public.accounts acc
        on acc.company_id = v_call.company_id and lower(acc.domain) = split_part(t.email, '@', 2)
     where t.conversation_id = v_call.id
     limit 1;
    if v_account is not null then
      update public.conversations set account_id = v_account where id = v_call.id;
    end if;
  end if;
  return v_count;
end;
$$;

revoke all on function public.link_call_to_meeting(uuid) from public, anon;
grant execute on function public.link_call_to_meeting(uuid) to authenticated;
