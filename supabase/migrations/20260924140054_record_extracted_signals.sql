-- A customer can store what extraction found in their own call.
--
-- Signals were service-role work: store_signals is granted to nobody else and
-- `signals` has no insert policy, because until now only an operator ran
-- extraction. The owner decided extraction becomes a button a customer
-- presses, so the customer's session needs a way to write the result — and
-- the existing pattern for exactly that is record_criterion_events, which this
-- mirrors deliberately.
--
-- What it trusts and what it does not:
--
--   - The company comes from the conversation, never from the caller.
--   - The caller must be a member of that company.
--   - Every quote must be found, verbatim, in the segment it cites, and that
--     segment must belong to this conversation. Offsets are derived here, and
--     the existing evidence trigger checks them again on insert. A paraphrase
--     cannot be stored; neither can a quote from someone else's call.
--   - The claim text and confidence are the caller's. A member could call this
--     directly and write an invented claim into their own company's data,
--     backed by a real quote from their own transcript. That is the same trust
--     criterion events already have, it cannot cross tenants, and invariant 5
--     — no insight without evidence — still holds.
--
-- It refuses a second extraction of the same conversation by the same
-- detector. The button is disabled after one run and the route checks too,
-- but a double click that raced both would otherwise store every signal twice.

create function public.record_extracted_signals(
  p_conversation_id uuid,
  p_detector        text,
  p_model           text,
  p_signals         jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company_id   uuid;
  v_signal       jsonb;
  v_item         jsonb;
  v_signal_id    uuid;
  v_segment_text text;
  v_quote        text;
  v_offset       integer;
  v_recorded     integer := 0;
  v_rejected     integer := 0;
  v_spans        jsonb;
begin
  select c.company_id into v_company_id
  from public.conversations c
  where c.id = p_conversation_id;

  if v_company_id is null then
    raise exception 'record_extracted_signals: conversation % not found', p_conversation_id
      using errcode = 'P0002';
  end if;

  if not (select private.is_company_member(v_company_id)) then
    raise exception 'record_extracted_signals: not a member of that company'
      using errcode = '42501';
  end if;

  if coalesce(trim(p_detector), '') = '' or coalesce(trim(p_model), '') = '' then
    raise exception 'record_extracted_signals: detector and model are required'
      using errcode = '22023';
  end if;

  if jsonb_typeof(p_signals) is distinct from 'array' then
    raise exception 'record_extracted_signals: p_signals must be an array'
      using errcode = '22023';
  end if;

  if exists (
    select 1 from public.signals s
    where s.conversation_id = p_conversation_id and s.detector = p_detector
  ) then
    raise exception 'record_extracted_signals: this call has already been extracted by %', p_detector
      using errcode = '23505';
  end if;

  for v_signal in select * from jsonb_array_elements(p_signals) loop
    -- Resolve every span first. A signal whose evidence cannot all be found is
    -- dropped whole rather than stored with the quotes that happened to match:
    -- a claim backed by half its evidence is a different, weaker claim.
    v_spans := '[]'::jsonb;
    for v_item in select * from jsonb_array_elements(coalesce(v_signal->'evidence', '[]'::jsonb)) loop
      select s.text into v_segment_text
      from public.segments s
      where s.id = (v_item->>'segment_id')::uuid
        and s.conversation_id = p_conversation_id;

      v_quote := v_item->>'quote';
      v_offset := case
        when v_segment_text is null or coalesce(v_quote, '') = '' then 0
        else position(v_quote in v_segment_text)
      end;

      if v_offset = 0 then
        v_spans := null;
        exit;
      end if;

      v_spans := v_spans || jsonb_build_object(
        'segment_id', v_item->>'segment_id',
        'quote', v_quote,
        'quote_start', v_offset - 1,
        'quote_end', v_offset - 1 + length(v_quote)
      );
    end loop;

    if v_spans is null or jsonb_array_length(v_spans) = 0 then
      v_rejected := v_rejected + 1;
      continue;
    end if;

    insert into public.signals
      (company_id, conversation_id, kind, summary, confidence, detector, model)
    values
      (v_company_id, p_conversation_id, v_signal->>'kind', v_signal->>'summary',
       (v_signal->>'confidence')::double precision, p_detector, p_model)
    returning id into v_signal_id;

    insert into public.signal_evidence
      (company_id, signal_id, segment_id, quote, quote_start, quote_end)
    select
      v_company_id,
      v_signal_id,
      (e->>'segment_id')::uuid,
      e->>'quote',
      (e->>'quote_start')::integer,
      (e->>'quote_end')::integer
    from jsonb_array_elements(v_spans) as e
    on conflict do nothing;

    v_recorded := v_recorded + 1;
  end loop;

  return jsonb_build_object('recorded', v_recorded, 'rejected', v_rejected);
end;
$$;

revoke all on function public.record_extracted_signals(uuid, text, text, jsonb) from public, anon;
grant execute on function public.record_extracted_signals(uuid, text, text, jsonb)
  to authenticated, service_role;
