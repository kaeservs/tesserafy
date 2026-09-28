-- Insights a team can work with.
--
-- An insight could be approved or dismissed, and that was all. A product team
-- does more with a finding before it becomes a ticket: tightens its title,
-- decides who owns it, notices two are the same thing, talks about it. So:
--
--   edit_insight      title and summary, by any member (the evidence is never edited);
--   assign_insight    to a member of the company, or to nobody, by any member;
--   merge_insights    one into another, by an owner — the second's evidence
--                     joins the first and the second is removed;
--   comment_insight   a thread under the insight, by any member.
--
-- Every change is in insight_events, readable by the company, so an insight
-- that was renamed or absorbed another says so. Being assigned notifies the
-- assignee (notifications, kind 'insight_assigned').
--
-- A merge refuses an insight that already became a ticket: the ticket's link
-- back would lead nowhere. It moves citations, never quotes; invariant 4
-- still holds because the kept insight gains evidence and loses none.

alter table public.insights
  add column assigned_to uuid references auth.users (id) on delete set null;

create table public.insight_events (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null,
  insight_id  uuid not null,
  kind        text not null check (kind in ('renamed', 'assigned', 'merged')),
  detail      text,
  actor       uuid references auth.users (id) on delete set null,
  at          timestamptz not null default now(),
  foreign key (company_id, insight_id) references public.insights (company_id, id) on delete cascade
);

create index insight_events_insight_idx on public.insight_events (insight_id, at);

alter table public.insight_events enable row level security;

create policy "members read their company's insight events"
  on public.insight_events for select to authenticated
  using ((select private.is_company_member(company_id)));

create table public.insight_comments (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null,
  insight_id  uuid not null,
  author      uuid references auth.users (id) on delete set null,
  body        text not null check (length(trim(body)) between 1 and 2000),
  created_at  timestamptz not null default now(),
  foreign key (company_id, insight_id) references public.insights (company_id, id) on delete cascade
);

create index insight_comments_insight_idx on public.insight_comments (insight_id, created_at);

alter table public.insight_comments enable row level security;

create policy "members read their company's insight comments"
  on public.insight_comments for select to authenticated
  using ((select private.is_company_member(company_id)));


-- Notifications learn one more kind.
alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('insight_proposed', 'note_on_your_call', 'request_answered', 'insight_assigned'));
alter table public.notifications drop constraint notifications_check;
alter table public.notifications add constraint notifications_check check (
  (kind in ('insight_proposed', 'insight_assigned') and insight_id is not null)
  or (kind = 'note_on_your_call' and note_id is not null and conversation_id is not null)
  or (kind = 'request_answered' and access_request_id is not null)
);


create function public.edit_insight(p_insight_id uuid, p_title text, p_summary text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row     public.insights;
  v_title   text := trim(coalesce(p_title, ''));
  v_summary text := trim(coalesce(p_summary, ''));
begin
  select * into v_row from public.insights i where i.id = p_insight_id for update;
  if v_row.id is null or not (select private.is_company_member(v_row.company_id)) then
    raise exception 'edit_insight: insight not found' using errcode = 'P0002';
  end if;
  if length(v_title) not between 1 and 200 or length(v_summary) not between 1 and 2000 then
    raise exception 'edit_insight: a title of up to 200 characters and a summary of up to 2000' using errcode = '22023';
  end if;
  if v_title = v_row.title and v_summary = v_row.summary then
    return;
  end if;
  update public.insights set title = v_title, summary = v_summary where id = v_row.id;
  insert into public.insight_events (company_id, insight_id, kind, detail, actor)
  values (v_row.company_id, v_row.id, 'renamed',
          case when v_title <> v_row.title then 'was “' || v_row.title || '”' else 'summary rewritten' end,
          (select auth.uid()));
end;
$$;

create function public.assign_insight(p_insight_id uuid, p_user_id uuid default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.insights;
  v_uid uuid := (select auth.uid());
begin
  select * into v_row from public.insights i where i.id = p_insight_id for update;
  if v_row.id is null or not (select private.is_company_member(v_row.company_id)) then
    raise exception 'assign_insight: insight not found' using errcode = 'P0002';
  end if;
  if p_user_id is not null and not exists (
    select 1 from public.company_members m where m.company_id = v_row.company_id and m.user_id = p_user_id
  ) then
    raise exception 'assign_insight: that person is not in this company' using errcode = '22023';
  end if;
  if p_user_id is not distinct from v_row.assigned_to then
    return;
  end if;
  update public.insights set assigned_to = p_user_id where id = v_row.id;
  insert into public.insight_events (company_id, insight_id, kind, detail, actor)
  values (v_row.company_id, v_row.id, 'assigned',
          coalesce((select u.email from auth.users u where u.id = p_user_id), 'nobody'), v_uid);
  if p_user_id is not null and p_user_id is distinct from v_uid then
    insert into public.notifications (company_id, user_id, kind, insight_id, actor)
    values (v_row.company_id, p_user_id, 'insight_assigned', v_row.id, v_uid);
  end if;
end;
$$;

create function public.merge_insights(p_keep_id uuid, p_merge_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_keep  public.insights;
  v_merge public.insights;
  v_moved integer;
begin
  if p_keep_id = p_merge_id then
    raise exception 'merge_insights: an insight cannot absorb itself' using errcode = '22023';
  end if;
  select * into v_keep from public.insights i where i.id = p_keep_id for update;
  select * into v_merge from public.insights i where i.id = p_merge_id for update;
  if v_keep.id is null or v_merge.id is null or v_keep.company_id <> v_merge.company_id
     or not (select private.is_company_member(v_keep.company_id)) then
    raise exception 'merge_insights: insights not found' using errcode = 'P0002';
  end if;
  if not exists (
    select 1 from public.company_members m
     where m.company_id = v_keep.company_id and m.user_id = (select auth.uid()) and m.role = 'owner'
  ) then
    raise exception 'merge_insights: only an owner can merge insights' using errcode = '42501';
  end if;
  if exists (select 1 from public.insight_tickets t where t.insight_id = v_merge.id) then
    raise exception 'merge_insights: “%” already became a ticket; merge the other way round', v_merge.title
      using errcode = '22023';
  end if;

  insert into public.insight_evidence (company_id, insight_id, signal_id)
  select v_keep.company_id, v_keep.id, e.signal_id
    from public.insight_evidence e
   where e.insight_id = v_merge.id
     and not exists (select 1 from public.insight_evidence k where k.insight_id = v_keep.id and k.signal_id = e.signal_id);
  get diagnostics v_moved = row_count;

  update public.insight_comments set insight_id = v_keep.id where insight_id = v_merge.id;
  insert into public.insight_events (company_id, insight_id, kind, detail, actor)
  values (v_keep.company_id, v_keep.id, 'merged',
          '“' || v_merge.title || '”, bringing ' || v_moved || ' more citation' || case when v_moved = 1 then '' else 's' end,
          (select auth.uid()));
  -- Its evidence goes with it; the kept insight holds a copy of every citation.
  delete from public.insights where id = v_merge.id;
  return v_moved;
end;
$$;

create function public.comment_insight(p_insight_id uuid, p_body text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.insights;
  v_id  uuid;
begin
  select * into v_row from public.insights i where i.id = p_insight_id;
  if v_row.id is null or not (select private.is_company_member(v_row.company_id)) then
    raise exception 'comment_insight: insight not found' using errcode = 'P0002';
  end if;
  if length(trim(coalesce(p_body, ''))) not between 1 and 2000 then
    raise exception 'comment_insight: a comment is 1 to 2000 characters' using errcode = '22023';
  end if;
  insert into public.insight_comments (company_id, insight_id, author, body)
  values (v_row.company_id, v_row.id, (select auth.uid()), trim(p_body))
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.edit_insight(uuid, text, text) from public, anon;
revoke all on function public.assign_insight(uuid, uuid) from public, anon;
revoke all on function public.merge_insights(uuid, uuid) from public, anon;
revoke all on function public.comment_insight(uuid, text) from public, anon;
grant execute on function public.edit_insight(uuid, text, text) to authenticated;
grant execute on function public.assign_insight(uuid, uuid) to authenticated;
grant execute on function public.merge_insights(uuid, uuid) to authenticated;
grant execute on function public.comment_insight(uuid, text) to authenticated;
