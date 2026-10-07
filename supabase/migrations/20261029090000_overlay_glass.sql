-- The overlay's Glass theme (2026-10-07): light glass over the meeting, frosted
-- by the system behind it where it can be (Windows 11 acrylic, macOS
-- vibrancy). set_overlay_look checks every theme it stores, so it learns the
-- new one; nothing else about it changes.

create or replace function public.set_overlay_look(p_look jsonb)
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
  if p_look ? 'theme' and p_look ->> 'theme' not in ('glass', 'dark', 'midnight', 'light') then
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
