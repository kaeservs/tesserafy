-- Fixes from the Supabase advisors after tenancy_foundation reached production.


-- 1. Cover the composite tenant foreign keys.
--    Without these, deleting a conversation or segment scans the child table
--    to enforce ON DELETE CASCADE.

create index segments_company_id_conversation_id_idx
  on public.segments (company_id, conversation_id);

-- Leads with company_id, so it also serves the tenant filter in
-- match_segments; the single-column index becomes redundant.
create index segment_embeddings_company_id_segment_id_idx
  on public.segment_embeddings (company_id, segment_id);

drop index public.segment_embeddings_company_id_idx;


-- 2. rls_auto_enable() is the platform's event-trigger function that turns on
--    RLS for new public tables. It is created with the project, so it exists
--    on the hosted database but not on a fresh local stack. Event triggers run
--    as the function owner, so revoking EXECUTE from API roles does not affect
--    the trigger — it only removes the function from the exposed RPC surface.

do $$
begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
  end if;
end;
$$;
