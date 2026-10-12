-- The 2026-10-12 security review: the database's share of what it found.
-- Nothing here crossed tenants; each item is something a signed-in person
-- could do to their own company's records, or to our bill, that they should
-- not be able to.
--
--   1. Failure rows name a route, and usage rows count tokens a model could
--      have used. A member calling record_failure directly could put a URL or
--      a message of their own into ops_digest's source, which goes on to a
--      chat app (ADR 0019: counts and kinds only), and record_model_usage
--      took any integer, so one row could add ~$64k of spend to the console.
--   2. take_rate_limit_tokens took any number of windows and any bucket name,
--      so one call could write a hundred thousand rows.
--   3. A note's author could still delete it after leaving the company.
--   4. While nothing is paid for, a company's seats are limited to its people
--      and a few more: seats multiply the allowance, and an owner could give
--      themselves 500 for nothing.
--   5. A call or a prep dated far in the future was never purged by
--      retention, which counts from that date.
--
-- Constraints are added NOT VALID: they hold for every row written from now
-- on, and rows already there are ours.

-- 1 ---------------------------------------------------------------------------

alter table public.system_failures
  add constraint system_failures_source_is_a_route
  check (source ~ '^[a-z0-9/_.-]{1,64}$') not valid;

alter table public.model_usage
  add constraint model_usage_tokens_are_possible
  check (
    input_tokens <= 2000000 and output_tokens <= 300000
    and cache_creation_tokens <= 2000000 and cache_read_tokens <= 2000000
    and duration_ms <= 3600000
  ) not valid,
  add constraint model_usage_model_is_a_name
  check (model ~ '^[a-z0-9.-]{1,64}$') not valid;


-- 2 ---------------------------------------------------------------------------

create or replace function public.take_rate_limit_tokens(
  p_bucket text,
  -- [{"seconds": 60, "limit": 60}, {"seconds": 86400, "limit": 3000}]
  p_windows jsonb,
  -- The same shape, used instead when the caller belongs to an internal
  -- company. Optional: a bucket with no internal limits has none.
  p_internal_windows jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_subject uuid := (select auth.uid());
  v_window jsonb;
  v_seconds integer;
  v_limit integer;
  v_window_start timestamptz;
  v_count integer;
  v_allowed boolean := true;
  v_retry_after integer := 0;
  v_blocked text := null;
  v_windows jsonb := p_windows;
begin
  if v_subject is null then
    raise exception 'take_rate_limit_tokens: nobody is signed in'
      using errcode = '42501';
  end if;

  -- A bucket is a route's name, and a route has a minute and a day: anything
  -- larger only writes rows (security review, 2026-10-12).
  if p_bucket is null or p_bucket !~ '^[a-z0-9/_:.-]{1,64}$' then
    raise exception 'take_rate_limit_tokens: a bucket is a short name'
      using errcode = '22023';
  end if;
  if jsonb_typeof(p_windows) is distinct from 'array' or jsonb_array_length(p_windows) not between 1 and 4 then
    raise exception 'take_rate_limit_tokens: p_windows must be one to four windows'
      using errcode = '22023';
  end if;

  -- Internal companies — the owner's own testing, and pnpm qa — get their own
  -- limits, so a day of testing does not exhaust a quota sized for customers.
  -- The plan is only ever set by the service role: companies has a select
  -- policy and no update policy, so a member cannot promote themselves.
  if p_internal_windows is not null and exists (
    select 1
    from public.company_members m
    join public.companies c on c.id = m.company_id
    where m.user_id = v_subject and c.plan = 'internal'
  ) then
    if jsonb_typeof(p_internal_windows) is distinct from 'array' or jsonb_array_length(p_internal_windows) not between 1 and 4 then
      raise exception 'take_rate_limit_tokens: p_internal_windows must be one to four windows'
        using errcode = '22023';
    end if;
    v_windows := p_internal_windows;
  end if;

  for v_window in select * from jsonb_array_elements(v_windows) loop
    v_seconds := (v_window ->> 'seconds')::integer;
    v_limit := (v_window ->> 'limit')::integer;

    if v_seconds is null or v_limit is null or v_seconds < 1 or v_limit < 1 then
      raise exception 'take_rate_limit_tokens: every window needs a positive seconds and limit'
        using errcode = '22023';
    end if;

    v_window_start := to_timestamp(
      floor(extract(epoch from clock_timestamp()) / v_seconds) * v_seconds
    );

    insert into public.rate_limit_counters as c
      (subject, bucket, window_seconds, window_start, count)
    values (v_subject, p_bucket, v_seconds, v_window_start, 1)
    on conflict (subject, bucket, window_seconds, window_start)
      do update set count = c.count + 1
    returning c.count into v_count;

    if v_count > v_limit then
      v_allowed := false;
      -- The longest wait wins: telling a caller to retry in one second when a
      -- daily cap is what stopped them is worse than telling them nothing.
      v_retry_after := greatest(
        v_retry_after,
        ceil(extract(epoch from (v_window_start + make_interval(secs => v_seconds) - clock_timestamp())))::integer
      );
      if v_blocked is null or v_seconds > (v_blocked::integer) then
        v_blocked := v_seconds::text;
      end if;
    end if;
  end loop;

  -- Old windows are dead weight and nothing reads them. Swept rarely rather
  -- than scheduled, because a cron job for a disposable table is a moving part
  -- that can fail quietly; losing the sweep costs disk, not correctness.
  if random() < 0.001 then
    delete from public.rate_limit_counters
    where window_start < now() - interval '2 days';
  end if;

  return jsonb_build_object(
    'allowed', v_allowed,
    'retry_after_seconds', greatest(v_retry_after, 0),
    'blocked_window_seconds', v_blocked
  );
end;
$$;

revoke all on function public.take_rate_limit_tokens(text, jsonb, jsonb) from public, anon;
grant execute on function public.take_rate_limit_tokens(text, jsonb, jsonb)
  to authenticated, service_role;


-- 3 ---------------------------------------------------------------------------

create or replace function public.delete_segment_note(p_note_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Its author, while still in the company (as edit_segment_note already
  -- asks), or an owner of it.
  delete from public.segment_notes n
   where n.id = p_note_id
     and ((n.author = (select auth.uid()) and (select private.is_company_member(n.company_id)))
          or exists (select 1 from public.company_members m
                      where m.company_id = n.company_id
                        and m.user_id = (select auth.uid())
                        and m.role = 'owner'));
  if not found then
    raise exception 'delete_segment_note: only its author or an owner can remove a note' using errcode = '42501';
  end if;
end;
$$;

revoke all on function public.delete_segment_note(uuid) from public, anon;
grant execute on function public.delete_segment_note(uuid) to authenticated;


-- 4 ---------------------------------------------------------------------------

create or replace function public.change_seats(p_seats integer)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid        uuid := (select auth.uid());
  v_company_id uuid := private.sole_company_of_caller();
  v_sub        public.subscriptions;
  v_plan       public.plans;
  v_members    integer;
begin
  if not exists (
    select 1 from public.company_members m
     where m.company_id = v_company_id and m.user_id = v_uid and m.role = 'owner'
  ) or (select private.in_support_session()) then
    raise exception 'change_seats: only an owner can change the seats' using errcode = '42501';
  end if;
  select * into v_sub from public.subscriptions where company_id = v_company_id for update;
  select p.* into v_plan from public.plans p join public.companies c on c.plan = p.id where c.id = v_company_id;
  if not v_plan.per_seat then
    raise exception 'change_seats: seats come with Starter, Pro or Incognito' using errcode = '22023';
  end if;
  if v_sub.provider <> 'none' then
    raise exception 'change_seats: you pay through your billing page; change the seats there' using errcode = '22023';
  end if;
  select count(*) into v_members from public.company_members m where m.company_id = v_company_id;
  if p_seats is null or p_seats < greatest(v_members, 1) or p_seats > 500 then
    raise exception 'change_seats: at least one for everyone in the company (%), and at most 500', v_members using errcode = '22023';
  end if;
  -- Nothing is being paid for these seats (payments are off, or the plan was
  -- set without them), and each seat brings its allowance: a seat is for a
  -- person, so at most five ahead of the people there (security review,
  -- 2026-10-12). Paid seats are set where they are paid for.
  if p_seats > v_members + 5 then
    raise exception 'change_seats: add seats as you add people — at most five more than the % in the company until seats are paid for', v_members
      using errcode = '22023';
  end if;
  update public.subscriptions set seats = p_seats, updated_at = now() where company_id = v_company_id;
  insert into public.subscription_events (company_id, kind, from_plan, to_plan, source, actor)
  values (v_company_id, 'seats_changed', v_plan.id, v_plan.id, 'owner', v_uid);
  return p_seats;
end;
$$;

revoke all on function public.change_seats(integer) from public, anon;
grant execute on function public.change_seats(integer) to authenticated;


-- 5 ---------------------------------------------------------------------------

alter table public.conversations
  add constraint conversations_occurred_not_in_the_future
  check (occurred_at is null or occurred_at <= created_at + interval '1 day') not valid;

alter table public.call_preps
  add constraint call_preps_call_within_a_year
  check (call_at is null or call_at <= created_at + interval '1 year') not valid;
