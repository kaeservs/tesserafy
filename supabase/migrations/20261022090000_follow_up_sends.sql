-- Sending a call's follow-up email from the call page (ADR 0023).
--
-- The email goes out through Tesserafy's sending service, from Tesserafy's
-- sending address with the seller's name on it, replies going to the seller
-- and the seller copied. What went out is kept: to whom, the subject and the
-- words, who sent it, and whether the service took it — because it was sent
-- in a person's name, by infrastructure that is ours.
--
-- A send is recorded before the email leaves (begin_follow_up_send) and
-- settled after (finish_follow_up_send); the record's id is the sending
-- service's idempotency key, so a retried request cannot send twice. It goes
-- with the call (erasure), and the sender is a plain reference that goes null
-- with their account (ADR 0013).
--
-- A support session cannot send: an operator who opened an account to look
-- into something does not email that account's customers in its name.

create table public.follow_up_sends (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references public.companies (id) on delete cascade,
  conversation_id  uuid not null,
  sent_by          uuid references auth.users (id) on delete set null,
  from_name        text not null check (length(trim(from_name)) between 1 and 100 and from_name !~ '[\r\n<>"]'),
  reply_to         text not null check (length(reply_to) between 3 and 320),
  recipients       text[] not null check (cardinality(recipients) between 1 and 10),
  subject          text not null check (length(trim(subject)) between 1 and 200 and subject !~ '[\r\n]'),
  body             text not null check (length(trim(body)) between 1 and 20000),
  status           text not null default 'sending' check (status in ('sending', 'sent', 'failed')),
  provider_id      text check (provider_id is null or length(provider_id) <= 200),
  error            text check (error is null or length(error) <= 300),
  created_at       timestamptz not null default now(),
  settled_at       timestamptz,
  foreign key (company_id, conversation_id)
    references public.conversations (company_id, id) on delete cascade
);

create index follow_up_sends_call_idx on public.follow_up_sends (conversation_id, created_at desc);
create index follow_up_sends_company_idx on public.follow_up_sends (company_id, created_at desc);

comment on table public.follow_up_sends is
  'Each follow-up email sent from a call page: recipients, subject, words, sender, and whether the sending service took it.';

alter table public.follow_up_sends enable row level security;

create policy "members read their company's sent follow-ups"
  on public.follow_up_sends for select to authenticated
  using ((select private.is_company_member(company_id)));


-- Whether the caller's session began inside a support window, open or not:
-- the session an operator's sign-in link started.
create function private.in_support_session()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from auth.sessions s
      join public.support_access a on a.subject_user_id = s.user_id
     where s.id = nullif((select auth.jwt()) ->> 'session_id', '')::uuid
       and s.user_id = (select auth.uid())
       and s.created_at >= a.created_at
       and s.created_at <= a.expires_at
  );
$$;

revoke all on function private.in_support_session() from public, anon;


-- Before the email leaves: checks it, records it as sending, and says the
-- address replies go to (the sender's own).
create function public.begin_follow_up_send(
  p_conversation_id uuid,
  p_from_name       text,
  p_recipients      text[],
  p_subject         text,
  p_body            text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid        uuid := (select auth.uid());
  v_company_id uuid;
  v_email      text;
  v_to         text[];
  v_id         uuid;
begin
  select c.company_id into v_company_id from public.conversations c where c.id = p_conversation_id;
  if v_uid is null or v_company_id is null or not (select private.is_company_member(v_company_id)) then
    raise exception 'begin_follow_up_send: call not found' using errcode = 'P0002';
  end if;
  if (select private.in_support_session()) then
    raise exception 'begin_follow_up_send: a support session does not send email in the customer''s name'
      using errcode = '42501';
  end if;
  if not exists (select 1 from public.follow_ups f where f.conversation_id = p_conversation_id) then
    raise exception 'begin_follow_up_send: draft the follow-up first' using errcode = 'P0002';
  end if;

  select array_agg(distinct lower(trim(r))) into v_to from unnest(p_recipients) r where trim(r) <> '';
  if v_to is null or cardinality(v_to) > 10
     or exists (select 1 from unnest(v_to) r where r !~ '^[^@\s<>",;]+@[^@\s<>",;]+\.[^@\s<>",;]+$' or length(r) > 320) then
    raise exception 'begin_follow_up_send: one to ten email addresses' using errcode = '22023';
  end if;

  -- However it is asked, a company sends at most thirty an hour.
  if (select count(*) from public.follow_up_sends s
       where s.company_id = v_company_id and s.created_at > now() - interval '1 hour') >= 30 then
    raise exception 'begin_follow_up_send: too many follow-ups sent this hour' using errcode = '54000';
  end if;

  select u.email into v_email from auth.users u where u.id = v_uid;
  if coalesce(v_email, '') = '' then
    raise exception 'begin_follow_up_send: your account has no email address to reply to' using errcode = '22023';
  end if;

  insert into public.follow_up_sends
    (company_id, conversation_id, sent_by, from_name, reply_to, recipients, subject, body)
  values
    (v_company_id, p_conversation_id, v_uid, trim(p_from_name), v_email, v_to, trim(p_subject), p_body)
  returning id into v_id;

  return jsonb_build_object('id', v_id, 'reply_to', v_email, 'recipients', to_jsonb(v_to));
end;
$$;

-- After: what the sending service said. Only the sender settles their send,
-- and only once.
create function public.finish_follow_up_send(
  p_id          uuid,
  p_provider_id text default null,
  p_error       text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.follow_up_sends
     set status = case when p_error is null then 'sent' else 'failed' end,
         provider_id = left(p_provider_id, 200),
         error = left(p_error, 300),
         settled_at = now()
   where id = p_id and sent_by = (select auth.uid()) and status = 'sending';
  if not found then
    raise exception 'finish_follow_up_send: not a send of yours in progress' using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function public.begin_follow_up_send(uuid, text, text[], text, text) from public, anon;
revoke all on function public.finish_follow_up_send(uuid, text, text) from public, anon;
grant execute on function public.begin_follow_up_send(uuid, text, text[], text, text) to authenticated;
grant execute on function public.finish_follow_up_send(uuid, text, text) to authenticated;
