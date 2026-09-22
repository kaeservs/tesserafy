-- `min(uuid)` does not exist.
--
-- sole_company_of_caller() counted memberships and took min(company_id) in
-- the same statement, to get the count and the id in one pass. Postgres has
-- no min() for uuid, so every call raised 42883 and the whole live path fell
-- over at its first step — a conversation could not be started at all.
--
-- It was not caught before the migration was applied because the function is
-- only reachable from a signed-in caller who names no company, and nothing
-- exercised that until the end-to-end probe did.
--
-- Two statements instead of a clever one. The count is what decides, and the
-- id is only read in the case where there is exactly one, so reading it
-- separately cannot disagree with the count in any way that matters.

create or replace function private.sole_company_of_caller()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_company_id uuid;
  v_count      integer;
begin
  select count(*) into v_count
  from public.company_members m
  where m.user_id = (select auth.uid());

  if v_count = 0 then
    raise exception 'not a member of any company' using errcode = '42501';
  end if;
  if v_count > 1 then
    raise exception 'member of several companies; say which one'
      using errcode = '22023';
  end if;

  select m.company_id into v_company_id
  from public.company_members m
  where m.user_id = (select auth.uid());

  return v_company_id;
end;
$$;
