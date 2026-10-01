-- The sample call: once per company, ever, whoever asks and however; marked
-- as a sample; and honest about consent. Runs with `supabase test db` (pgTAP).
-- Everything rolls back.

begin;
create extension if not exists pgtap with schema extensions;

select plan(10);

insert into auth.users (id, email, aud, role) values
  ('5a3e0001-0000-4000-8000-000000000001', 'owner@acme.test', 'authenticated', 'authenticated'),
  ('5a3e0001-0000-4000-8000-000000000002', 'seller@acme.test', 'authenticated', 'authenticated'),
  ('5a3e0001-0000-4000-8000-000000000003', 'owner@globex.test', 'authenticated', 'authenticated');
insert into public.company_members (company_id, user_id, role) values
  ('00000000-0000-4000-8000-00000000000a', '5a3e0001-0000-4000-8000-000000000001', 'owner'),
  ('00000000-0000-4000-8000-00000000000a', '5a3e0001-0000-4000-8000-000000000002', 'member'),
  ('00000000-0000-4000-8000-00000000000b', '5a3e0001-0000-4000-8000-000000000003', 'owner');

create temporary table made (label text, id uuid);
grant all on made to authenticated;

-- Tesserafy's own sample, as apps/web/lib/sample-call.ts sends it after
-- redaction. Only this may be imported as the sample.
create temporary table sample (segments jsonb);
insert into sample values ('[{"speaker": "Maya Chen", "startMs": 2000, "endMs": 11000, "text": "Thanks for making the time, Tom. Before I show you anything, could you walk me through how weekly reporting works for you today?"}, {"speaker": "Tom Okafor", "startMs": 11000, "endMs": 27000, "text": "Sure. Every Friday two of my analysts pull shipment data out of our warehouse system and the carrier portals, paste it into one big spreadsheet, and build the weekly report for the ops leads."}, {"speaker": "Maya Chen", "startMs": 27000, "endMs": 31000, "text": "How many sources are we talking about?"}, {"speaker": "Tom Okafor", "startMs": 31000, "endMs": 44000, "text": "Five. The warehouse system, three carrier portals, and the returns tracker, which is its own spreadsheet that someone updates by hand."}, {"speaker": "Maya Chen", "startMs": 44000, "endMs": 48000, "text": "And how long does that take them?"}, {"speaker": "Tom Okafor", "startMs": 48000, "endMs": 61000, "text": "Most of Friday. Call it six hours each, so twelve hours a week between them, and more at month end when finance wants the numbers reconciled."}, {"speaker": "Maya Chen", "startMs": 61000, "endMs": 68000, "text": "Twelve hours a week is a lot of senior analyst time. What does it cost you beyond the hours?"}, {"speaker": "Tom Okafor", "startMs": 68000, "endMs": 86000, "text": "Honestly the mistakes hurt more. Last quarter we sent a report with a carrier column shifted by one row, and we held back about forty thousand dollars of invoices that were actually fine. It took two weeks to untangle."}, {"speaker": "Maya Chen", "startMs": 86000, "endMs": 90000, "text": "That would get anyone’s attention. Who noticed?"}, {"speaker": "Tom Okafor", "startMs": 90000, "endMs": 99000, "text": "The carrier did, when they stopped getting paid. Which is not how you want to find out."}, {"speaker": "Maya Chen", "startMs": 99000, "endMs": 104000, "text": "If this worked the way you wanted, what would Friday look like?"}, {"speaker": "Tom Okafor", "startMs": 104000, "endMs": 118000, "text": "The report would just be there on Monday morning, the same numbers finance sees, and my analysts would spend Friday on the questions the report raises instead of building it."}, {"speaker": "Maya Chen", "startMs": 118000, "endMs": 125000, "text": "So the goal is a report that builds itself and that finance trusts, and the analysts’ time goes back to analysis."}, {"speaker": "Tom Okafor", "startMs": 125000, "endMs": 138000, "text": "Exactly. And if it could flag a carrier whose on-time rate drops, even better. Right now we only notice when a customer complains."}, {"speaker": "Maya Chen", "startMs": 138000, "endMs": 142000, "text": "Is there a date this needs to be working by?"}, {"speaker": "Tom Okafor", "startMs": 142000, "endMs": 155000, "text": "We plan next year’s carrier contracts in January. I would like the new reporting running before then, so we are negotiating with numbers we believe."}, {"speaker": "Maya Chen", "startMs": 155000, "endMs": 159000, "text": "So you want it live before the January contract round?"}, {"speaker": "Tom Okafor", "startMs": 159000, "endMs": 168000, "text": "Yes. Ideally by mid-December, so we have a few weeks of clean numbers before we sit down with the carriers."}, {"speaker": "Maya Chen", "startMs": 168000, "endMs": 176000, "text": "Mid-December is realistic if we start the data connections this quarter. Who else would be involved in deciding?"}, {"speaker": "Tom Okafor", "startMs": 176000, "endMs": 189000, "text": "Me, our head of finance, Priya, because she owns the numbers, and IT will want to look at how you connect to the warehouse system."}, {"speaker": "Maya Chen", "startMs": 189000, "endMs": 196000, "text": "That makes sense. Would it help if I sent a short summary of what you have told me, so Priya sees the same picture?"}, {"speaker": "Tom Okafor", "startMs": 196000, "endMs": 203000, "text": "Please. And send over the security documents for IT while you are at it."}, {"speaker": "Maya Chen", "startMs": 203000, "endMs": 210000, "text": "Will do. I will send both today and suggest a time next week with Priya."}, {"speaker": "Tom Okafor", "startMs": 210000, "endMs": 216000, "text": "Sounds good. Thanks, Maya."}]'::jsonb);
grant select on sample to authenticated;

set local role authenticated;

select set_config('request.jwt.claims', '{"sub":"5a3e0001-0000-4000-8000-000000000002","role":"authenticated"}', true);
select throws_ok(
  $$ select public.import_sample_call('Sample call', '[{"speaker":"Maya","startMs":0,"endMs":4000,"text":"How does reporting work today?"}]'::jsonb) $$,
  '22023', null, 'a transcript that is not the sample is not imported as one'
);
insert into made select 'acme', public.import_sample_call('Sample call', (select segments from sample));
select ok((select id from made where label = 'acme') is not null, 'any member can import the sample');
select is(
  (select is_sample from public.conversations where id = (select id from made where label = 'acme')),
  true, 'and it is marked as the sample'
);
select matches(
  (select consent_statement from public.conversations where id = (select id from made where label = 'acme')),
  '^A sample call written by Tesserafy',
  'it says nobody was recorded, rather than that everyone agreed'
);
select is(
  (select added_by from public.conversations where id = (select id from made where label = 'acme')),
  '5a3e0001-0000-4000-8000-000000000002'::uuid,
  'and who added it'
);

select set_config('request.jwt.claims', '{"sub":"5a3e0001-0000-4000-8000-000000000001","role":"authenticated"}', true);
select throws_ok(
  $$ select public.import_sample_call('Sample call', '[{"speaker":"Maya","startMs":0,"endMs":1,"text":"Again"}]'::jsonb) $$,
  '23505', null, 'a second one for the same company is refused, whoever asks'
);

-- Deleting it does not bring the offer back.
reset role;
delete from public.conversations where id = (select id from made where label = 'acme');
set local role authenticated;
select throws_ok(
  $$ select public.import_sample_call('Sample call', '[{"speaker":"Maya","startMs":0,"endMs":1,"text":"Again"}]'::jsonb) $$,
  '23505', null, 'nor after the first is deleted'
);

select set_config('request.jwt.claims', '{"sub":"5a3e0001-0000-4000-8000-000000000003","role":"authenticated"}', true);
insert into made select 'globex', public.import_sample_call('Sample call', (select segments from sample));
select ok((select id from made where label = 'globex') is not null, 'another company has its own');
select is((select count(*)::int from public.conversations where is_sample), 1, 'and sees only its own');

select set_config('request.jwt.claims', '{"sub":"5a3e0001-0000-4000-8000-000000000009","role":"authenticated"}', true);
select throws_ok(
  $$ select public.import_sample_call('Sample call', '[{"speaker":"Maya","startMs":0,"endMs":1,"text":"Hi"}]'::jsonb) $$,
  '42501', null, 'someone in no company cannot'
);

select * from finish();
rollback;
