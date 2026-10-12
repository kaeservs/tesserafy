-- The criterion detector (T1) moves to claude-haiku-5-5, a tenth of
-- claude-haiku-4-5's price per token (ADR 0030). The console's spend figures
-- priced every model they did not name at Haiku 4.5's rate, so without this
-- they would report the detector at ten times what it costs.
--
-- private.usage_usd is the one place that prices a usage row; admin_companies
-- still carried its own copy of the arithmetic, and now calls it instead, so
-- the next price is one edit.

create or replace function private.usage_usd(
  p_model text, p_input bigint, p_cache_creation bigint, p_cache_read bigint, p_output bigint
)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select (p_input + p_cache_creation * 1.25 + p_cache_read * 0.1) / 1e6
           * case p_model
               when 'claude-opus-5' then 5
               when 'claude-sonnet-5' then 2
               when 'claude-haiku-5-5' then 0.1
               else 1
             end
         + p_output / 1e6
           * case p_model
               when 'claude-opus-5' then 25
               when 'claude-sonnet-5' then 10
               when 'claude-haiku-5-5' then 0.5
               else 5
             end;
$$;

create or replace function public.admin_companies()
returns table (
  company_id     uuid,
  name           text,
  plan           text,
  retention_days integer,
  members        bigint,
  conversations  bigint,
  segments       bigint,
  last_activity  timestamptz,
  failures_24h   bigint,
  spend_30d_usd  numeric,
  closed_at      timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not (select private.is_platform_admin()) then
    raise exception 'admin_companies: not a platform admin' using errcode = '42501';
  end if;

  return query
  select
    c.id,
    c.name,
    c.plan,
    c.retention_days,
    (select count(*) from public.company_members m where m.company_id = c.id),
    (select count(*) from public.conversations v where v.company_id = c.id),
    (select count(*) from public.segments s where s.company_id = c.id),
    (select max(v.created_at) from public.conversations v where v.company_id = c.id),
    (select count(*) from public.system_failures f
      where f.company_id = c.id and f.created_at > now() - interval '24 hours'),
    coalesce((
      select round(sum(private.usage_usd(
        u.model, u.input_tokens, u.cache_creation_tokens, u.cache_read_tokens, u.output_tokens
      ))::numeric, 4)
      from public.model_usage u
      where u.company_id = c.id and u.created_at > now() - interval '30 days'
    ), 0),
    c.closed_at
  from public.companies c
  order by c.closed_at is not null, c.name;
end;
$$;

revoke all on function public.admin_companies() from public, anon;
grant execute on function public.admin_companies() to authenticated, service_role;
