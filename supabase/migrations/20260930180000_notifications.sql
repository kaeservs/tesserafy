-- Notifications, inside the product.
--
-- There is no email yet (Resend is not set up), so nobody learns that
-- anything happened unless they go and look. A bell does not replace email,
-- but it covers the three moments people most needed to hear about:
--
--   insight_proposed    a new insight waits for approval       → the company's owners
--   note_on_your_call   a colleague noted a moment on your call → whoever added the call
--   request_answered    your teammate request was answered      → the owner who asked
--
-- A notification holds references, never copies. The page reads the insight's
-- title, the note and the call's title when it renders, and every reference
-- cascades: erase a call and its notifications go with it, delete a note and
-- the notification about it goes. A notification that quoted a title would be
-- one more copy for erasure to miss.
--
-- Written only by triggers, as definer, so no client can notify anyone of
-- anything; read only by their recipient, while a member of the company.
-- Nobody is notified of their own action.

create table public.notifications (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references public.companies (id) on delete cascade,
  user_id           uuid not null references auth.users (id) on delete cascade,
  kind              text not null check (kind in ('insight_proposed', 'note_on_your_call', 'request_answered')),
  insight_id        uuid references public.insights (id) on delete cascade,
  conversation_id   uuid references public.conversations (id) on delete cascade,
  note_id           uuid references public.segment_notes (id) on delete cascade,
  access_request_id uuid references public.access_requests (id) on delete cascade,
  actor             uuid references auth.users (id) on delete set null,
  created_at        timestamptz not null default now(),
  read_at           timestamptz,
  check (
    (kind = 'insight_proposed' and insight_id is not null)
    or (kind = 'note_on_your_call' and note_id is not null and conversation_id is not null)
    or (kind = 'request_answered' and access_request_id is not null)
  )
);

create index notifications_inbox_idx on public.notifications (user_id, created_at desc);
create index notifications_unread_idx on public.notifications (user_id) where read_at is null;

comment on table public.notifications is
  'In-product notifications. References only, all cascading, so erasure takes them. Written by triggers.';

alter table public.notifications enable row level security;

create policy "people read their own notifications, in their company"
  on public.notifications for select to authenticated
  using (user_id = (select auth.uid()) and (select private.is_company_member(company_id)));


-- A new insight waiting for approval: its company's owners, not whoever
-- asked for it (they are looking at it).
create function private.notify_insight_proposed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'proposed' then
    insert into public.notifications (company_id, user_id, kind, insight_id, actor)
    select new.company_id, m.user_id, 'insight_proposed', new.id, (select auth.uid())
      from public.company_members m
     where m.company_id = new.company_id
       and m.role = 'owner'
       and m.user_id is distinct from (select auth.uid());
  end if;
  return new;
end;
$$;

create trigger insights_notify
  after insert on public.insights
  for each row execute function private.notify_insight_proposed();


-- A note on your call, from somebody else, while you are still a member.
create function private.notify_note_on_call()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_added_by uuid;
begin
  select c.added_by into v_added_by from public.conversations c where c.id = new.conversation_id;
  if v_added_by is not null
     and v_added_by is distinct from new.author
     and exists (select 1 from public.company_members m
                  where m.company_id = new.company_id and m.user_id = v_added_by) then
    insert into public.notifications (company_id, user_id, kind, conversation_id, note_id, actor)
    values (new.company_id, v_added_by, 'note_on_your_call', new.conversation_id, new.id, new.author);
  end if;
  return new;
end;
$$;

create trigger segment_notes_notify
  after insert on public.segment_notes
  for each row execute function private.notify_note_on_call();


-- Your teammate request, added or declined.
create function private.notify_request_answered()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.resolved_at is null and new.resolved_at is not null
     and new.requested_by is not null
     and new.requested_by is distinct from new.resolved_by then
    insert into public.notifications (company_id, user_id, kind, access_request_id, actor)
    values (new.company_id, new.requested_by, 'request_answered', new.id, new.resolved_by);
  end if;
  return new;
end;
$$;

create trigger access_requests_notify
  after update of resolved_at on public.access_requests
  for each row execute function private.notify_request_answered();


-- Mark some, or all, of the caller's own as read. Returns how many changed.
create function public.mark_notifications_read(p_ids uuid[] default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  update public.notifications n
     set read_at = now()
   where n.user_id = (select auth.uid())
     and n.read_at is null
     and (p_ids is null or n.id = any (p_ids));
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.mark_notifications_read(uuid[]) from public, anon;
grant execute on function public.mark_notifications_read(uuid[]) to authenticated;
