-- Feature adoption, for the console: which companies use which features, over
-- the last p_days — call preps, examples, goals, coaching, corrections to the
-- score, feedback, marked speakers, the sample call. Counts only.
--
-- Operators stopped reading several of these tables (20261002090000): the
-- console has no business reading a company's examples or goals. How many
-- there are is a different question — is anyone using what was built — and
-- this answers it without returning a word of their content.

create function public.admin_feature_adoption(p_days integer default 90)
returns table (
  company_id      uuid,
  name            text,
  plan            text,
  closed_at       timestamptz,
  calls           bigint,
  preps           bigint,
  examples        bigint,
  goals           bigint,
  coaching        bigint,
  corrections     bigint,
  feedback        bigint,
  speakers_marked bigint,
  sample_call     boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_since timestamptz;
begin
  if not (select private.is_platform_admin()) then
    raise exception 'admin_feature_adoption: not a platform admin' using errcode = '42501';
  end if;
  if p_days is null or p_days not between 1 and 366 then
    raise exception 'admin_feature_adoption: 1 to 366 days' using errcode = '22023';
  end if;
  v_since := now() - make_interval(days => p_days);

  return query
  select
    c.id,
    c.name,
    c.plan,
    c.closed_at,
    (select count(*) from public.conversations v where v.company_id = c.id and v.created_at > v_since),
    (select count(*) from public.call_preps x where x.company_id = c.id and x.created_at > v_since),
    (select count(*) from public.moments x where x.company_id = c.id and x.created_at > v_since),
    -- Goals are standing settings, not events: how many are set now.
    (select count(*) from public.criterion_goals x where x.company_id = c.id),
    (select count(*) from public.coaching_assignments x where x.company_id = c.id and x.created_at > v_since),
    (select count(*) from public.criterion_events x where x.company_id = c.id and x.detector = 'person' and x.created_at > v_since),
    (select count(*) from public.feedback x where x.company_id = c.id and x.created_at > v_since),
    (select count(*) from public.our_speakers x where x.company_id = c.id),
    c.sample_imported_at is not null
  from public.companies c
  order by c.name;
end;
$$;

revoke all on function public.admin_feature_adoption(integer) from public, anon;
grant execute on function public.admin_feature_adoption(integer) to authenticated;
