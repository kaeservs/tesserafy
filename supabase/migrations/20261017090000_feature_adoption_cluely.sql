-- The console's adoption, counting what the product does now (2026-10): the
-- overlay's live calls and help, Ask your calls, follow-up emails, action
-- items, knowledge, and the one-time recording agreement. A new return type,
-- so the function is dropped and made again with the same grants.

drop function public.admin_feature_adoption(integer);

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
  sample_call     boolean,
  live_calls      bigint,
  overlay_help    bigint,
  questions       bigint,
  follow_ups      bigint,
  action_items    bigint,
  knowledge_docs  bigint,
  agreed          bigint
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
    c.sample_imported_at is not null,
    -- The Cluely-style features (2026-10): calls captured live, the overlay's
    -- help asked for, questions to Ask, follow-up emails drafted, action
    -- items found, documents to answer from, and who agreed to record.
    (select count(*) from public.conversations v where v.company_id = c.id and v.captured_live and v.created_at > v_since),
    (select count(*) from public.model_usage u where u.company_id = c.id and u.detector like 't2-assist%' and u.created_at > v_since),
    (select coalesce(sum(l.amount), 0)::bigint from public.usage_ledger l
      where l.company_id = c.id and l.meter = 'questions' and l.refunded_at is null and l.at > v_since),
    (select count(*) from public.follow_ups x where x.company_id = c.id and x.created_at > v_since),
    (select count(*) from public.action_items x where x.company_id = c.id and x.created_at > v_since),
    -- Standing, like goals: what there is now.
    (select count(*) from public.knowledge_documents x where x.company_id = c.id and x.status = 'ready'),
    (select count(distinct a.user_id) from public.recording_agreements a where a.company_id = c.id)
  from public.companies c
  order by c.name;
end;
$$;

revoke all on function public.admin_feature_adoption(integer) from public, anon;
grant execute on function public.admin_feature_adoption(integer) to authenticated;
