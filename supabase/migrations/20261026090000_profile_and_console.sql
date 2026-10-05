-- The profile page, and what the console did not yet show of the newest
-- features (2026-10-05).
--
-- 1. A person's name, set on their profile. Nobody had one: an account was an
--    address. It is the name a follow-up email goes out under unless they type
--    another, and it is theirs alone, in their own preferences row.
-- 2. Adoption counts what the product does now: follow-up emails sent, calls
--    logged to the CRM, calendars connected, calls that found their meeting,
--    and whether the company pays through Stripe. A new return type, so the
--    function is dropped and made again with the same grants.
-- 3. A company's integrations and billing, for its console page: its CRM and
--    tracker, how many of its people connected a calendar, and how it pays —
--    what an operator closing a company must cancel in Stripe by hand.


-- 1. A person's name ----------------------------------------------------------

alter table public.user_preferences
  add column display_name text check (display_name is null or (length(trim(display_name)) between 1 and 100 and display_name !~ '[\r\n<>"]'));

comment on column public.user_preferences.display_name is
  'The person''s name, as they set it on their profile: the name follow-up emails go out under unless they type another.';

create function public.set_display_name(p_name text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    raise exception 'set_display_name: sign in first' using errcode = '42501';
  end if;
  insert into public.user_preferences (user_id, display_name)
  values (v_uid, nullif(trim(p_name), ''))
  on conflict (user_id) do update set display_name = excluded.display_name, updated_at = now();
end;
$$;

revoke all on function public.set_display_name(text) from public, anon;
grant execute on function public.set_display_name(text) to authenticated;


-- 2. Adoption -----------------------------------------------------------------

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
  agreed          bigint,
  emails_sent     bigint,
  crm_logged      bigint,
  calendars       bigint,
  meetings_found  bigint,
  pays_stripe     boolean
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
    (select count(*) from public.conversations v where v.company_id = c.id and v.captured_live and v.created_at > v_since),
    (select count(*) from public.model_usage u where u.company_id = c.id and u.detector like 't2-assist%' and u.created_at > v_since),
    (select coalesce(sum(l.amount), 0)::bigint from public.usage_ledger l
      where l.company_id = c.id and l.meter = 'questions' and l.refunded_at is null and l.at > v_since),
    (select count(*) from public.follow_ups x where x.company_id = c.id and x.created_at > v_since),
    (select count(*) from public.action_items x where x.company_id = c.id and x.created_at > v_since),
    -- Standing, like goals: what there is now.
    (select count(*) from public.knowledge_documents x where x.company_id = c.id and x.status = 'ready'),
    (select count(distinct a.user_id) from public.recording_agreements a where a.company_id = c.id),
    -- The newest (2026-10-05): follow-ups that went out, calls logged to the
    -- CRM, people with a calendar connected (standing), calls that found their
    -- meeting, and whether it pays through Stripe now.
    (select count(*) from public.follow_up_sends x where x.company_id = c.id and x.status = 'sent' and x.created_at > v_since),
    (select count(*) from public.crm_logs x where x.company_id = c.id and x.logged_at > v_since),
    (select count(distinct x.user_id) from public.calendar_connections x where x.company_id = c.id),
    (select count(distinct x.conversation_id) from public.call_attendees x
       join public.conversations v on v.id = x.conversation_id
      where x.company_id = c.id and v.created_at > v_since),
    exists (select 1 from public.subscriptions s where s.company_id = c.id and s.provider = 'stripe')
  from public.companies c
  order by c.name;
end;
$$;

revoke all on function public.admin_feature_adoption(integer) from public, anon;
grant execute on function public.admin_feature_adoption(integer) to authenticated;


-- 3. A company's integrations and billing --------------------------------------

-- Counts, connections and ids — never a token, a calendar's meetings, or what
-- was written anywhere. Calendars are each person's own, so only how many.
create function public.admin_company_integrations(p_company_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (select private.is_platform_admin()) then
    raise exception 'admin_company_integrations: not a platform admin' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'crm', (select jsonb_build_object('provider', t.provider, 'account_ref', t.account_ref, 'connected_at', t.connected_at,
                                      'last_error', t.last_error,
                                      'notes', (select count(*) from public.crm_logs l where l.company_id = t.company_id))
              from public.company_crms t where t.company_id = p_company_id),
    'tracker', (select jsonb_build_object('provider', t.provider, 'target', t.target, 'connected_at', t.connected_at)
                  from public.company_trackers t where t.company_id = p_company_id),
    'calendars', (select count(distinct x.user_id) from public.calendar_connections x where x.company_id = p_company_id),
    'emails_sent', (select count(*) from public.follow_up_sends x where x.company_id = p_company_id and x.status = 'sent'),
    'billing', (select jsonb_build_object('provider', s.provider, 'status', s.status,
                                          'customer_id', s.provider_customer_id, 'subscription_id', s.provider_subscription_id,
                                          'period_end', case when s.period_end = 'infinity'::timestamptz then null else s.period_end end,
                                          'cancel_at_period_end', s.cancel_at_period_end)
                  from public.subscriptions s where s.company_id = p_company_id),
    'last_stripe_event', (select jsonb_build_object('type', e.type, 'outcome', e.outcome, 'received_at', e.received_at)
                            from public.stripe_events e where e.company_id = p_company_id
                           order by e.received_at desc limit 1)
  );
end;
$$;

revoke all on function public.admin_company_integrations(uuid) from public, anon;
grant execute on function public.admin_company_integrations(uuid) to authenticated;
