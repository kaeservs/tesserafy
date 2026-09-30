-- Action items: the commitments and next steps a call produced — "I'll send
-- the security documents today", "finance will confirm by Friday" — each
-- quoting the words it came from (invariant 5), with whose it is and when it
-- is due as it was said.
--
-- Found when someone asks ("Find action items", T3, charged like "Find
-- insights"), shaped by the call type and the owners' instructions for action
-- items (ai_guidance). Anyone in the company ticks one done. Finding them
-- again replaces the open ones and keeps the done ones: what was done stays
-- done, and a better reading of the call replaces a worse one.
--
-- Each quote is found in its segment here, not trusted from the caller, as
-- record_extracted_signals does; an item whose quote is not in the segment is
-- dropped, not stored.

create table public.action_items (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references public.companies (id) on delete cascade,
  conversation_id  uuid not null,
  segment_id       uuid not null,
  quote            text not null check (length(quote) > 0),
  action           text not null check (length(trim(action)) between 1 and 300),
  -- Whose it is: this company's side, the customer's, both, or not said.
  owner_side       text not null check (owner_side in ('ours', 'theirs', 'both', 'unclear')),
  owner_name       text check (owner_name is null or length(owner_name) between 1 and 120),
  -- As it was said ("by Friday", "end of the quarter"): a date the call did not name is not invented.
  due              text check (due is null or length(due) between 1 and 120),
  done             boolean not null default false,
  done_by          uuid references auth.users (id) on delete set null,
  done_at          timestamptz,
  detector         text not null,
  model            text not null,
  created_at       timestamptz not null default now(),
  check (done = (done_at is not null)),
  foreign key (company_id, conversation_id)
    references public.conversations (company_id, id) on delete cascade,
  foreign key (company_id, segment_id)
    references public.segments (company_id, id) on delete cascade
);

create index action_items_conversation_idx on public.action_items (conversation_id, created_at);
create index action_items_open_idx on public.action_items (company_id, done, created_at desc);

comment on table public.action_items is
  'Commitments and next steps a call produced, each quoting its words. Members read and tick them done.';

alter table public.action_items enable row level security;

create policy "members read their company's action items"
  on public.action_items for select to authenticated
  using ((select private.is_company_member(company_id)));


create function public.record_action_items(
  p_conversation_id uuid,
  p_detector        text,
  p_model           text,
  p_items           jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company_id uuid;
  v_item       jsonb;
  v_text       text;
  v_quote      text;
  v_recorded   integer := 0;
  v_rejected   integer := 0;
  v_side       text;
begin
  select c.company_id into v_company_id from public.conversations c where c.id = p_conversation_id;
  if v_company_id is null or not (select private.is_company_member(v_company_id)) then
    raise exception 'record_action_items: call not found' using errcode = 'P0002';
  end if;
  if coalesce(trim(p_detector), '') = '' or coalesce(trim(p_model), '') = '' then
    raise exception 'record_action_items: detector and model are required' using errcode = '22023';
  end if;
  if jsonb_typeof(p_items) is distinct from 'array' then
    raise exception 'record_action_items: p_items must be an array' using errcode = '22023';
  end if;

  -- A new reading replaces the open items; done ones stay done.
  delete from public.action_items a where a.conversation_id = p_conversation_id and not a.done;

  for v_item in select * from jsonb_array_elements(p_items) loop
    select s.text into v_text from public.segments s
     where s.id = (v_item->>'segment_id')::uuid and s.conversation_id = p_conversation_id;
    v_quote := v_item->>'quote';
    v_side := coalesce(v_item->>'owner_side', 'unclear');
    if v_text is null or coalesce(v_quote, '') = '' or position(v_quote in v_text) = 0
       or coalesce(trim(v_item->>'action'), '') = '' or v_side not in ('ours', 'theirs', 'both', 'unclear') then
      v_rejected := v_rejected + 1;
      continue;
    end if;
    insert into public.action_items
      (company_id, conversation_id, segment_id, quote, action, owner_side, owner_name, due, detector, model)
    values
      (v_company_id, p_conversation_id, (v_item->>'segment_id')::uuid, v_quote, left(trim(v_item->>'action'), 300), v_side,
       nullif(left(trim(coalesce(v_item->>'owner_name', '')), 120), ''), nullif(left(trim(coalesce(v_item->>'due', '')), 120), ''),
       p_detector, p_model);
    v_recorded := v_recorded + 1;
  end loop;

  return jsonb_build_object('recorded', v_recorded, 'rejected', v_rejected);
end;
$$;

-- Tick one done, or not. Anyone in the company.
create function public.set_action_item_done(p_item_id uuid, p_done boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.action_items;
begin
  select * into v_row from public.action_items a where a.id = p_item_id;
  if v_row.id is null or not (select private.is_company_member(v_row.company_id)) then
    raise exception 'set_action_item_done: not found' using errcode = 'P0002';
  end if;
  update public.action_items
     set done = coalesce(p_done, false),
         done_by = case when coalesce(p_done, false) then (select auth.uid()) end,
         done_at = case when coalesce(p_done, false) then now() end
   where id = p_item_id;
end;
$$;

revoke all on function public.record_action_items(uuid, text, text, jsonb) from public, anon;
revoke all on function public.set_action_item_done(uuid, boolean) from public, anon;
grant execute on function public.record_action_items(uuid, text, text, jsonb) to authenticated;
grant execute on function public.set_action_item_done(uuid, boolean) to authenticated;
