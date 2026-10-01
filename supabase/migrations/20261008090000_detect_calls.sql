-- Whether the overlay shows itself when a call starts.
--
-- On Windows the overlay can tell that a meeting app — Zoom, Teams, Webex,
-- Slack, or a browser running Meet or Teams — has started using the
-- microphone, and comes up offering Start. It never starts recording on its
-- own: the consent confirmation comes first, every time. Some people would
-- rather call it up themselves, so it is a per-person setting, in the
-- dashboard with the overlay's others (Account → Overlay). On by default.

alter table public.user_preferences add column detect_calls boolean not null default true;

comment on column public.user_preferences.detect_calls is
  'Whether the overlay shows itself, offering Start, when a meeting app starts using the microphone.';

create function public.set_detect_calls(p_on boolean)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'set_detect_calls: sign in first' using errcode = '42501';
  end if;
  if p_on is null then
    raise exception 'set_detect_calls: on or off' using errcode = '22023';
  end if;
  insert into public.user_preferences (user_id, detect_calls)
  values ((select auth.uid()), p_on)
  on conflict (user_id) do update set detect_calls = excluded.detect_calls, updated_at = now();
  return p_on;
end;
$$;

revoke all on function public.set_detect_calls(boolean) from public, anon;
grant execute on function public.set_detect_calls(boolean) to authenticated;
