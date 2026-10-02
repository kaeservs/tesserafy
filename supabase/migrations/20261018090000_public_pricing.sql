-- The landing page's pricing, read from the catalogue itself, so what the
-- page says a plan includes is what the product enforces (a plan is a row,
-- not copy). A visitor who is not signed in reads only what is for sale —
-- the self-serve plans and the trial — never the pilot, internal or "no
-- plan" rows, which are not offers. Nothing else in the catalogue is private;
-- the table's own comment says it is what a pricing page shows.

create policy "visitors read the plans on sale"
  on public.plans for select to anon
  using (self_serve or id = 'trial');

grant select on public.plans to anon;
