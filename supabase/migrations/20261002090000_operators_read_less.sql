-- Operators stop reading four tables across every company: accounts,
-- our_speakers, moments and criterion_goals.
--
-- Each was given an "admins read all" policy by habit, as most tables have
-- one. The console reads none of them. What the policies did do was leak: an
-- operator who is also a member of a company — the owner is both — opens the
-- web app, whose pages run as them and trust RLS to mean "my company", and
-- sees every company's customers, examples, marked speaker names and goals on
-- their own dashboard. Found when two closed test companies' goals appeared on
-- a real company's dashboard.
--
-- Filtering by company on every page would fix today's pages and not the next
-- one. Taking away a read nobody needs fixes all of them. An operator who has
-- to see what a customer sees opens a recorded support session as them, which
-- is the rule for everything else a customer owns.
--
-- feedback keeps its policy: the console's Feedback page is exactly an
-- operator reading every company's, and the web app reads only what the
-- signed-in person sent.

drop policy "admins read all accounts" on public.accounts;
drop policy "admins read all speakers" on public.our_speakers;
drop policy "admins read all examples" on public.moments;
drop policy "admins read all goals" on public.criterion_goals;
