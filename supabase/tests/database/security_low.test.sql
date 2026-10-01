-- The low-severity findings of the security review of 2026-10-04: a ticket
-- link is an issue on the company's own tracker, two presses raise one
-- ticket, an owner's erasure is logged as their request, and the sample call
-- is only Tesserafy's sample. Runs with `supabase test db` (pgTAP).
-- Everything rolls back.

begin;
create extension if not exists pgtap with schema extensions;

select plan(12);

insert into auth.users (id, email, aud, role) values
  ('5ec10000-0000-4000-8000-000000000001', 'owner-a@test.tesserafy.local', 'authenticated', 'authenticated'),
  ('5ec10000-0000-4000-8000-000000000002', 'owner-b@test.tesserafy.local', 'authenticated', 'authenticated');
insert into public.company_members (company_id, user_id, role) values
  ('00000000-0000-4000-8000-00000000000a', '5ec10000-0000-4000-8000-000000000001', 'owner'),
  ('00000000-0000-4000-8000-00000000000b', '5ec10000-0000-4000-8000-000000000002', 'owner');

insert into public.company_trackers (company_id, provider, target, token_ciphertext, token_hint)
values ('00000000-0000-4000-8000-00000000000a', 'github', 'acme/product', 'v1:x:y:z', 'abcd');

insert into public.insights (id, company_id, title, summary, synthesiser, model)
values ('5ec10000-0000-4000-8000-0000000000f1', '00000000-0000-4000-8000-00000000000a',
        'Manual re-keying costs hours', 'Several customers describe the same routine.',
        't3-synthesise@test', 'claude-opus-5');
insert into public.insight_evidence (company_id, insight_id, signal_id)
values ('00000000-0000-4000-8000-00000000000a', '5ec10000-0000-4000-8000-0000000000f1',
        '00000000-0000-4000-8000-000000000a21');

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"5ec10000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select public.decide_insight('5ec10000-0000-4000-8000-0000000000f1', 'approved');

-- ---------------------------------------------------------------------------
-- Two presses, one ticket
-- ---------------------------------------------------------------------------

select is(public.claim_insight_ticket('5ec10000-0000-4000-8000-0000000000f1'), true,
  'the first press claims the insight');
select is(public.claim_insight_ticket('5ec10000-0000-4000-8000-0000000000f1'), false,
  'a second press while the first is raising it does not');

select public.release_insight_ticket('5ec10000-0000-4000-8000-0000000000f1');
select is(public.claim_insight_ticket('5ec10000-0000-4000-8000-0000000000f1'), true,
  'once the tracker refused and the claim was released, the next press may try');

reset role;
update private.ticket_claims set claimed_at = now() - interval '3 minutes'
 where insight_id = '5ec10000-0000-4000-8000-0000000000f1';
set local role authenticated;
select is(public.claim_insight_ticket('5ec10000-0000-4000-8000-0000000000f1'), true,
  'a claim abandoned for over two minutes does not block the insight for ever');

select set_config('request.jwt.claims',
  '{"sub":"5ec10000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select throws_ok(
  $$ select public.claim_insight_ticket('5ec10000-0000-4000-8000-0000000000f1') $$,
  'P0002', null, 'another company cannot claim, or learn of, the insight'
);

-- ---------------------------------------------------------------------------
-- A ticket is an issue on the company's own tracker
-- ---------------------------------------------------------------------------

select set_config('request.jwt.claims',
  '{"sub":"5ec10000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select throws_ok(
  $$ select public.record_insight_ticket('5ec10000-0000-4000-8000-0000000000f1', 'github', '3',
       'https://github.com/someone-else/product/issues/3') $$,
  '22023', null, 'a link to another repository is not this company''s ticket'
);
select throws_ok(
  $$ select public.record_insight_ticket('5ec10000-0000-4000-8000-0000000000f1', 'github', '3',
       'https://github.com/acme/product/issues/3/../../pulls') $$,
  '22023', null, 'nor is anything on its repository that is not an issue'
);
select lives_ok(
  $$ select public.record_insight_ticket('5ec10000-0000-4000-8000-0000000000f1', 'github', '3',
       'https://github.com/Acme/Product/issues/3') $$,
  'an issue on it is, in whatever capitalisation GitHub gives the repository'
);

reset role;
select is((select count(*)::int from private.ticket_claims), 0,
  'recording the ticket ends the claim');
set local role authenticated;

-- ---------------------------------------------------------------------------
-- An owner's erasure is their request
-- ---------------------------------------------------------------------------

select public.erase_conversation('00000000-0000-4000-8000-0000000000a1', 'retention');
select is(
  (select reason from public.erasure_events where conversation_id = '00000000-0000-4000-8000-0000000000a1'),
  'request',
  'an owner cannot log their erasure as retention or an operator''s'
);

-- ---------------------------------------------------------------------------
-- The sample call is Tesserafy's sample
-- ---------------------------------------------------------------------------

select set_config('request.jwt.claims',
  '{"sub":"5ec10000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select throws_ok(
  $$ select public.import_sample_call('Sample call', '{"text":"anything"}'::jsonb) $$,
  '22023', null, 'the sample is a list of segments'
);
select throws_ok(
  $$ select public.import_sample_call('Board meeting',
       '[{"speaker":"Ana","startMs":0,"endMs":4000,"text":"A real call nobody agreed to record."}]'::jsonb) $$,
  '22023', null, 'and a real transcript cannot pass for it, skipping its consent'
);

select * from finish();
rollback;
