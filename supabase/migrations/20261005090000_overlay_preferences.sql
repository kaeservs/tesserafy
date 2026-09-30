-- The overlay's settings live in the dashboard (the owner's direction: every
-- control in the web app, as few as possible on the overlay itself).
--
-- Two per person:
--   - how the overlay looks (theme, accent, background opacity, size), which
--     used to be set on the overlay and kept on each computer. Where it sits
--     stays on each computer: that depends on the screen in front of the
--     seller, and is set by dragging it or with the arrow keys;
--   - which call prep is their next call. The overlay takes the customer,
--     the scorecard and the brief from it instead of asking for them. With
--     none chosen, it takes the prep of theirs whose call is nearest.
--
-- Only the person reads or writes their own row. A prep chosen must be one
-- their company holds; deleting the prep, or closing the company, clears it.

create table public.user_preferences (
  user_id       uuid primary key references auth.users (id) on delete cascade,
  overlay_look  jsonb not null default '{}'::jsonb
                check (jsonb_typeof(overlay_look) = 'object' and length(overlay_look::text) <= 500),
  next_prep_id  uuid references public.call_preps (id) on delete set null,
  updated_at    timestamptz not null default now()
);

comment on table public.user_preferences is
  'Each person''s own settings: how their overlay looks, and which call prep is their next call.';

alter table public.user_preferences enable row level security;

create policy "people read their own preferences"
  on public.user_preferences for select to authenticated
  using (user_id = (select auth.uid()));


-- How the overlay looks. Each value from the overlay's own short lists
-- (apps/desktop/src/main/appearance.ts); anything else is refused, not stored.
create function public.set_overlay_look(p_look jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_look jsonb := '{}'::jsonb;
  v_key  text;
begin
  if (select auth.uid()) is null then
    raise exception 'set_overlay_look: sign in first' using errcode = '42501';
  end if;
  if p_look is null or jsonb_typeof(p_look) <> 'object' then
    raise exception 'set_overlay_look: a look is an object' using errcode = '22023';
  end if;
  for v_key in select jsonb_object_keys(p_look) loop
    if v_key not in ('theme', 'accent', 'opacity', 'size') then
      raise exception 'set_overlay_look: % is not part of how the overlay looks', v_key using errcode = '22023';
    end if;
  end loop;
  if p_look ? 'theme' and p_look ->> 'theme' not in ('dark', 'midnight', 'light') then
    raise exception 'set_overlay_look: no such theme' using errcode = '22023';
  end if;
  if p_look ? 'accent' and p_look ->> 'accent' not in ('indigo', 'sky', 'violet', 'stone') then
    raise exception 'set_overlay_look: no such accent' using errcode = '22023';
  end if;
  if p_look ? 'size' and p_look ->> 'size' not in ('small', 'normal', 'large') then
    raise exception 'set_overlay_look: no such size' using errcode = '22023';
  end if;
  if p_look ? 'opacity' and (jsonb_typeof(p_look -> 'opacity') <> 'number'
     or (p_look ->> 'opacity')::numeric not between 35 and 100) then
    raise exception 'set_overlay_look: opacity is 35 to 100' using errcode = '22023';
  end if;

  insert into public.user_preferences (user_id, overlay_look)
  values ((select auth.uid()), p_look)
  on conflict (user_id) do update
    set overlay_look = public.user_preferences.overlay_look || excluded.overlay_look, updated_at = now()
  returning overlay_look into v_look;
  return v_look;
end;
$$;

-- Which prep is my next call; null clears it.
create function public.set_next_call(p_prep_id uuid default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'set_next_call: sign in first' using errcode = '42501';
  end if;
  if p_prep_id is not null and not exists (
    select 1 from public.call_preps p
     where p.id = p_prep_id and (select private.is_company_member(p.company_id))
  ) then
    raise exception 'set_next_call: prep not found' using errcode = 'P0002';
  end if;

  insert into public.user_preferences (user_id, next_prep_id)
  values ((select auth.uid()), p_prep_id)
  on conflict (user_id) do update set next_prep_id = excluded.next_prep_id, updated_at = now();
end;
$$;

revoke all on function public.set_overlay_look(jsonb) from public, anon;
revoke all on function public.set_next_call(uuid) from public, anon;
grant execute on function public.set_overlay_look(jsonb) to authenticated;
grant execute on function public.set_next_call(uuid) to authenticated;
