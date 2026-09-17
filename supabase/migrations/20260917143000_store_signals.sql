-- Writing extracted signals and their evidence. ADR 0007, ADR 0008.
--
-- One function, one transaction, for the same reason ingest_transcript() is
-- one: signals_require_evidence is deferred to commit, so a signal written in
-- one round trip and its evidence in the next is an unbacked signal at commit
-- time and is rejected. Keeping both in a single function body also means a
-- failure half way through a conversation's signals leaves none of them,
-- rather than a conversation that looks analysed but is missing half its
-- findings — which nobody would ever notice.
--
-- Signal ids are returned so the caller can link back to what it wrote.

create function public.store_signals(
  p_company_id      uuid,
  p_conversation_id uuid,
  p_detector        text,
  p_model           text,
  -- [{ kind, summary, confidence,
  --    evidence: [{ segment_id, quote, quote_start, quote_end }] }]
  p_signals         jsonb
)
returns setof uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_signal    jsonb;
  v_signal_id uuid;
begin
  if p_company_id is null or p_conversation_id is null then
    raise exception 'store_signals: p_company_id and p_conversation_id are required';
  end if;
  if p_detector is null or length(trim(p_detector)) = 0
     or p_model is null or length(trim(p_model)) = 0 then
    raise exception 'store_signals: p_detector and p_model are required';
  end if;
  if p_signals is null or jsonb_typeof(p_signals) <> 'array' then
    raise exception 'store_signals: p_signals must be an array';
  end if;

  -- An extraction that found nothing is a valid outcome, not an error.
  for v_signal in select * from jsonb_array_elements(p_signals)
  loop
    if jsonb_typeof(v_signal->'evidence') <> 'array'
       or jsonb_array_length(v_signal->'evidence') = 0 then
      raise exception 'store_signals: every signal needs at least one evidence span'
        using errcode = '23514';
    end if;

    insert into public.signals
      (company_id, conversation_id, kind, summary, confidence, detector, model)
    values (
      p_company_id,
      p_conversation_id,
      v_signal->>'kind',
      v_signal->>'summary',
      (v_signal->>'confidence')::double precision,
      p_detector,
      p_model
    )
    returning id into v_signal_id;

    -- The quote-fidelity trigger checks each of these against the segment it
    -- names, so a span that does not match aborts the whole call.
    insert into public.signal_evidence
      (company_id, signal_id, segment_id, quote, quote_start, quote_end)
    select
      p_company_id,
      v_signal_id,
      (e->>'segment_id')::uuid,
      e->>'quote',
      (e->>'quote_start')::integer,
      (e->>'quote_end')::integer
    from jsonb_array_elements(v_signal->'evidence') as e;

    return next v_signal_id;
  end loop;
end;
$$;

-- Extraction is service-role work, like ingest and match_segments.
revoke all on function public.store_signals(uuid, uuid, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.store_signals(uuid, uuid, text, text, jsonb)
  to service_role;
