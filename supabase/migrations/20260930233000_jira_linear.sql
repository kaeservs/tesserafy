-- Jira and Linear, beside GitHub, as where a company's tickets go (ADR 0015
-- made the provider a column so this is a value and a client, not a table).
--
-- What a target looks like, per provider:
--   github   owner/repository
--   jira     <site>.atlassian.net/<PROJECT>   — Jira Cloud only
--   linear   <TEAM>                           — the team's key, e.g. ENG
--
-- Jira Cloud only, on purpose. The server calls the target with the company's
-- token; a free-form host would let anyone who can connect a tracker point
-- this server at any address it can reach, internal ones included. An
-- atlassian.net site is always Atlassian's. Linear has one API host, so its
-- target is only the team.

alter table public.company_trackers drop constraint company_trackers_provider_check;
alter table public.company_trackers add constraint company_trackers_provider_check
  check (provider in ('github', 'jira', 'linear'));

alter table public.company_trackers drop constraint company_trackers_target_check;
alter table public.company_trackers add constraint company_trackers_target_check check (
  (provider = 'github' and target ~ '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$')
  or (provider = 'jira' and target ~ '^[a-z0-9][a-z0-9-]{0,62}\.atlassian\.net/[A-Z][A-Z0-9_]{1,19}$')
  or (provider = 'linear' and target ~ '^[A-Z][A-Z0-9]{0,9}$')
);

alter table public.insight_tickets drop constraint insight_tickets_provider_check;
alter table public.insight_tickets add constraint insight_tickets_provider_check
  check (provider in ('github', 'jira', 'linear'));
