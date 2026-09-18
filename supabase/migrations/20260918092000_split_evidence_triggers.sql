-- One trigger function per table, replacing the shared one from
-- 20260916094500_signals_and_evidence.sql.
--
-- The original branched on tg_op to read either new.id (insert on signals) or
-- old.signal_id (delete on signal_evidence). PL/pgSQL plans a CASE expression
-- as a whole, so the reference to old.signal_id was resolved against the
-- signals record — which has no such column — and every insert failed at
-- commit with "record \"old\" has no field \"signal_id\"".
--
-- It passed the pgTAP suite because those tests roll back: a deferred
-- constraint trigger never fires in a transaction that does not commit. The
-- test now forces the checks with `set constraints all immediate`.

drop trigger if exists signals_require_evidence on public.signals;
drop trigger if exists signal_evidence_keeps_signal_backed on public.signal_evidence;
drop function if exists public.assert_signal_has_evidence();

-- A signal must have evidence by the time the transaction commits.
create function public.assert_signal_has_evidence()
returns trigger
language plpgsql
stable
set search_path = ''
as $fn$
begin
  if not exists (select 1 from public.signal_evidence e where e.signal_id = new.id) then
    raise exception 'signal % has no evidence (invariant 4)', new.id
      using errcode = '23514';
  end if;
  return null;
end;
$fn$;

-- Removing evidence must not leave a signal unbacked. A signal deleted in the
-- same transaction is the cascade doing its job, not a violation.
create function public.assert_signal_still_backed()
returns trigger
language plpgsql
stable
set search_path = ''
as $fn$
begin
  if not exists (select 1 from public.signals s where s.id = old.signal_id) then
    return null;
  end if;

  if not exists (select 1 from public.signal_evidence e where e.signal_id = old.signal_id) then
    raise exception 'signal % has no evidence (invariant 4)', old.signal_id
      using errcode = '23514';
  end if;
  return null;
end;
$fn$;

create constraint trigger signals_require_evidence
  after insert on public.signals
  deferrable initially deferred
  for each row execute function public.assert_signal_has_evidence();

create constraint trigger signal_evidence_keeps_signal_backed
  after delete on public.signal_evidence
  deferrable initially deferred
  for each row execute function public.assert_signal_still_backed();
