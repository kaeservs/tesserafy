-- Retention an owner sets, and a purge that actually runs.
--
-- Retention has existed since the erasure change, but only an operator could
-- set it (pnpm erase --retention) and nothing ever ran the purge — the
-- data-protection note said so: "runs nothing on a schedule yet". A retention
-- period nobody enforces is a promise the product does not keep.
--
-- Two halves. An owner sets their own company's period, and choosing one is
-- the owner opting in to automatic deletion — so the product shows, before
-- saving, how many calls the next run would remove. And pg_cron runs the purge
-- nightly inside the database: no key anywhere, no secret in CI, no new vendor.
-- The purge function itself is unchanged; it is operator-only by checking
-- that there is no signed-in caller, which is exactly what a cron job is.
--
-- A company with no retention set is untouched, which today is every company.

create extension if not exists pg_cron with schema pg_catalog;


-- How many calls a period would remove, counted exactly as the purge counts
-- them, so the warning an owner reads is the number that will happen.
create function public.retention_preview(p_days integer)
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_company_id uuid := private.sole_company_of_caller();
  v_count integer;
begin
  if p_days is null then
    return 0;
  end if;
  select count(*)::integer into v_count
  from public.conversations c
  where c.company_id = v_company_id
    and coalesce(c.occurred_at, c.created_at) < now() - make_interval(days => p_days);
  return v_count;
end;
$$;

revoke all on function public.retention_preview(integer) from public, anon;
grant execute on function public.retention_preview(integer) to authenticated;


-- Owners only: a retention period is an instruction to delete, and only an
-- owner may delete (erase_conversation already says so).
create function public.set_retention(p_days integer)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company_id uuid := private.sole_company_of_caller();
begin
  if not exists (
    select 1 from public.company_members m
    where m.company_id = v_company_id
      and m.user_id = (select auth.uid())
      and m.role = 'owner'
  ) then
    raise exception 'set_retention: only an owner may set retention' using errcode = '42501';
  end if;

  if p_days is not null and (p_days < 7 or p_days > 3650) then
    raise exception 'set_retention: retention must be between 7 and 3650 days, or none'
      using errcode = '22023';
  end if;

  update public.companies set retention_days = p_days where id = v_company_id;
  return p_days;
end;
$$;

revoke all on function public.set_retention(integer) from public, anon;
grant execute on function public.set_retention(integer) to authenticated;


-- Nightly at 03:15 UTC. A named schedule, so re-running this migration
-- replaces the job rather than adding a second one. 500 calls a night is the
-- function's own ceiling; a backlog clears over several nights rather than
-- holding one long transaction.
select cron.schedule(
  'purge-expired-conversations',
  '15 3 * * *',
  $$select public.purge_expired_conversations()$$
);
