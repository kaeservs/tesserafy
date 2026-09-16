-- One signal per tenant, citing the quote both tenants share.
--
-- Same shape as 0001: the two companies hold matching content, so a query
-- that forgets its tenant filter returns the other company's signal rather
-- than nothing, and the leak cannot hide behind an empty result.
--
-- Wrapped in a transaction because signals_require_evidence is deferred to
-- commit: a signal inserted in its own transaction, with its evidence in the
-- next, is a signal with no evidence at commit time and is rejected.

begin;

insert into public.signals
  (id, company_id, conversation_id, kind, summary, confidence, detector, model)
values
  ('00000000-0000-4000-8000-000000000a21', '00000000-0000-4000-8000-00000000000a',
   '00000000-0000-4000-8000-0000000000a1', 'problem',
   'The weekly report export costs the team most of a Friday afternoon.',
   0.86, 'fixture', 'fixture'),
  ('00000000-0000-4000-8000-000000000b21', '00000000-0000-4000-8000-00000000000b',
   '00000000-0000-4000-8000-0000000000b1', 'problem',
   'The weekly report export costs the team most of a Friday afternoon.',
   0.86, 'fixture', 'fixture');

-- Offsets are computed rather than written out, so the fixture cannot drift
-- from the segment text it quotes.
insert into public.signal_evidence
  (company_id, signal_id, segment_id, quote, quote_start, quote_end)
select
  s.company_id,
  case s.company_id
    when '00000000-0000-4000-8000-00000000000a' then '00000000-0000-4000-8000-000000000a21'
    else '00000000-0000-4000-8000-000000000b21'
  end::uuid,
  s.id,
  'takes us most of Friday afternoon',
  strpos(s.text, 'takes us most of Friday afternoon') - 1,
  strpos(s.text, 'takes us most of Friday afternoon') - 1 + length('takes us most of Friday afternoon')
from public.segments s
where s.id in (
  '00000000-0000-4000-8000-000000000a11',
  '00000000-0000-4000-8000-000000000b11'
);

commit;
