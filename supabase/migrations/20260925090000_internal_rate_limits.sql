-- Internal companies get their own rate limits.
--
-- pnpm qa uploads its probe transcript as the test account, and the upload
-- limit is sized for a customer: ten a day. A day of testing used it up and QA
-- failed with a 429 that had nothing to do with the change being tested.
--
-- take_rate_limit_tokens gains an optional second set of windows, used when
-- the caller belongs to a company on the 'internal' plan. The plan is read
-- inside the function, so this costs no extra round trip on a path that is
-- already over its latency budget. The limits themselves stay in the app,
-- beside the customer ones, because they are a product decision.
--
-- Replaced rather than overloaded: two functions that both accept p_bucket and
-- p_windows would make every existing call ambiguous.

drop function public.take_rate_limit_tokens(text, jsonb);

create function public.take_rate_limit_tokens(
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

  if jsonb_typeof(p_windows) is distinct from 'array' or jsonb_array_length(p_windows) = 0 then
    raise exception 'take_rate_limit_tokens: p_windows must be a non-empty array'
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
    if jsonb_typeof(p_internal_windows) is distinct from 'array' or jsonb_array_length(p_internal_windows) = 0 then
      raise exception 'take_rate_limit_tokens: p_internal_windows must be a non-empty array'
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
