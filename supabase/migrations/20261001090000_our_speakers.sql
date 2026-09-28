-- Which speakers are ours: the names a company's own people appear under in
-- transcripts, so "who talked" can say seller against customer.
--
-- A transcript names speakers and nothing more. Nothing says "Dana Whitfield"
-- sells for this company and "Priya Raman" is buying, and a guess from team
-- email addresses breaks on the first nickname. So a person says so, once:
-- marking a name on any call marks it on every call, past and future. Any
-- member may, because the sellers are the ones who know who they are.
--
-- Names are people's names. A closed company forgets them, as it forgets its
-- customer accounts.
--
-- conversation_talk() counts words and questions per speaker per call in the
-- database, so Reports does not pull every line of every call to count them.
-- It runs as the caller (security invoker): RLS on segments decides which
-- calls it counts. The counting matches apps/web/lib/talk.ts — a word is a
-- run of non-space, a question is a run of question marks.

create table public.our_speakers (
  company_id  uuid not null references public.companies (id) on delete cascade,
  name        text not null check (length(trim(name)) between 1 and 120 and name = trim(name)),
  added_by    uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now()
);

create unique index our_speakers_name_idx on public.our_speakers (company_id, lower(name));

comment on table public.our_speakers is
  'Speaker names that are the company''s own people, for seller-against-customer talk time. Any member marks them.';

alter table public.our_speakers enable row level security;

create policy "members read their company's speakers"
  on public.our_speakers for select to authenticated
  using ((select private.is_company_member(company_id)));

create policy "admins read all speakers"
  on public.our_speakers for select to authenticated
  using ((select private.is_platform_admin()));


-- Mark a name as one of ours, or unmark it. Any member of the caller's company.
create function public.set_our_speaker(p_name text, p_ours boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company_id uuid := private.sole_company_of_caller();
  v_name       text := regexp_replace(trim(coalesce(p_name, '')), '\s+', ' ', 'g');
begin
  if not (select private.is_company_member(v_company_id)) then
    raise exception 'set_our_speaker: not a member of a company' using errcode = '42501';
  end if;
  if length(v_name) not between 1 and 120 then
    raise exception 'set_our_speaker: a speaker''s name is 1 to 120 characters' using errcode = '22023';
  end if;
  if p_ours is null then
    raise exception 'set_our_speaker: say whether the speaker is ours' using errcode = '22023';
  end if;

  if p_ours then
    insert into public.our_speakers (company_id, name, added_by)
    values (v_company_id, v_name, (select auth.uid()))
    on conflict (company_id, lower(name)) do nothing;
  else
    delete from public.our_speakers s where s.company_id = v_company_id and lower(s.name) = lower(v_name);
  end if;
end;
$$;

revoke all on function public.set_our_speaker(text, boolean) from public, anon;
grant execute on function public.set_our_speaker(text, boolean) to authenticated;


-- Words and questions per speaker per call, for the calls the caller can read
-- that took place on or after p_since.
create function public.conversation_talk(p_since timestamptz)
returns table (conversation_id uuid, speaker text, words bigint, questions bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  select s.conversation_id, s.speaker, sum(regexp_count(s.text, '\S+'))::bigint, sum(regexp_count(s.text, '\?+'))::bigint
  from public.segments s
  join public.conversations c on c.id = s.conversation_id
  where coalesce(c.occurred_at, c.created_at) >= p_since
  group by s.conversation_id, s.speaker;
$$;

revoke all on function public.conversation_talk(timestamptz) from public, anon;
grant execute on function public.conversation_talk(timestamptz) to authenticated;


-- A closed company keeps no list of its people's names.
create function private.forget_speakers_on_close()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.closed_at is not null and old.closed_at is null then
    delete from public.our_speakers where company_id = new.id;
  end if;
  return new;
end;
$$;

create trigger companies_forget_speakers_on_close
  after update of closed_at on public.companies
  for each row execute function private.forget_speakers_on_close();
