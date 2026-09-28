-- Cost against price, per company: what each company's AI use cost over the
-- last p_days, beside what its plan charges a month.
--
-- The console could show spend by week, tier and model — whether the product
-- as a whole is getting dearer — but not who costs more than they pay, which
-- is the question a price change needs answered. The cost is the estimate
-- admin_spend_by_week already makes, at the published rates in
-- private.usage_usd, summed per company instead of per week.
--
-- Operators only. Counts and money; nothing from any call.

create function public.admin_company_margin(p_days integer default 30)
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
    p.price_usd_cents,
    c.closed_at,
    count(u.id),
    coalesce(round(sum(private.usage_usd(u.model, u.input_tokens, u.cache_creation_tokens, u.cache_read_tokens, u.output_tokens))::numeric, 4), 0)
  from public.companies c
  left join public.plans p on p.id = c.plan
  left join public.model_usage u on u.company_id = c.id and u.created_at > now() - make_interval(days => p_days)
  group by c.id, c.name, c.plan, p.price_usd_cents, c.closed_at
  order by 7 desc, c.name;
end;
$$;

revoke all on function public.admin_company_margin(integer) from public, anon;
grant execute on function public.admin_company_margin(integer) to authenticated;
