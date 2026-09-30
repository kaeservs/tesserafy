-- "Not right": feedback on what the AI wrote, beyond scores.
--
-- Until now only a score could teach: "This score is wrong" with a reason
-- becomes an example (20261003100000_ai_guidance). An action item, a signal
-- found in a call, or a point in a call prep could only be lived with, or
-- overruled by an owner's standing instruction. Here each can be marked not
-- right, with why: the result is removed, and what was wrong about it becomes
-- an example the same feature is shown from then on — "not an action item:
-- a pleasantry, nobody committed to anything".
--
-- An example keeps the words it came from, so it lives exactly as long as
-- they do. One from a call is tied to that call (erasing the call, or its
-- retention running out, erases the example); one from a prep is tied to the
-- prep (deleting it, or closing the company, erases the example). The lesson
-- goes with its source; that is the price of never keeping a copy of words
-- someone asked to have erased.
--
-- Anyone in the company may say a call's result is not right, as anyone may
-- correct a score. A prep's brief is changed only by whoever wrote it or an
-- owner, as before. Owners see every example on the AI guidance page and can
-- switch it off or delete it.

alter table public.ai_guidance
  -- What the AI had written: the action, the signal's summary, the point or question.
  add column result          text check (result is null or length(trim(result)) between 1 and 500),
  add column conversation_id uuid,
  add column prep_id         uuid,
  add foreign key (company_id, conversation_id) references public.conversations (company_id, id) on delete cascade,
  add foreign key (company_id, prep_id) references public.call_preps (company_id, id) on delete cascade;

create index ai_guidance_conversation_idx on public.ai_guidance (conversation_id) where conversation_id is not null;
create index ai_guidance_prep_idx on public.ai_guidance (prep_id) where prep_id is not null;

-- A scoring example is a quote and whether it counts; any other is a result
-- that was wrong, from a call (action items, insights) or a prep.
alter table public.ai_guidance drop constraint ai_guidance_check;
alter table public.ai_guidance add constraint ai_guidance_example_shape check (
  kind = 'instruction'
  or (feature = 'scoring' and quote is not null and counts is not null and criterion_key is not null)
  or (feature in ('insights', 'action_items') and result is not null and counts is null and criterion_key is null
      and conversation_id is not null and prep_id is null)
  or (feature = 'prep' and result is not null and counts is null and criterion_key is null
      and prep_id is not null and conversation_id is null)
);

comment on column public.ai_guidance.result is
  'For a "Not right" example: what the AI had written. The reason (body) is the rule; this illustrates it.';


create function private.check_feedback_reason(p_reason text, p_where text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_reason text := trim(coalesce(p_reason, ''));
begin
  if length(v_reason) < 3 or length(v_reason) > 500 then
    raise exception '%: say why in 3 to 500 characters', p_where using errcode = '22023';
  end if;
  return v_reason;
end;
$$;


-- An action item that is not one. It is removed, and the reason teaches.
create function public.reject_action_item(p_item_id uuid, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row    public.action_items;
  v_reason text := private.check_feedback_reason(p_reason, 'reject_action_item');
  v_id     uuid;
begin
  select * into v_row from public.action_items a where a.id = p_item_id;
  if v_row.id is null or not (select private.is_company_member(v_row.company_id)) then
    raise exception 'reject_action_item: not found' using errcode = 'P0002';
  end if;

  insert into public.ai_guidance
    (company_id, feature, engagement_type, kind, body, quote, result, conversation_id, created_by)
  select v_row.company_id, 'action_items', c.engagement_type, 'example', v_reason, left(v_row.quote, 500),
         left(v_row.action, 500), v_row.conversation_id, (select auth.uid())
    from public.conversations c where c.id = v_row.conversation_id
  returning id into v_id;

  delete from public.action_items where id = p_item_id;
  return v_id;
end;
$$;


-- A signal that was misread. It is removed, and the reason teaches "Find
-- insights" what this company does not count. An insight resting on this
-- signal alone would be left with no evidence (invariant 5), so that is
-- refused: decline the insight instead.
create function public.reject_signal(p_signal_id uuid, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row    public.signals;
  v_reason text := private.check_feedback_reason(p_reason, 'reject_signal');
  v_quote  text;
  v_id     uuid;
begin
  select * into v_row from public.signals s where s.id = p_signal_id;
  if v_row.id is null or not (select private.is_company_member(v_row.company_id)) then
    raise exception 'reject_signal: not found' using errcode = 'P0002';
  end if;
  if exists (
    select 1 from public.insight_evidence e
     where e.signal_id = p_signal_id
       and not exists (select 1 from public.insight_evidence o where o.insight_id = e.insight_id and o.signal_id <> p_signal_id)
  ) then
    raise exception 'reject_signal: an insight rests on this alone; decline the insight on Insights instead' using errcode = '23514';
  end if;

  select e.quote into v_quote from public.signal_evidence e where e.signal_id = p_signal_id order by e.created_at limit 1;

  insert into public.ai_guidance
    (company_id, feature, engagement_type, kind, body, quote, result, conversation_id, created_by)
  select v_row.company_id, 'insights', c.engagement_type, 'example', v_reason, left(v_quote, 500),
         left(case v_row.kind when 'problem' then 'Problem: ' else 'Request: ' end || v_row.summary, 500),
         v_row.conversation_id, (select auth.uid())
    from public.conversations c where c.id = v_row.conversation_id
  returning id into v_id;

  delete from public.signals where id = p_signal_id;
  return v_id;
end;
$$;


-- A point or question in a prep's brief that is wrong. The caller names it by
-- section and position, and by its words, so a brief rewritten in between
-- cannot have the wrong one removed.
create function public.reject_prep_item(p_prep_id uuid, p_section text, p_index integer, p_text text, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row    public.call_preps;
  v_reason text := private.check_feedback_reason(p_reason, 'reject_prep_item');
  v_item   jsonb;
  v_text   text;
  v_id     uuid;
begin
  select * into v_row from public.call_preps p where p.id = p_prep_id;
  if v_row.id is null or not (select private.is_company_member(v_row.company_id)) then
    raise exception 'reject_prep_item: prep not found' using errcode = 'P0002';
  end if;
  if not private.may_change_prep(v_row) then
    raise exception 'reject_prep_item: only whoever wrote it, or an owner, can change it' using errcode = '42501';
  end if;
  if p_section is null or p_section not in ('about', 'company', 'questions') then
    raise exception 'reject_prep_item: no such part of the brief' using errcode = '22023';
  end if;

  v_item := v_row.brief -> p_section -> p_index;
  v_text := case p_section when 'questions' then v_item ->> 'question' else v_item ->> 'point' end;
  if v_item is null or p_index < 0 or v_text is null or v_text is distinct from p_text then
    raise exception 'reject_prep_item: that is no longer in the brief' using errcode = 'P0002';
  end if;

  insert into public.ai_guidance
    (company_id, feature, engagement_type, kind, body, quote, result, prep_id, created_by)
  values
    (v_row.company_id, 'prep', v_row.engagement_type, 'example', v_reason,
     nullif(left(coalesce(v_item ->> 'quote', ''), 500), ''), left(v_text, 500), v_row.id, (select auth.uid()))
  returning id into v_id;

  update public.call_preps
     set brief = jsonb_set(brief, array[p_section], (brief -> p_section) - p_index)
   where id = p_prep_id;
  return v_id;
end;
$$;

revoke all on function private.check_feedback_reason(text, text) from public, anon;
revoke all on function public.reject_action_item(uuid, text) from public, anon;
revoke all on function public.reject_signal(uuid, text) from public, anon;
revoke all on function public.reject_prep_item(uuid, text, integer, text, text) from public, anon;
grant execute on function public.reject_action_item(uuid, text) to authenticated;
grant execute on function public.reject_signal(uuid, text) to authenticated;
grant execute on function public.reject_prep_item(uuid, text, integer, text, text) to authenticated;
