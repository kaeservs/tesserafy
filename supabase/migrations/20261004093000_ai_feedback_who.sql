-- "Not right" on a call is for whoever added the call, or an owner.
--
-- 20261004090000 let any member of the company mark a call's action item or
-- signal not right, on the reasoning that anyone may correct a score. They
-- may not: dispute_criterion has always asked may_edit_conversation. Since a
-- "Not right" removes a result from someone else's call and teaches the whole
-- company's AI, it asks the same. Prep items already asked may_change_prep.

create or replace function public.reject_action_item(p_item_id uuid, p_reason text)
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
  if not private.may_edit_conversation(v_row.company_id, (select c.added_by from public.conversations c where c.id = v_row.conversation_id)) then
    raise exception 'reject_action_item: only whoever added the call, or an owner, can say this' using errcode = '42501';
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

create or replace function public.reject_signal(p_signal_id uuid, p_reason text)
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
  if not private.may_edit_conversation(v_row.company_id, (select c.added_by from public.conversations c where c.id = v_row.conversation_id)) then
    raise exception 'reject_signal: only whoever added the call, or an owner, can say this' using errcode = '42501';
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
