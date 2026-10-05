-- Onboarding and the plan each person has seen (2026-10-05).
--
-- A new owner is walked through three steps once — the overlay, a first call,
-- their plan — and after any change of plan everyone in the company is shown
-- once what it changed. Both are each person's own: when they finished the
-- steps, and which plan they were last shown, in their preferences row.
--
-- Everyone already here has finished onboarding and has seen the plan they
-- are on, so nobody who is already using the product gets the tour or a
-- popup about a plan they chose before this existed.

alter table public.user_preferences
  add column onboarded_at timestamptz,
  add column plan_seen text references public.plans (id) on delete set null;

comment on column public.user_preferences.onboarded_at is 'When the person finished (or skipped for good) the first-run steps.';
comment on column public.user_preferences.plan_seen is 'The plan the person was last shown: a change of plan is announced once, to each person.';

-- Everyone here before this has finished, and has seen their company's plan.
insert into public.user_preferences (user_id, onboarded_at, plan_seen)
select m.user_id, now(), c.plan
  from public.company_members m join public.companies c on c.id = m.company_id
on conflict (user_id) do update set onboarded_at = coalesce(public.user_preferences.onboarded_at, now()),
                                    plan_seen = coalesce(public.user_preferences.plan_seen, excluded.plan_seen);

-- The steps are done: and the plan they are on is the one they have seen.
create function public.finish_onboarding()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid  uuid := (select auth.uid());
  v_plan text := (select c.plan from public.companies c where c.id = private.sole_company_of_caller());
begin
  if v_uid is null then
    raise exception 'finish_onboarding: sign in first' using errcode = '42501';
  end if;
  insert into public.user_preferences (user_id, onboarded_at, plan_seen)
  values (v_uid, now(), v_plan)
  on conflict (user_id) do update set onboarded_at = now(), plan_seen = coalesce(excluded.plan_seen, public.user_preferences.plan_seen), updated_at = now();
end;
$$;

-- The person was shown what their company's change of plan means.
create function public.mark_plan_seen()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid  uuid := (select auth.uid());
  v_plan text := (select c.plan from public.companies c where c.id = private.sole_company_of_caller());
begin
  if v_uid is null or v_plan is null then
    raise exception 'mark_plan_seen: not in a company' using errcode = '42501';
  end if;
  insert into public.user_preferences (user_id, plan_seen)
  values (v_uid, v_plan)
  on conflict (user_id) do update set plan_seen = excluded.plan_seen, updated_at = now();
end;
$$;

revoke all on function public.finish_onboarding() from public, anon;
revoke all on function public.mark_plan_seen() from public, anon;
grant execute on function public.finish_onboarding() to authenticated;
grant execute on function public.mark_plan_seen() to authenticated;
