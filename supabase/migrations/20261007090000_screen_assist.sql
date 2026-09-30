-- "Ask about your screen": whether this company's overlay may send a
-- screenshot to the AI with a question.
--
-- On by default, as it is in Cluely: the overlay captures one screenshot only
-- when a seller presses for it, of the display the overlay is on, and sends
-- it to the model for that answer alone — it is never stored. But a screen can
-- show anything, and some companies' compliance will not allow a picture of
-- it to leave the machine, so an owner can switch it off for everyone; the
-- overlay then offers no screen button, and /api/assist refuses a screenshot.

alter table public.companies add column screen_assist boolean not null default true;

comment on column public.companies.screen_assist is
  'Whether the overlay may send a screenshot with a question (Ask about your screen). Owners switch it.';

create function public.set_screen_assist(p_allowed boolean)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company_id uuid := private.sole_company_of_caller();
begin
  if not private.is_company_owner(v_company_id) then
    raise exception 'set_screen_assist: only an owner decides this' using errcode = '42501';
  end if;
  if p_allowed is null then
    raise exception 'set_screen_assist: on or off' using errcode = '22023';
  end if;
  update public.companies set screen_assist = p_allowed where id = v_company_id;
  return p_allowed;
end;
$$;

revoke all on function public.set_screen_assist(boolean) from public, anon;
grant execute on function public.set_screen_assist(boolean) to authenticated;
