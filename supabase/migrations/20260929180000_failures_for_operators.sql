-- Operators read every failure, in the console.
--
-- Until now a failure was readable by its own company's members and, beyond
-- that, only with the service role: `pnpm health` from a terminal, or the
-- scheduled job that emails when something needs a person. The console showed
-- a count on its overview and nothing behind it, so seeing *what* failed meant
-- leaving the console for a terminal holding the most powerful key there is.
--
-- The rows are safe to show an operator: recordFailure masks the identifiers
-- a pattern can find and removes anything shaped like a credential before a
-- row is written (packages/ai/src/telemetry/failures.ts), and the database caps
-- the message again. Most live failures carry no company at all, which is why
-- the existing member policy could never have shown them.

create policy "admins read all failures"
  on public.system_failures for select to authenticated
  using ((select private.is_platform_admin()));
