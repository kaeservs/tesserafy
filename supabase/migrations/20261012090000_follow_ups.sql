-- The follow-up email a call deserves, drafted from it (T3, t3-follow-up).
--
-- What a Cluely-style assistant hands the seller when the meeting ends, kept
-- to the product's rule: every line about the call rests on words someone
-- said. The draft is a subject, a greeting, an opening and a closing in the
-- seller's voice, and lines — a recap of what the customer said, and the next
-- steps agreed — each quoting the segment it rests on. Quotes are checked here
-- as for action items: a line whose quote is not in its segment is not stored.
--
-- One draft a call; drafting again replaces it. It goes with the call
-- (erasure), and with nothing else: the person who drafted it is a plain
-- reference that goes null when their account does (ADR 0013).

create table public.follow_ups (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references public.companies (id) on delete cascade,
  conversation_id  uuid not null,
  subject          text not null check (length(trim(subject)) between 1 and 200),
  greeting         text not null check (length(greeting) <= 200),
  opening          text not null check (length(opening) <= 1000),
  closing          text not null check (length(closing) <= 1000),
  drafted_by       uuid references auth.users (id) on delete set null,
  detector         text not null,
  model            text not null,
  created_at       timestamptz not null default now(),
  unique (company_id, id),
  unique (conversation_id),
  foreign key (company_id, conversation_id)
    references public.conversations (company_id, id) on delete cascade
);

create table public.follow_up_lines (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null,
  follow_up_id  uuid not null,
  position      integer not null check (position between 1 and 20),
  -- recap: what the customer said, back to them. next_step: what was agreed.
  kind          text not null check (kind in ('recap', 'next_step')),
  text          text not null check (length(trim(text)) between 1 and 500),
  segment_id    uuid not null,
  quote         text not null check (length(quote) > 0),
  unique (follow_up_id, position),
  foreign key (company_id, follow_up_id)
    references public.follow_ups (company_id, id) on delete cascade,
  foreign key (company_id, segment_id)
    references public.segments (company_id, id) on delete cascade
);

create index follow_up_lines_segment_idx on public.follow_up_lines (company_id, segment_id);

comment on table public.follow_ups is
  'The follow-up email drafted from a call: one a call, replaced when drafted again.';
comment on table public.follow_up_lines is
  'A follow-up''s recap lines and next steps, each quoting the segment it rests on.';

alter table public.follow_ups enable row level security;
alter table public.follow_up_lines enable row level security;

create policy "members read their company's follow-ups"
  on public.follow_ups for select to authenticated
  using ((select private.is_company_member(company_id)));
create policy "members read their company's follow-up lines"
  on public.follow_up_lines for select to authenticated
  using ((select private.is_company_member(company_id)));


-- Stores a draft as the person who asked for it, replacing the call's last.
create function public.record_follow_up(
  p_conversation_id uuid,
  p_detector        text,
  p_model           text,
  p_draft           jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company_id uuid;
  v_id         uuid;
  v_line       jsonb;
  v_text       text;
  v_quote      text;
  v_kind       text;
  v_position   integer := 0;
  v_rejected   integer := 0;
begin
  select c.company_id into v_company_id from public.conversations c where c.id = p_conversation_id;
  if v_company_id is null or not (select private.is_company_member(v_company_id)) then
    raise exception 'record_follow_up: call not found' using errcode = 'P0002';
  end if;
  if coalesce(trim(p_detector), '') = '' or coalesce(trim(p_model), '') = '' then
    raise exception 'record_follow_up: detector and model are required' using errcode = '22023';
  end if;
  if jsonb_typeof(p_draft) is distinct from 'object' or jsonb_typeof(p_draft -> 'lines') is distinct from 'array'
     or coalesce(trim(p_draft ->> 'subject'), '') = '' then
    raise exception 'record_follow_up: a draft is a subject and its lines' using errcode = '22023';
  end if;

  delete from public.follow_ups f where f.conversation_id = p_conversation_id;

  insert into public.follow_ups
    (company_id, conversation_id, subject, greeting, opening, closing, drafted_by, detector, model)
  values
    (v_company_id, p_conversation_id, left(trim(p_draft ->> 'subject'), 200),
     left(coalesce(p_draft ->> 'greeting', ''), 200), left(coalesce(p_draft ->> 'opening', ''), 1000),
     left(coalesce(p_draft ->> 'closing', ''), 1000), (select auth.uid()), p_detector, p_model)
  returning id into v_id;

  for v_line in select * from jsonb_array_elements(p_draft -> 'lines') loop
    v_text := null;
    if coalesce(v_line ->> 'segment_id', '') ~ '^[0-9a-fA-F-]{36}$' then
      select s.text into v_text from public.segments s
       where s.id = (v_line ->> 'segment_id')::uuid and s.conversation_id = p_conversation_id;
    end if;
    v_quote := v_line ->> 'quote';
    v_kind := v_line ->> 'kind';
    if v_text is null or coalesce(v_quote, '') = '' or position(v_quote in v_text) = 0
       or coalesce(trim(v_line ->> 'text'), '') = '' or v_kind is null or v_kind not in ('recap', 'next_step')
       or v_position >= 20 then
      v_rejected := v_rejected + 1;
      continue;
    end if;
    v_position := v_position + 1;
    insert into public.follow_up_lines (company_id, follow_up_id, position, kind, text, segment_id, quote)
    values (v_company_id, v_id, v_position, v_kind, left(trim(v_line ->> 'text'), 500),
            (v_line ->> 'segment_id')::uuid, v_quote);
  end loop;

  return jsonb_build_object('id', v_id, 'recorded', v_position, 'rejected', v_rejected);
end;
$$;

revoke all on function public.record_follow_up(uuid, text, text, jsonb) from public, anon;
grant execute on function public.record_follow_up(uuid, text, text, jsonb) to authenticated;
