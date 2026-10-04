-- An operator removes an entry from the early-access list: spam that got past
-- the hidden field, or someone who asked to be taken off. The address is gone,
-- not hidden.

create function public.admin_remove_early_access(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not (select private.is_platform_admin()) then
    raise exception 'admin_remove_early_access: operators only' using errcode = '42501';
  end if;
  delete from public.early_access where id = p_id;
end;
$$;

revoke all on function public.admin_remove_early_access(uuid) from public, anon;
grant execute on function public.admin_remove_early_access(uuid) to authenticated;
