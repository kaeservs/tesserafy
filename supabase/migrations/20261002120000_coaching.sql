-- Coaching assignments: a manager sends a seller a call, or one moment in it,
-- to listen to — "hear how the budget came up at 12:30" — and sees when they
-- have. The seller is notified, finds it on their dashboard and on Coaching,
-- and marks it done with a line of reply if they want to.
--
-- Between the two people and the company's owners, not the whole team: it is
-- feedback on one person's work. Owners assign; only the seller it is for
-- marks it done; whoever assigned it, or an owner, withdraws it. It points at
-- the call and the line, so deleting the call deletes the assignment.

create table public.coaching_assignments (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references public.companies (id) on delete cascade,
  assigned_to      uuid not null references auth.users (id) on delete cascade,
  assigned_by      uuid references auth.users (id) on delete set null,
  conversation_id  uuid not null,
  segment_id       uuid,
  note             text check (note is null or length(note) between 1 and 1000),
  status           text not null default 'open' check (status in ('open', 'done')),
  reply            text check (reply is null or length(reply) between 1 and 1000),
  done_at          timestamptz,
  created_at       timestamptz not null default now(),
  check ((status = 'done') = (done_at is not null)),
  unique (company_id, id),
  foreign key (company_id, conversation_id)
    references public.conversations (company_id, id) on delete cascade,
  foreign key (company_id, segment_id)
    references public.segments (company_id, id) on delete cascade
);

create index coaching_assigned_to_idx on public.coaching_assignments (assigned_to, status, created_at desc);
create index coaching_company_idx on public.coaching_assignments (company_id, created_at desc);

comment on table public.coaching_assignments is
  'A call or moment an owner asked a seller to listen to. Read by the seller, the assigner and owners.';

alter table public.coaching_assignments enable row level security;

create policy "the seller, the assigner and owners read an assignment"
  on public.coaching_assignments for select to authenticated
  using (
    (select private.is_company_member(company_id))
    and (
      assigned_to = (select auth.uid())
      or assigned_by = (select auth.uid())
      or exists (
        select 1 from public.company_members m
         where m.company_id = coaching_assignments.company_id and m.user_id = (select auth.uid()) and m.role = 'owner'
      )
    )
  );


-- Notifications learn one more kind.
alter table public.notifications add column coaching_id uuid references public.coaching_assignments (id) on delete cascade;
alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('insight_proposed', 'note_on_your_call', 'request_answered', 'insight_assigned', 'coaching_assigned'));
alter table public.notifications drop constraint notifications_check;
alter table public.notifications add constraint notifications_check check (
  (kind in ('insight_proposed', 'insight_assigned') and insight_id is not null)
  or (kind = 'note_on_your_call' and note_id is not null and conversation_id is not null)
  or (kind = 'request_answered' and access_request_id is not null)
  or (kind = 'coaching_assigned' and coaching_id is not null)
);


create function public.assign_coaching(
  p_assigned_to     uuid,
  p_conversation_id uuid,
  p_segment_id      uuid default null,
  p_note            text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid   uuid := (select auth.uid());
  v_call  public.conversations;
  v_note  text := nullif(trim(coalesce(p_note, '')), '');
  v_id    uuid;
begin
  select * into v_call from public.conversations c where c.id = p_conversation_id;
  if v_call.id is null or not (select private.is_company_member(v_call.company_id)) then
    raise exception 'assign_coaching: call not found' using errcode = 'P0002';
  end if;
  if not exists (
    select 1 from public.company_members m
     where m.company_id = v_call.company_id and m.user_id = v_uid and m.role = 'owner'
  ) then
    raise exception 'assign_coaching: only an owner assigns coaching' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.company_members m where m.company_id = v_call.company_id and m.user_id = p_assigned_to
  ) then
    raise exception 'assign_coaching: that person is not in your company' using errcode = '22023';
  end if;
  if p_segment_id is not null and not exists (
    select 1 from public.segments s where s.id = p_segment_id and s.conversation_id = v_call.id
  ) then
    raise exception 'assign_coaching: that moment is not in this call' using errcode = '22023';
  end if;
  if v_note is not null and length(v_note) > 1000 then
    raise exception 'assign_coaching: a note is at most 1000 characters' using errcode = '22023';
  end if;

  insert into public.coaching_assignments (company_id, assigned_to, assigned_by, conversation_id, segment_id, note)
  values (v_call.company_id, p_assigned_to, v_uid, v_call.id, p_segment_id, v_note)
  returning id into v_id;

  -- Nobody is notified of what they assigned themselves.
  if p_assigned_to <> v_uid then
    insert into public.notifications (company_id, user_id, kind, coaching_id, conversation_id, actor)
    values (v_call.company_id, p_assigned_to, 'coaching_assigned', v_id, v_call.id, v_uid);
  end if;
  return v_id;
end;
$$;

-- Done, by the seller it is for, with a line of reply if they want.
create function public.complete_coaching(p_assignment_id uuid, p_reply text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row   public.coaching_assignments;
  v_reply text := nullif(trim(coalesce(p_reply, '')), '');
begin
  select * into v_row from public.coaching_assignments a where a.id = p_assignment_id;
  if v_row.id is null or v_row.assigned_to <> (select auth.uid()) then
    raise exception 'complete_coaching: only the person it was assigned to can mark it done' using errcode = '42501';
  end if;
  if v_reply is not null and length(v_reply) > 1000 then
    raise exception 'complete_coaching: a reply is at most 1000 characters' using errcode = '22023';
  end if;
  update public.coaching_assignments
     set status = 'done', done_at = now(), reply = v_reply
   where id = p_assignment_id;
end;
$$;

-- Withdrawn by whoever assigned it, or an owner.
create function public.withdraw_coaching(p_assignment_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.coaching_assignments;
begin
  select * into v_row from public.coaching_assignments a where a.id = p_assignment_id;
  if v_row.id is null or not (select private.is_company_member(v_row.company_id)) then
    raise exception 'withdraw_coaching: assignment not found' using errcode = 'P0002';
  end if;
  if v_row.assigned_by is distinct from (select auth.uid()) and not exists (
    select 1 from public.company_members m
     where m.company_id = v_row.company_id and m.user_id = (select auth.uid()) and m.role = 'owner'
  ) then
    raise exception 'withdraw_coaching: only whoever assigned it, or an owner, can withdraw it' using errcode = '42501';
  end if;
  delete from public.coaching_assignments where id = p_assignment_id;
end;
$$;

revoke all on function public.assign_coaching(uuid, uuid, uuid, text) from public, anon;
revoke all on function public.complete_coaching(uuid, text) from public, anon;
revoke all on function public.withdraw_coaching(uuid) from public, anon;
grant execute on function public.assign_coaching(uuid, uuid, uuid, text) to authenticated;
grant execute on function public.complete_coaching(uuid, text) to authenticated;
grant execute on function public.withdraw_coaching(uuid) to authenticated;
