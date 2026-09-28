-- Feedback: a way for a customer to tell us something from inside the product,
-- and for an operator to see it and say it has been dealt with.
--
-- Until now there was no channel at all short of an email address nobody had
-- been given. A member writes; the row records who, from which page, and when.
-- They can read back what they sent and whether it was seen. Operators read
-- every company's and mark each seen or done — as themselves, through RLS and
-- a function that checks they are one, never with the service-role key.
--
-- A member sends at most 20 a day: a box that writes rows needs a ceiling,
-- and 20 is far past anyone with something to say.

create table public.feedback (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies (id) on delete cascade,
  sent_by     uuid references auth.users (id) on delete set null,
  body        text not null check (length(trim(body)) between 1 and 4000),
  -- Where they were when they wrote it: a path in the web app, no query.
  page        text check (page is null or (page ~ '^/[A-Za-z0-9/_\-\[\]]*$' and length(page) <= 200)),
  status      text not null default 'new' check (status in ('new', 'seen', 'done')),
  handled_by  uuid references auth.users (id) on delete set null,
  handled_at  timestamptz,
  created_at  timestamptz not null default now()
);

create index feedback_status_idx on public.feedback (status, created_at desc);
create index feedback_sender_idx on public.feedback (sent_by, created_at desc);

comment on table public.feedback is
  'What customers tell us from inside the product. Senders read their own; operators read all and mark them handled.';

alter table public.feedback enable row level security;

create policy "senders read what they sent"
  on public.feedback for select to authenticated
  using (sent_by = (select auth.uid()));

create policy "admins read all feedback"
  on public.feedback for select to authenticated
  using ((select private.is_platform_admin()));


create function public.send_feedback(p_body text, p_page text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company_id uuid := private.sole_company_of_caller();
  v_body       text := trim(coalesce(p_body, ''));
  v_page       text := nullif(split_part(split_part(trim(coalesce(p_page, '')), '?', 1), '#', 1), '');
  v_id         uuid;
begin
  if not (select private.is_company_member(v_company_id)) then
    raise exception 'send_feedback: not a member of a company' using errcode = '42501';
  end if;
  if length(v_body) not between 1 and 4000 then
    raise exception 'send_feedback: feedback is 1 to 4000 characters' using errcode = '22023';
  end if;
  if v_page is not null and (v_page !~ '^/[A-Za-z0-9/_\-\[\]]*$' or length(v_page) > 200) then
    v_page := null;
  end if;
  if (select count(*) from public.feedback f
       where f.sent_by = (select auth.uid()) and f.created_at > now() - interval '1 day') >= 20 then
    raise exception 'send_feedback: that is 20 today; the rest will keep until tomorrow' using errcode = '54000';
  end if;

  insert into public.feedback (company_id, sent_by, body, page)
  values (v_company_id, (select auth.uid()), v_body, v_page)
  returning id into v_id;
  return v_id;
end;
$$;

-- Mark it seen or done (or back to new). Operators only.
create function public.admin_set_feedback_status(p_feedback_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not (select private.is_platform_admin()) then
    raise exception 'admin_set_feedback_status: not a platform admin' using errcode = '42501';
  end if;
  if p_status is null or p_status not in ('new', 'seen', 'done') then
    raise exception 'admin_set_feedback_status: new, seen or done' using errcode = '22023';
  end if;
  update public.feedback
     set status = p_status,
         handled_by = case when p_status = 'new' then null else (select auth.uid()) end,
         handled_at = case when p_status = 'new' then null else now() end
   where id = p_feedback_id;
  if not found then
    raise exception 'admin_set_feedback_status: feedback not found' using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function public.send_feedback(text, text) from public, anon;
revoke all on function public.admin_set_feedback_status(uuid, text) from public, anon;
grant execute on function public.send_feedback(text, text) to authenticated;
grant execute on function public.admin_set_feedback_status(uuid, text) to authenticated;
