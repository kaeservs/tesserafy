-- A call's outcome, corrections to a call, and notes on its moments.
--
-- Three things a sales team does with a call after it happens, none of which
-- the product let them do:
--
--   * say how it ended — won, lost, still open — so coaching can ask which
--     criteria go with wins rather than only which were met;
--   * fix what an import guessed — a title from a filename, a missing date,
--     the wrong scorecard;
--   * point at a moment and say something about it, which is what coaching
--     is.
--
-- Who may change a call: its company's owner, or the person who added it.
-- The same people who could have entered it right in the first place. Every
-- change is logged in conversation_edits, readable by the company.
--
-- Changing a call's scorecard is the one edit with a consequence. Evidence was
-- recorded against the old set's criteria, and replaying it against another
-- set is meaningless (and refused by the engine: an unknown criterion throws).
-- So the old evidence is removed, the count is logged, and the web app
-- re-scores the call against the new set — as the deliberate act ADR 0016
-- says re-scoring must be, never a side effect of publishing a version.
--
-- Notes belong to the company: every member reads them, their author edits
-- or deletes them, and an owner may delete any. They go with the call when it
-- is erased, and with the company when it is closed.

alter table public.conversations
  add column outcome        text check (outcome in ('open', 'won', 'lost')),
  add column outcome_set_by uuid references auth.users (id) on delete set null,
  add column outcome_set_at timestamptz;

comment on column public.conversations.outcome is
  'How the deal stood after this call: open, won or lost. Null when nobody has said.';


create table public.conversation_edits (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null,
  conversation_id  uuid not null,
  field            text not null check (field in ('title', 'occurred_at', 'scorecard', 'outcome')),
  old_value        text,
  new_value        text,
  -- For a scorecard change: the evidence removed with the old set.
  evidence_removed integer not null default 0 check (evidence_removed >= 0),
  actor            uuid references auth.users (id) on delete set null,
  at               timestamptz not null default now(),
  foreign key (company_id, conversation_id)
    references public.conversations (company_id, id) on delete cascade
);

create index conversation_edits_conversation_idx on public.conversation_edits (conversation_id, at desc);

alter table public.conversation_edits enable row level security;

create policy "members read their company's call edits"
  on public.conversation_edits for select to authenticated
  using ((select private.is_company_member(company_id)));


create table public.segment_notes (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null,
  conversation_id  uuid not null,
  segment_id       uuid not null,
  author           uuid references auth.users (id) on delete set null,
  body             text not null check (length(trim(body)) between 1 and 2000),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  foreign key (company_id, conversation_id)
    references public.conversations (company_id, id) on delete cascade,
  foreign key (company_id, segment_id)
    references public.segments (company_id, id) on delete cascade
);

create index segment_notes_conversation_idx on public.segment_notes (conversation_id, created_at);
create index segment_notes_author_idx on public.segment_notes (company_id, author);

alter table public.segment_notes enable row level security;

create policy "members read their company's notes"
  on public.segment_notes for select to authenticated
  using ((select private.is_company_member(company_id)));


-- Owner of the call's company, or the person who added the call.
create function private.may_edit_conversation(p_company_id uuid, p_added_by uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.company_members m
     where m.company_id = p_company_id
       and m.user_id = (select auth.uid())
       and (m.role = 'owner' or p_added_by = (select auth.uid()))
  );
$$;


-- Change any of a call's title, date, scorecard and outcome. Arguments left
-- out are left alone; p_clear_date and an outcome of 'unknown' clear. Returns
-- what changed and how much evidence went with an old scorecard, so the
-- caller knows whether to re-score.
create function public.edit_conversation(
  p_conversation_id  uuid,
  p_title            text    default null,
  p_occurred_at      timestamptz default null,
  p_clear_date       boolean default false,
  p_engagement_type  text    default null,
  p_criteria_version integer default null,
  p_outcome          text    default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row      public.conversations;
  v_uid      uuid := (select auth.uid());
  v_changed  text[] := '{}';
  v_removed  integer := 0;
  v_title    text := nullif(trim(p_title), '');
  v_outcome  text;
  v_date     timestamptz;
begin
  select * into v_row from public.conversations c where c.id = p_conversation_id for update;
  if v_row.id is null or not (select private.is_company_member(v_row.company_id)) then
    raise exception 'edit_conversation: call not found' using errcode = 'P0002';
  end if;
  if not private.may_edit_conversation(v_row.company_id, v_row.added_by) then
    raise exception 'edit_conversation: only an owner, or whoever added the call, can change it'
      using errcode = '42501';
  end if;

  if p_title is not null then
    if v_title is null or length(v_title) > 200 then
      raise exception 'edit_conversation: a title is 1 to 200 characters' using errcode = '22023';
    end if;
    if v_title is distinct from v_row.title then
      insert into public.conversation_edits (company_id, conversation_id, field, old_value, new_value, actor)
      values (v_row.company_id, v_row.id, 'title', v_row.title, v_title, v_uid);
      update public.conversations set title = v_title where id = v_row.id;
      v_changed := array_append(v_changed, 'title');
    end if;
  end if;

  if p_clear_date or p_occurred_at is not null then
    v_date := case when p_clear_date then null else p_occurred_at end;
    if v_date > now() + interval '1 day' then
      raise exception 'edit_conversation: a call cannot have happened in the future' using errcode = '22023';
    end if;
    if v_date is distinct from v_row.occurred_at then
      insert into public.conversation_edits (company_id, conversation_id, field, old_value, new_value, actor)
      values (v_row.company_id, v_row.id, 'occurred_at', v_row.occurred_at::text, v_date::text, v_uid);
      update public.conversations set occurred_at = v_date where id = v_row.id;
      v_changed := array_append(v_changed, 'occurred_at');
    end if;
  end if;

  if p_engagement_type is not null or p_criteria_version is not null then
    if p_engagement_type is null or p_criteria_version is null then
      raise exception 'edit_conversation: a scorecard is a name and a version' using errcode = '22023';
    end if;
    if (p_engagement_type, p_criteria_version) is distinct from (v_row.engagement_type, v_row.criteria_version) then
      delete from public.criterion_events e where e.conversation_id = v_row.id;
      get diagnostics v_removed = row_count;
      -- The pinning trigger refuses a set that is neither a template nor this
      -- company's own (23503), and rolls the deletion back with it.
      update public.conversations
         set engagement_type = p_engagement_type, criteria_version = p_criteria_version
       where id = v_row.id;
      insert into public.conversation_edits
        (company_id, conversation_id, field, old_value, new_value, evidence_removed, actor)
      values (v_row.company_id, v_row.id, 'scorecard',
              v_row.engagement_type || ' v' || v_row.criteria_version,
              p_engagement_type || ' v' || p_criteria_version, v_removed, v_uid);
      v_changed := array_append(v_changed, 'scorecard');
    end if;
  end if;

  if p_outcome is not null then
    if p_outcome not in ('open', 'won', 'lost', 'unknown') then
      raise exception 'edit_conversation: an outcome is open, won, lost or unknown' using errcode = '22023';
    end if;
    v_outcome := nullif(p_outcome, 'unknown');
    if v_outcome is distinct from v_row.outcome then
      insert into public.conversation_edits (company_id, conversation_id, field, old_value, new_value, actor)
      values (v_row.company_id, v_row.id, 'outcome', v_row.outcome, v_outcome, v_uid);
      update public.conversations
         set outcome = v_outcome,
             outcome_set_by = case when v_outcome is null then null else v_uid end,
             outcome_set_at = case when v_outcome is null then null else now() end
       where id = v_row.id;
      v_changed := array_append(v_changed, 'outcome');
    end if;
  end if;

  return jsonb_build_object('changed', to_jsonb(v_changed), 'evidence_removed', v_removed);
end;
$$;

revoke all on function public.edit_conversation(uuid, text, timestamptz, boolean, text, integer, text) from public, anon;
grant execute on function public.edit_conversation(uuid, text, timestamptz, boolean, text, integer, text) to authenticated;


-- A note on one moment of a call, by any member of its company.
create function public.add_segment_note(p_segment_id uuid, p_body text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_segment public.segments;
  v_id      uuid;
begin
  select * into v_segment from public.segments s where s.id = p_segment_id;
  if v_segment.id is null or not (select private.is_company_member(v_segment.company_id)) then
    raise exception 'add_segment_note: moment not found' using errcode = 'P0002';
  end if;
  if p_body is null or length(trim(p_body)) not between 1 and 2000 then
    raise exception 'add_segment_note: a note is 1 to 2000 characters' using errcode = '22023';
  end if;

  insert into public.segment_notes (company_id, conversation_id, segment_id, author, body)
  values (v_segment.company_id, v_segment.conversation_id, v_segment.id, (select auth.uid()), trim(p_body))
  returning id into v_id;
  return v_id;
end;
$$;

-- Its author rewrites it.
create function public.edit_segment_note(p_note_id uuid, p_body text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_body is null or length(trim(p_body)) not between 1 and 2000 then
    raise exception 'edit_segment_note: a note is 1 to 2000 characters' using errcode = '22023';
  end if;
  update public.segment_notes n
     set body = trim(p_body), updated_at = now()
   where n.id = p_note_id and n.author = (select auth.uid());
  if not found then
    raise exception 'edit_segment_note: only its author can change a note' using errcode = '42501';
  end if;
end;
$$;

-- Its author, or an owner of the company, removes it.
create function public.delete_segment_note(p_note_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.segment_notes n
   where n.id = p_note_id
     and (n.author = (select auth.uid())
          or exists (select 1 from public.company_members m
                      where m.company_id = n.company_id
                        and m.user_id = (select auth.uid())
                        and m.role = 'owner'));
  if not found then
    raise exception 'delete_segment_note: only its author or an owner can remove a note' using errcode = '42501';
  end if;
end;
$$;

revoke all on function public.add_segment_note(uuid, text) from public, anon;
revoke all on function public.edit_segment_note(uuid, text) from public, anon;
revoke all on function public.delete_segment_note(uuid) from public, anon;
grant execute on function public.add_segment_note(uuid, text) to authenticated;
grant execute on function public.edit_segment_note(uuid, text) to authenticated;
grant execute on function public.delete_segment_note(uuid) to authenticated;
