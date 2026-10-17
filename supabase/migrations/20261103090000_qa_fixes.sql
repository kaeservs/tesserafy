-- Fixes from a full QA pass on a local copy of the product (2026-10-17).
--
--   1. A support window an operator ended early still counted as open until
--      its original expiry. Any session that began after "End now" but
--      before that expiry was taken for the support session: a second
--      support session was signed out the moment it landed, and the
--      customer's own sign-in by emailed link was signed out as "support
--      ended" — and, while it lasted, refused a password, a follow-up send,
--      a CRM log and a checkout as a support session would be. A window now
--      ends when it ended: at whichever comes first, its expiry or its end.
--   2. The console's "Cost against price" compared a company's AI cost with
--      one seat's price. Paid plans are per seat (ADR 0027), so a company on
--      three seats was measured against a third of what it pays, and could
--      read as costing more than it pays when it did not. The price is the
--      plan's per-seat price times the company's seats, as every limit has
--      been since plans went per seat.


-- 1 ---------------------------------------------------------------------------

create or replace function public.support_session_ended()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from auth.sessions s
      join public.support_access a on a.subject_user_id = s.user_id
     where s.id = nullif((select auth.jwt()) ->> 'session_id', '')::uuid
       and s.user_id = (select auth.uid())
       and s.created_at >= a.created_at
       and s.created_at <= least(a.expires_at, coalesce(a.ended_at, a.expires_at))
       and (a.ended_at is not null or a.expires_at <= now())
  );
$$;

create or replace function private.in_support_session()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from auth.sessions s
      join public.support_access a on a.subject_user_id = s.user_id
     where s.id = nullif((select auth.jwt()) ->> 'session_id', '')::uuid
       and s.user_id = (select auth.uid())
       and s.created_at >= a.created_at
       and s.created_at <= least(a.expires_at, coalesce(a.ended_at, a.expires_at))
  );
$$;
revoke all on function private.in_support_session() from public, anon;


-- 2 ---------------------------------------------------------------------------

create or replace function public.admin_company_margin(p_days integer default 30)
returns table (
  company_id       uuid,
  name             text,
  plan             text,
  price_usd_cents  integer,
  closed_at        timestamptz,
  model_calls      bigint,
  usd              numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (select private.is_platform_admin()) then
    raise exception 'admin_company_margin: not a platform admin' using errcode = '42501';
  end if;
  if p_days is null or p_days not between 1 and 366 then
    raise exception 'admin_company_margin: 1 to 366 days' using errcode = '22023';
  end if;

  return query
  select
    c.id,
    c.name,
    c.plan,
    (p.price_usd_cents * case when p.per_seat then coalesce(s.seats, 1) else 1 end)::integer,
    c.closed_at,
    count(u.id),
    coalesce(round(sum(private.usage_usd(u.model, u.input_tokens, u.cache_creation_tokens, u.cache_read_tokens, u.output_tokens))::numeric, 4), 0)
  from public.companies c
  left join public.plans p on p.id = c.plan
  left join public.subscriptions s on s.company_id = c.id
  left join public.model_usage u on u.company_id = c.id and u.created_at > now() - make_interval(days => p_days)
  group by c.id, c.name, c.plan, p.price_usd_cents, p.per_seat, s.seats, c.closed_at
  order by 7 desc, c.name;
end;
$$;

revoke all on function public.admin_company_margin(integer) from public, anon;
grant execute on function public.admin_company_margin(integer) to authenticated;
