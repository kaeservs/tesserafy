-- Web research for a call prep: the person's LinkedIn profile and a search
-- on their company, fetched through Apify when the platform has a token and
-- the seller asks for it, stored as sources the brief quotes and links.
--
-- The owner of the platform chose this, knowing LinkedIn's terms forbid
-- automated collection of profiles; it is behind a server setting, off
-- without it, and each seller chooses it per prep. What is kept is the least
-- that serves the brief: text only, contact details dropped, redacted like a
-- transcript, deleted with the prep and when the company is closed.
--
-- A source is { id, kind: 'linkedin' | 'web', url, title, text }. The brief
-- quotes a source by its id, and a quote that is not in that source's text
-- is dropped before anything is stored (packages/ai, t3-prep).

alter table public.call_preps
  add column research     jsonb check (research is null or jsonb_typeof(research) = 'object'),
  add column research_at  timestamptz;

-- Store the research, as whoever wrote the prep or an owner.
create function public.set_call_prep_research(p_prep_id uuid, p_research jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.call_preps;
begin
  select * into v_row from public.call_preps p where p.id = p_prep_id;
  if v_row.id is null or not (select private.is_company_member(v_row.company_id)) then
    raise exception 'set_call_prep_research: prep not found' using errcode = 'P0002';
  end if;
  if not private.may_change_prep(v_row) then
    raise exception 'set_call_prep_research: only whoever wrote it, or an owner, can change it' using errcode = '42501';
  end if;
  if p_research is null or jsonb_typeof(p_research) <> 'object' or jsonb_typeof(p_research -> 'sources') <> 'array' then
    raise exception 'set_call_prep_research: research is an object with a list of sources' using errcode = '22023';
  end if;
  if octet_length(p_research::text) > 60000 then
    raise exception 'set_call_prep_research: research is too long to keep' using errcode = '22023';
  end if;
  update public.call_preps set research = p_research, research_at = now() where id = p_prep_id;
end;
$$;

revoke all on function public.set_call_prep_research(uuid, jsonb) from public, anon;
grant execute on function public.set_call_prep_research(uuid, jsonb) to authenticated;
