-- The low-severity findings of the security review of 2026-10-04, fixed.
--
-- 1. A ticket link was whatever https address a member gave
--    record_insight_ticket, which could be called directly: a made-up link
--    would then stand for the insight's ticket ("already raised") and block
--    the real one. A link is now only one on the company's own tracker, of
--    the shape that tracker gives its issues.
-- 2. Two quick presses of "Raise ticket" could both reach the tracker before
--    either was recorded, opening two issues. A press now claims the insight
--    first (claim_insight_ticket); a second within two minutes is told one is
--    already being raised. The claim goes when the ticket is recorded, or the
--    route releases it when the tracker refuses.
-- 3. An owner's erasure could be logged with any reason, "retention" or
--    "operator" included. A signed-in caller's erasure is now always their
--    request; only the purge and operator scripts, with no user, name another.
-- 4. import_sample_call took any transcript, once per company, and stored it
--    as the sample — with the sample's note that nobody was recorded. That
--    skipped the consent confirmation a real transcript needs. It now takes
--    only Tesserafy's own sample, by a fingerprint of its words.
--
-- Each is pinned in supabase/tests/database/security_low.test.sql.

-- ---------------------------------------------------------------------------
-- 1 and 2. Tickets
-- ---------------------------------------------------------------------------

create table private.ticket_claims (
  insight_id  uuid primary key references public.insights (id) on delete cascade,
  claimed_at  timestamptz not null default now()
);

-- Whether a link is one this company's tracker would give an issue.
create function private.ticket_url_fits(p_company_id uuid, p_provider text, p_url text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_target text;
  v_prefix text;
begin
  select t.target into v_target from public.company_trackers t
   where t.company_id = p_company_id and t.provider = p_provider;
  if v_target is null or p_url is null then
    return false;
  end if;
  if p_provider = 'github' then
    -- GitHub answers with the repository's own capitalisation, which need not
    -- be how the owner typed it.
    v_prefix := lower('https://github.com/' || v_target || '/issues/');
    return lower(left(p_url, length(v_prefix))) = v_prefix and substr(p_url, length(v_prefix) + 1) ~ '^[0-9]+$';
  elsif p_provider = 'jira' then
    v_prefix := 'https://' || split_part(v_target, '/', 1) || '/browse/' || split_part(v_target, '/', 2) || '-';
    return left(p_url, length(v_prefix)) = v_prefix and substr(p_url, length(v_prefix) + 1) ~ '^[0-9]+$';
  elsif p_provider = 'linear' then
    -- The team key is letters and digits only, so it is safe inside the pattern.
    return p_url ~ ('^https://linear\.app/[A-Za-z0-9_-]+/issue/' || v_target || '-[0-9]+(/[A-Za-z0-9-]*)?$');
  end if;
  return false;
end;
$$;

create or replace function public.record_insight_ticket(
  p_insight_id  uuid,
  p_provider    text,
  p_external_id text,
  p_url         text
)
returns public.insight_tickets
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_insight public.insights;
  v_ticket  public.insight_tickets;
begin
  select * into v_insight from public.insights where id = p_insight_id;
  if not found then
    raise exception 'record_insight_ticket: insight % not found', p_insight_id
      using errcode = 'P0002';
  end if;

  if not (select private.is_company_member(v_insight.company_id)) then
    raise exception 'record_insight_ticket: not a member of that company'
      using errcode = '42501';
  end if;

  if v_insight.status <> 'approved' then
    raise exception 'record_insight_ticket: insight % is %, not approved',
      p_insight_id, v_insight.status
      using errcode = '23514';
  end if;

  if not private.ticket_url_fits(v_insight.company_id, p_provider, p_url) then
    raise exception 'record_insight_ticket: that is not an issue on this company''s tracker'
      using errcode = '22023';
  end if;

  insert into public.insight_tickets
    (company_id, insight_id, provider, external_id, url, created_by)
  values
    (v_insight.company_id, p_insight_id, p_provider, p_external_id, p_url,
     (select auth.uid()))
  returning * into v_ticket;

  delete from private.ticket_claims where insight_id = p_insight_id;
  return v_ticket;
end;
$$;

-- Before the tracker is called: true if this press may raise the ticket.
create function public.claim_insight_ticket(p_insight_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company_id uuid;
  v_claimed    boolean;
begin
  select i.company_id into v_company_id from public.insights i where i.id = p_insight_id;
  if v_company_id is null or not (select private.is_company_member(v_company_id)) then
    raise exception 'claim_insight_ticket: insight not found' using errcode = 'P0002';
  end if;
  insert into private.ticket_claims (insight_id) values (p_insight_id)
  on conflict (insight_id) do update set claimed_at = now()
    where private.ticket_claims.claimed_at < now() - interval '2 minutes'
  returning true into v_claimed;
  return coalesce(v_claimed, false);
end;
$$;

-- The tracker refused: let the next press try.
create function public.release_insight_ticket(p_insight_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company_id uuid;
begin
  select i.company_id into v_company_id from public.insights i where i.id = p_insight_id;
  if v_company_id is null or not (select private.is_company_member(v_company_id)) then
    raise exception 'release_insight_ticket: insight not found' using errcode = 'P0002';
  end if;
  delete from private.ticket_claims where insight_id = p_insight_id;
end;
$$;


-- ---------------------------------------------------------------------------
-- 3. An owner's erasure is their request
-- ---------------------------------------------------------------------------

create or replace function public.erase_conversation(
  p_conversation_id uuid,
  p_reason          text default 'request'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company_id uuid;
  v_uid        uuid := (select auth.uid());
begin
  select c.company_id into v_company_id
  from public.conversations c
  where c.id = p_conversation_id;

  if v_company_id is null then
    raise exception 'erase_conversation: conversation % not found', p_conversation_id
      using errcode = 'P0002';
  end if;

  -- An operator holding the service role has no auth.uid(). A signed-in
  -- caller must own the company: erasure is not an ordinary member's button,
  -- because it cannot be undone and the log cannot bring anything back.
  if v_uid is not null and not exists (
    select 1 from public.company_members m
    where m.company_id = v_company_id and m.user_id = v_uid and m.role = 'owner'
  ) then
    raise exception 'erase_conversation: only an owner may erase'
      using errcode = '42501';
  end if;

  -- What the log says is not the caller's to choose: an owner's erasure is
  -- their request; only the purge and operator scripts name another reason.
  return private.erase_conversation_as(p_conversation_id, case when v_uid is null then p_reason else 'request' end, v_uid);
end;
$$;


-- ---------------------------------------------------------------------------
-- 4. The sample call is Tesserafy's sample
-- ---------------------------------------------------------------------------

-- The md5 of the sample's segment texts, joined by newlines, after redaction
-- (apps/web/lib/sample-call.ts, SAMPLE_FINGERPRINT; a test there fails when
-- the sample changes and this does not).
create or replace function public.import_sample_call(p_title text, p_segments jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company_id uuid := private.sole_company_of_caller();
  v_id         uuid;
  v_words      text;
begin
  if not (select private.is_company_member(v_company_id)) then
    raise exception 'import_sample_call: not a member of a company' using errcode = '42501';
  end if;
  if exists (select 1 from public.companies c where c.id = v_company_id and c.sample_imported_at is not null) then
    raise exception 'import_sample_call: your company has already had the sample call' using errcode = '23505';
  end if;
  if jsonb_typeof(p_segments) is distinct from 'array' then
    raise exception 'import_sample_call: that is not the sample call' using errcode = '22023';
  end if;
  select string_agg(e.value ->> 'text', E'\n' order by e.ordinality) into v_words
    from jsonb_array_elements(p_segments) with ordinality as e(value, ordinality);
  if md5(coalesce(v_words, '')) <> 'a222391bb6e1c6ab147130fcfc5626d7' then
    raise exception 'import_sample_call: that is not the sample call; a real transcript is imported with its consent confirmed'
      using errcode = '22023';
  end if;

  v_id := public.import_conversation(
    p_title             => p_title,
    p_segments          => p_segments,
    p_engagement_type   => 'discovery',
    p_criteria_version  => 1,
    p_consent_statement => 'A sample call written by Tesserafy. Nobody was recorded; the people and companies in it are invented.'
  );
  update public.conversations set is_sample = true where id = v_id;
  update public.companies set sample_imported_at = now() where id = v_company_id;
  return v_id;
exception
  when unique_violation then
    raise exception 'import_sample_call: your company has already had the sample call' using errcode = '23505';
end;
$$;

revoke all on function private.ticket_url_fits(uuid, text, text) from public, anon;
revoke all on function public.claim_insight_ticket(uuid) from public, anon;
revoke all on function public.release_insight_ticket(uuid) from public, anon;
grant execute on function public.claim_insight_ticket(uuid) to authenticated;
grant execute on function public.release_insight_ticket(uuid) to authenticated;
