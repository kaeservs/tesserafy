-- A ceiling on what one account can spend.
--
-- Filename carries the version the remote assigned when this was applied,
-- for the same reason as system_failures: the pooler `supabase db push`
-- needs is unreliable, so this went in over REST, which numbers its own.
--
-- /api/detect and /api/suggest call Anthropic on every request, and until now
-- a signed-in session could call them in a loop. The bill is ours. Nothing
-- about that requires malice: a retry loop in the overlay, a replay script
-- left running, or a page that re-renders more than its author expected all
-- produce the same invoice.
--
-- The counter is in Postgres rather than in memory or at a key-value vendor.
-- In memory is not a limit at all here: the web app runs as many instances as
-- the platform feels like starting, so a per-instance bucket is the limit
-- multiplied by however many are warm. A vendor would be the third new data
-- processor this month, for a product that sells to companies about their
-- customers' calls. Postgres is already in the request path, already knows who
-- the caller is, and lets the limit be per account rather than per IP, which
-- is the unit that actually matters: the risk is a session in a loop, not a
-- stranger.
--
-- The cost is one round trip on a latency-critical endpoint, which is why
-- every window a route wants is checked in that one call rather than one call
-- each.

create table public.rate_limit_counters (
  -- auth.uid(), never a value the caller supplies. A limit keyed on something
  -- from the request is a limit the request can step around.
  subject       uuid not null,
  bucket        text not null check (length(trim(bucket)) > 0),
  -- The start of the fixed window this count belongs to, so the row is the
  -- key: no read-modify-write, no lock, and nothing to reconcile.
  window_start  timestamptz not null,
  window_seconds integer not null check (window_seconds > 0),
  count         integer not null default 0 check (count >= 0),

  primary key (subject, bucket, window_seconds, window_start)
);

create index rate_limit_counters_window_start_idx
  on public.rate_limit_counters (window_start);

comment on table public.rate_limit_counters is
  'Fixed-window request counts per account. Disposable: losing it costs one window of limiting.';

alter table public.rate_limit_counters enable row level security;

-- No policy, deliberately. Nothing reads this but the function below, which is
-- SECURITY DEFINER; a member has no reason to read their own counter and less
-- to read anyone else's.


-- ---------------------------------------------------------------------------
-- Taking a token
-- ---------------------------------------------------------------------------
-- Each window's insert is atomic under concurrency: it either creates that
-- window's row or increments it, and the returned count is this caller's
-- position in it. Two requests arriving together get 1 and 2, never 1 and 1.
--
-- Both windows are counted even when the first one already refused. A request
-- that was turned away still happened, and a caller in a loop should not be
-- able to hammer a cheap window to keep the expensive one clean.
--
-- A fixed window admits up to twice the limit across a boundary. That is known
-- and accepted: this exists to stop a runaway loop costing hundreds of
-- dollars, not to shape traffic precisely, and a sliding window would cost a
-- second statement on the hot path to fix a factor of two.

create function public.take_rate_limit_tokens(
  p_bucket text,
  -- [{"seconds": 60, "limit": 60}, {"seconds": 86400, "limit": 3000}]
  p_windows jsonb
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
begin
  if v_subject is null then
    raise exception 'take_rate_limit_tokens: nobody is signed in'
      using errcode = '42501';
  end if;

  if jsonb_typeof(p_windows) is distinct from 'array' or jsonb_array_length(p_windows) = 0 then
    raise exception 'take_rate_limit_tokens: p_windows must be a non-empty array'
      using errcode = '22023';
  end if;

  for v_window in select * from jsonb_array_elements(p_windows) loop
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

revoke all on function public.take_rate_limit_tokens(text, jsonb) from public, anon;
grant execute on function public.take_rate_limit_tokens(text, jsonb)
  to authenticated, service_role;
