-- What an alerting workflow may read (ADR 0019): counts and states, through
-- one function, with a token an operator made — never the service-role key.
--
-- The alarm today is a scheduled GitHub Action failing, which nobody is told
-- about unless they look; on 2026-10-01 the model account ran out of credit
-- and every AI feature was down without a message to anyone. A workflow on
-- the company's own n8n is to send that message. It must not hold the
-- service-role key (invariant 3), and what it reads leaves for a chat app,
-- so it reads only this: failures grouped by kind and where, with no message
-- (a failure's message, scrubbed or not, can quote a customer); whether the
-- model provider is refusing us for money; how many companies are new and
-- how many requests wait on an operator; and the AI spend in total. No
-- company names, no people, nothing from a call.
--
-- The token is made in the console by an operator and shown once; only its
-- sha256 is stored, as for plan refunds. Making a new one replaces the old,
-- and it can be revoked. ops_digest is callable with the public key and the
-- token, and with nothing else.
--
-- The judgement of what needs a person matches packages/db/src/health.ts
-- (ACTIONABLE_KINDS, ALARM_AT); a unit test there reads this file and fails
-- when the two differ.

create table private.ops_tokens (
  id          uuid primary key default gen_random_uuid(),
  token_hash  bytea not null unique,
  hint        text not null check (length(hint) between 1 and 8),
  created_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  last_used   timestamptz,
  revoked_at  timestamptz
);

-- One live token at a time.
create unique index ops_tokens_one_live on private.ops_tokens ((true)) where revoked_at is null;


-- Make the token the workflow will send. Returns it once; revokes the last.
create function public.admin_create_ops_token()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token text := 'ops_' || replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
begin
  if not (select private.is_platform_admin()) then
    raise exception 'admin_create_ops_token: operators only' using errcode = '42501';
  end if;
  update private.ops_tokens set revoked_at = now() where revoked_at is null;
  insert into private.ops_tokens (token_hash, hint, created_by)
  values (sha256(convert_to(v_token, 'UTF8')), right(v_token, 4), (select auth.uid()));
  return v_token;
end;
$$;

create function public.admin_revoke_ops_token()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not (select private.is_platform_admin()) then
    raise exception 'admin_revoke_ops_token: operators only' using errcode = '42501';
  end if;
  update private.ops_tokens set revoked_at = now() where revoked_at is null;
end;
$$;

-- What the console shows: whether there is a token, its last four, when it was last used.
create function public.admin_ops_token()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (select private.is_platform_admin()) then
    raise exception 'admin_ops_token: operators only' using errcode = '42501';
  end if;
  return (
    select jsonb_build_object('hint', t.hint, 'created_at', t.created_at, 'last_used', t.last_used)
      from private.ops_tokens t where t.revoked_at is null
  );
end;
$$;


create function public.ops_digest(p_token text, p_hours integer default 4)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_since timestamptz;
begin
  if p_token is null or not exists (
    select 1 from private.ops_tokens t
     where t.revoked_at is null and t.token_hash = sha256(convert_to(p_token, 'UTF8'))
  ) then
    raise exception 'ops_digest: not a current token' using errcode = '42501';
  end if;
  if p_hours is null or p_hours not between 1 and 168 then
    raise exception 'ops_digest: p_hours is 1 to 168' using errcode = '22023';
  end if;
  update private.ops_tokens set last_used = now() where revoked_at is null;
  v_since := now() - make_interval(hours => p_hours);

  return jsonb_build_object(
    'hours', p_hours,
    'at', now(),
    -- Grouped as `pnpm health` groups them: kind, where, upstream status.
    'failures', coalesce((
      select jsonb_agg(g order by g.needs_a_person desc, g.count desc)
        from (
          select f.kind, f.source, f.status, count(*)::int as count, max(f.created_at) as last,
                 f.kind in ('model_rejected', 'database', 'billing') as needs_a_person
            from public.system_failures f
           where f.created_at >= v_since
           group by f.kind, f.source, f.status
        ) g), '[]'::jsonb),
    -- An actionable group repeated ALARM_AT (2) times or more.
    'alarming', coalesce((
      select sum(g.count)::int from (
        select count(*) as count from public.system_failures f
         where f.created_at >= v_since and f.kind in ('model_rejected', 'database', 'billing')
         group by f.kind, f.source, f.status having count(*) >= 2
      ) g), 0),
    'billing', exists (select 1 from public.system_failures f where f.created_at >= v_since and f.kind = 'billing'),
    'new_companies', (select count(*)::int from public.companies c where c.created_at >= v_since),
    'waiting', jsonb_build_object(
      'access_requests', (select count(*)::int from public.access_requests r where r.resolved_at is null),
      'deletion_requests', (select count(*)::int from public.account_deletion_requests r where r.resolved_at is null),
      'provisioning', (select count(*)::int from public.account_provisioning p where p.completed_at is null)
    ),
    'spend_usd', jsonb_build_object(
      'window', coalesce((select round(sum(private.usage_usd(u.model, u.input_tokens, u.cache_creation_tokens, u.cache_read_tokens, u.output_tokens))::numeric, 2)
                            from public.model_usage u where u.created_at >= v_since), 0),
      'last_7_days', coalesce((select round(sum(private.usage_usd(u.model, u.input_tokens, u.cache_creation_tokens, u.cache_read_tokens, u.output_tokens))::numeric, 2)
                                 from public.model_usage u where u.created_at >= now() - interval '7 days'), 0)
    )
  );
end;
$$;

revoke all on function public.admin_create_ops_token() from public, anon;
revoke all on function public.admin_revoke_ops_token() from public, anon;
revoke all on function public.admin_ops_token() from public, anon;
revoke all on function public.ops_digest(text, integer) from public;
grant execute on function public.admin_create_ops_token() to authenticated;
grant execute on function public.admin_revoke_ops_token() to authenticated;
grant execute on function public.admin_ops_token() to authenticated;
-- The workflow has no user: the public key, and the token, are all it holds.
grant execute on function public.ops_digest(text, integer) to anon, authenticated;
