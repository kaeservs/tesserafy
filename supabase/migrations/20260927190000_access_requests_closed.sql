-- Requests for a closed company are not waiting on anyone.
--
-- A company closed while an owner's request was open left that request in the
-- operator's list for good: nobody can be added to a closed company (the
-- trigger from 20260927090000 refuses it), so "Add" could only fail, and the
-- nav count would never reach zero. Found by running the request flow and
-- then closing its test company. The list shows open requests for open
-- companies; the request rows themselves stay, as the record of what was
-- asked.

create or replace function public.admin_access_requests()
returns table (
  id           uuid,
  company_id   uuid,
  company_name text,
  email        text,
  role         text,
  note         text,
  requested_by text,
  created_at   timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (select private.is_platform_admin()) then
    raise exception 'admin_access_requests: not a platform admin' using errcode = '42501';
  end if;

  return query
  select r.id, r.company_id, c.name, r.email, r.role, r.note,
         coalesce(u.email::text, 'a deleted account'), r.created_at
    from public.access_requests r
    join public.companies c on c.id = r.company_id
    left join auth.users u on u.id = r.requested_by
   where r.resolved_at is null
     and c.closed_at is null
   order by r.created_at;
end;
$$;
