-- A failure of its own kind: the model provider refusing us for money.
--
-- When the Anthropic account ran out of credit (2026-10-01) every model call
-- came back 400 "Your credit balance is too low", and the alarm called it
-- `model_rejected`, "a request we built wrong", which sends whoever reads it
-- to the code. Nothing in the code was wrong; the fix was a top-up. So it is
-- `billing`: always actionable, and named for what fixes it.

alter table public.system_failures drop constraint system_failures_kind_check;
alter table public.system_failures add constraint system_failures_kind_check check (kind in (
  'model_rejected',
  'model_unavailable',
  -- The provider said no for money: out of credit, or a spend limit reached.
  -- Nothing in the code is wrong and nothing fixes itself.
  'billing',
  'database',
  'input',
  'unknown'
));
