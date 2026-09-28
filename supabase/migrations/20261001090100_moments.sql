-- Examples: moments in calls worth learning from, filed under the criterion
-- they show being met — how someone got the budget out of a buyer, how a pain
-- was quantified. A new seller reads the library by criterion.
--
-- A moment is a line of a transcript, not a copy of it: it points at the
-- segment, so the words shown are the words stored, and deleting the call
-- deletes the example with it. The criterion must be one the call's own
-- scorecard has, so an example is always of something the product scores.
--
-- Any member of the company may save one — the call is theirs to read. The
-- one who saved it, or an owner, takes it out again.

create table public.moments (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references public.companies (id) on delete cascade,
  conversation_id  uuid not null,
  segment_id       uuid not null,
  engagement_type  text not null,
  criterion_key    text not null,
  note             text check (note is null or length(note) between 1 and 500),
  saved_by         uuid references auth.users (id) on delete set null,
  created_at       timestamptz not null default now(),
  -- The same line is an example of a criterion once.
  unique (segment_id, criterion_key),
  foreign key (company_id, conversation_id)
    references public.conversations (company_id, id) on delete cascade,
  foreign key (company_id, segment_id)
    references public.segments (company_id, id) on delete cascade
);

create index moments_company_idx on public.moments (company_id, engagement_type, criterion_key, created_at desc);

comment on table public.moments is
  'Transcript lines saved as examples of a criterion being met. Members read and save; the saver or an owner removes.';

alter table public.moments enable row level security;

create policy "members read their company's examples"
  on public.moments for select to authenticated
  using ((select private.is_company_member(company_id)));

create policy "admins read all examples"
  on public.moments for select to authenticated
  using ((select private.is_platform_admin()));


create function public.save_moment(p_segment_id uuid, p_criterion_key text, p_note text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_segment public.segments;
  v_call    public.conversations;
  v_note    text := nullif(trim(coalesce(p_note, '')), '');
  v_id      uuid;
begin
  select * into v_segment from public.segments s where s.id = p_segment_id;
  if v_segment.id is null or not (select private.is_company_member(v_segment.company_id)) then
    raise exception 'save_moment: that line of the transcript was not found' using errcode = 'P0002';
  end if;
  select * into v_call from public.conversations c where c.id = v_segment.conversation_id;
  if not exists (
    select 1 from public.criteria_definitions d
     where d.engagement_type = v_call.engagement_type
       and d.version = v_call.criteria_version
       and d.key = p_criterion_key
       and (d.company_id is null or d.company_id = v_call.company_id)
  ) then
    raise exception 'save_moment: that criterion is not on this call''s scorecard' using errcode = '22023';
  end if;
  if v_note is not null and length(v_note) > 500 then
    raise exception 'save_moment: a note is at most 500 characters' using errcode = '22023';
  end if;

  insert into public.moments (company_id, conversation_id, segment_id, engagement_type, criterion_key, note, saved_by)
  values (v_call.company_id, v_call.id, v_segment.id, v_call.engagement_type, p_criterion_key, v_note, (select auth.uid()))
  on conflict (segment_id, criterion_key) do update set note = coalesce(excluded.note, public.moments.note)
  returning id into v_id;
  return v_id;
end;
$$;

create function public.remove_moment(p_moment_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.moments;
begin
  select * into v_row from public.moments m where m.id = p_moment_id;
  if v_row.id is null or not (select private.is_company_member(v_row.company_id)) then
    raise exception 'remove_moment: example not found' using errcode = 'P0002';
  end if;
  if not exists (
    select 1 from public.company_members m
     where m.company_id = v_row.company_id and m.user_id = (select auth.uid())
       and (m.role = 'owner' or v_row.saved_by = (select auth.uid()))
  ) then
    raise exception 'remove_moment: only whoever saved it, or an owner, can take it out' using errcode = '42501';
  end if;
  delete from public.moments where id = p_moment_id;
end;
$$;

revoke all on function public.save_moment(uuid, text, text) from public, anon;
revoke all on function public.remove_moment(uuid) from public, anon;
grant execute on function public.save_moment(uuid, text, text) to authenticated;
grant execute on function public.remove_moment(uuid) to authenticated;
