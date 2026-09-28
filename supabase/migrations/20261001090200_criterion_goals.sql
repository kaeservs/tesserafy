-- Goals: the share of calls an owner wants each criterion met on — "budget
-- established on 60% of discovery calls this quarter". Reports and each
-- seller's page show where the team and each seller stand against it.
--
-- A goal is per criterion, not per seller: a team is coached towards one
-- standard, and a seller's page shows their own rate against it. The criterion
-- is named by its key within a scorecard, so a goal carries across that
-- scorecard's versions, as the rates it is compared with already do.
--
-- Owners set them; everyone in the company reads them.

create table public.criterion_goals (
  company_id       uuid not null references public.companies (id) on delete cascade,
  engagement_type  text not null,
  criterion_key    text not null,
  -- The share of scored calls, 0.01 to 1.
  target           numeric(3, 2) not null check (target > 0 and target <= 1),
  set_by           uuid references auth.users (id) on delete set null,
  updated_at       timestamptz not null default now(),
  primary key (company_id, engagement_type, criterion_key)
);

comment on table public.criterion_goals is
  'The share of calls each criterion should be met on. Owners set them; members read them.';

alter table public.criterion_goals enable row level security;

create policy "members read their company's goals"
  on public.criterion_goals for select to authenticated
  using ((select private.is_company_member(company_id)));

create policy "admins read all goals"
  on public.criterion_goals for select to authenticated
  using ((select private.is_platform_admin()));


-- Set a goal, or clear it with a null target. Owners only.
create function public.set_criterion_goal(p_engagement_type text, p_criterion_key text, p_target numeric)
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
    raise exception 'set_criterion_goal: only an owner sets goals' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.criteria_definitions d
     where d.engagement_type = p_engagement_type and d.key = p_criterion_key
       and (d.company_id is null or d.company_id = v_company_id)
  ) then
    raise exception 'set_criterion_goal: no such criterion on that scorecard' using errcode = '22023';
  end if;

  if p_target is null then
    delete from public.criterion_goals g
     where g.company_id = v_company_id and g.engagement_type = p_engagement_type and g.criterion_key = p_criterion_key;
    return;
  end if;
  if p_target <= 0 or p_target > 1 then
    raise exception 'set_criterion_goal: a goal is a share of calls, above 0 and at most 100%%' using errcode = '22023';
  end if;

  insert into public.criterion_goals (company_id, engagement_type, criterion_key, target, set_by)
  values (v_company_id, p_engagement_type, p_criterion_key, round(p_target, 2), (select auth.uid()))
  on conflict (company_id, engagement_type, criterion_key)
  do update set target = excluded.target, set_by = excluded.set_by, updated_at = now();
end;
$$;

revoke all on function public.set_criterion_goal(text, text, numeric) from public, anon;
grant execute on function public.set_criterion_goal(text, text, numeric) to authenticated;
