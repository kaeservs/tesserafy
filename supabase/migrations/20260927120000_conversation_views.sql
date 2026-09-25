-- Who opened which call.
--
-- RLS decides who *can* read a conversation; nothing recorded who *did*.
-- Support sessions were the one exception (support_access, 20260923181208),
-- so "which of our colleagues opened this call" was answerable for staff and
-- unanswerable for everyone else — the data-protection note listed it open.
--
-- What is recorded: opening a call's page. That is where a call is read in
-- full. Search results and insight quotes show pieces of calls too and are
-- not recorded here; the note says so rather than implying a complete trail.
--
-- One row per person per call per ten minutes. A trail that logged every
-- refresh would bury the one visit that matters under forty that do not, and
-- the question it answers is "did they look", not "how many times did the
-- page render".
--
-- `during_support` is set when the account had an open support session at the
-- time. Such a session genuinely is the customer's — that is the point of it —
-- so without this flag a staff visit would read in the log as the customer's
-- own. The flag says the visit may have been staff; support_access says who.
--
-- Owners and platform admins read it. An ordinary member cannot see which of
-- their colleagues opened what: the log is for the person responsible for the
-- company's data, not a way for colleagues to watch each other.
--
-- Views go when the call goes. A log of who read a conversation that no longer
-- exists is a thread back to it; the erasure record, which holds no content,
-- is what remains.

create table public.conversation_views (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references public.companies (id) on delete cascade,
  conversation_id  uuid not null references public.conversations (id) on delete cascade,
  user_id          uuid references auth.users (id) on delete set null,
  during_support   boolean not null default false,
  viewed_at        timestamptz not null default now()
);

create index conversation_views_conversation_idx
  on public.conversation_views (conversation_id, viewed_at desc);
create index conversation_views_user_idx
  on public.conversation_views (user_id, conversation_id, viewed_at desc);

comment on table public.conversation_views is
  'Who opened a conversation''s page, at most once per person per call per ten minutes. Erased with the conversation.';

alter table public.conversation_views enable row level security;

create policy "owners read their company's views"
  on public.conversation_views for select to authenticated
  using (exists (
    select 1 from public.company_members m
     where m.company_id = conversation_views.company_id
       and m.user_id = (select auth.uid())
       and m.role = 'owner'
  ));

create policy "admins read all views"
  on public.conversation_views for select to authenticated
  using ((select private.is_platform_admin()));


-- Called by the call page as it renders. Who and when come from the session
-- and the clock; the caller names only the call, and must be able to read it.
create function public.record_conversation_view(p_conversation_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid        uuid := (select auth.uid());
  v_company_id uuid;
begin
  if v_uid is null then
    raise exception 'record_conversation_view: not signed in' using errcode = '42501';
  end if;

  select c.company_id into v_company_id
    from public.conversations c where c.id = p_conversation_id;

  -- One answer for "no such call" and "not yours": nothing about another
  -- company's calls is learnable from here.
  if v_company_id is null or not (select private.is_company_member(v_company_id)) then
    raise exception 'record_conversation_view: not a call you can open' using errcode = '42501';
  end if;

  if exists (
    select 1 from public.conversation_views v
     where v.user_id = v_uid
       and v.conversation_id = p_conversation_id
       and v.viewed_at > now() - interval '10 minutes'
  ) then
    return;
  end if;

  insert into public.conversation_views (company_id, conversation_id, user_id, during_support)
  values (
    v_company_id,
    p_conversation_id,
    v_uid,
    exists (
      select 1 from public.support_access a
       where a.subject_user_id = v_uid
         and a.ended_at is null
         and a.expires_at > now()
    )
  );
end;
$$;

revoke all on function public.record_conversation_view(uuid) from public, anon;
grant execute on function public.record_conversation_view(uuid) to authenticated;


-- For an owner: who has opened this call, with their addresses, which no
-- signed-in user can read from auth.users directly. One row per person.
create function public.conversation_viewers(p_conversation_id uuid)
returns table (
  email           text,
  last_viewed_at  timestamptz,
  views           bigint,
  during_support  boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_company_id uuid;
begin
  select c.company_id into v_company_id
    from public.conversations c where c.id = p_conversation_id;

  if v_company_id is null or not exists (
    select 1 from public.company_members m
     where m.company_id = v_company_id and m.user_id = (select auth.uid()) and m.role = 'owner'
  ) then
    raise exception 'conversation_viewers: only an owner of this call''s company' using errcode = '42501';
  end if;

  return query
  select coalesce(u.email::text, 'a deleted account'),
         max(v.viewed_at),
         count(*),
         bool_or(v.during_support)
    from public.conversation_views v
    left join auth.users u on u.id = v.user_id
   where v.conversation_id = p_conversation_id
   group by v.user_id, u.email
   order by max(v.viewed_at) desc;
end;
$$;

revoke all on function public.conversation_viewers(uuid) from public, anon;
grant execute on function public.conversation_viewers(uuid) to authenticated;
