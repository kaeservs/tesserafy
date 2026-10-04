-- Payments, through Stripe (ADR 0025).
--
-- The plans migration said it: "when Stripe lands, starting or upgrading a
-- paid plan moves to checkout and its webhook calls private.apply_plan — the
-- same function this uses — so the rules do not change, only who may start a
-- paid period." This is that.
--
-- Stripe tells us what happened by calling a webhook, and only the database
-- may change a plan. The web app holds no service-role key (invariant 3), so
-- the webhook's request cannot be trusted by who sends it — it arrives as
-- nobody. It is trusted by what it carries: Stripe signs every event with a
-- secret only Stripe and this database know, and `stripe_event` checks that
-- signature itself, in here, before reading a word of it. The web route only
-- forwards the body and the signature header. An event that is unsigned,
-- signed with anything else, more than five minutes old, or already seen
-- changes nothing.
--
-- The secret is set by an operator (console → Payments) into a table in the
-- private schema, which no API role can read; it never leaves the database.
-- Which Stripe price is which plan is a column on the catalogue, set the same
-- way. Payments are on once both are there; until then plans stay free, as
-- they have been.
--
-- Once a company pays through Stripe, Stripe owns its subscription: changing
-- plan, the card, invoices and cancelling are in Stripe's billing page, and
-- what Stripe says comes back here through the webhook. Periods come from
-- Stripe too, so the nightly roll leaves those subscriptions alone (it always
-- has: roll_subscription returns for any provider but 'none').

create extension if not exists pgcrypto with schema extensions;

alter table public.plans
  add column stripe_price_id text unique check (stripe_price_id is null or stripe_price_id ~ '^price_[A-Za-z0-9]+$');

comment on column public.plans.stripe_price_id is
  'The Stripe price a paid plan is sold at (set by an operator). Null: not sold through Stripe.';

create table private.stripe_settings (
  id              boolean primary key default true check (id),
  webhook_secret  text check (webhook_secret is null or webhook_secret ~ '^whsec_[A-Za-z0-9+/=_-]+$'),
  updated_by      uuid references auth.users (id) on delete set null,
  updated_at      timestamptz not null default now()
);

insert into private.stripe_settings (id) values (true);

-- What operators changed about payments: never the secret itself.
create table public.payment_setting_events (
  id       uuid primary key default gen_random_uuid(),
  setting  text not null check (setting in ('webhook_secret', 'price')),
  detail   text not null check (length(detail) <= 200),
  actor    uuid references auth.users (id) on delete set null,
  at       timestamptz not null default now()
);

alter table public.payment_setting_events enable row level security;

create policy "admins read payment setting changes"
  on public.payment_setting_events for select to authenticated
  using ((select private.is_platform_admin()));

-- Every event Stripe sent, once: what it was, which company, and what it did.
create table public.stripe_events (
  id           text primary key check (id ~ '^evt_[A-Za-z0-9]+$'),
  type         text not null check (length(type) <= 100),
  company_id   uuid references public.companies (id) on delete set null,
  outcome      text not null default 'received' check (length(outcome) <= 100),
  received_at  timestamptz not null default now()
);

create index stripe_events_received_idx on public.stripe_events (received_at desc);

alter table public.stripe_events enable row level security;

create policy "admins read Stripe events"
  on public.stripe_events for select to authenticated
  using ((select private.is_platform_admin()));


-- Payments are on when Stripe can sign to us and every paid plan has a price.
create function private.payments_ready()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from private.stripe_settings s where s.id and s.webhook_secret is not null)
     and not exists (select 1 from public.plans p where p.self_serve and p.stripe_price_id is null);
$$;

revoke all on function private.payments_ready() from public, anon;

create function public.payments_ready()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.payments_ready();
$$;

revoke all on function public.payments_ready() from public, anon;
grant execute on function public.payments_ready() to authenticated;

-- Whether the caller's session began inside a support window (the same
-- definition the follow-up sending and CRM migrations carry).
create or replace function private.in_support_session()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from auth.sessions s
      join public.support_access a on a.subject_user_id = s.user_id
     where s.id = nullif((select auth.jwt()) ->> 'session_id', '')::uuid
       and s.user_id = (select auth.uid())
       and s.created_at >= a.created_at
       and s.created_at <= a.expires_at
  );
$$;

revoke all on function private.in_support_session() from public, anon;


-- ---------------------------------------------------------------------------
-- The operator
-- ---------------------------------------------------------------------------

create function public.admin_set_stripe_webhook_secret(p_secret text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not (select private.is_platform_admin()) then
    raise exception 'admin_set_stripe_webhook_secret: not a platform admin' using errcode = '42501';
  end if;
  if p_secret is not null and p_secret !~ '^whsec_[A-Za-z0-9+/=_-]+$' then
    raise exception 'admin_set_stripe_webhook_secret: a signing secret starts whsec_' using errcode = '22023';
  end if;
  update private.stripe_settings set webhook_secret = p_secret, updated_by = (select auth.uid()), updated_at = now() where id;
  insert into public.payment_setting_events (setting, detail, actor)
  values ('webhook_secret', case when p_secret is null then 'removed' else 'set, ending ' || right(p_secret, 4) end, (select auth.uid()));
end;
$$;

create function public.admin_set_plan_price(p_plan text, p_price_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not (select private.is_platform_admin()) then
    raise exception 'admin_set_plan_price: not a platform admin' using errcode = '42501';
  end if;
  if not exists (select 1 from public.plans p where p.id = p_plan and p.self_serve) then
    raise exception 'admin_set_plan_price: only Basic and Pro are sold' using errcode = '22023';
  end if;
  update public.plans set stripe_price_id = nullif(trim(p_price_id), '') where id = p_plan;
  insert into public.payment_setting_events (setting, detail, actor)
  values ('price', p_plan || ': ' || coalesce(nullif(trim(p_price_id), ''), 'removed'), (select auth.uid()));
end;
$$;

-- What the console shows: whether the secret is there (never the secret).
create function public.admin_payments_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (select private.is_platform_admin()) then
    raise exception 'admin_payments_status: not a platform admin' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'ready', private.payments_ready(),
    'webhook_secret_hint', (select right(s.webhook_secret, 4) from private.stripe_settings s where s.id),
    'webhook_secret_set_at', (select s.updated_at from private.stripe_settings s where s.id and s.webhook_secret is not null),
    'paying', (select count(*) from public.subscriptions s where s.provider = 'stripe')
  );
end;
$$;

revoke all on function public.admin_set_stripe_webhook_secret(text) from public, anon;
revoke all on function public.admin_set_plan_price(text, text) from public, anon;
revoke all on function public.admin_payments_status() from public, anon;
grant execute on function public.admin_set_stripe_webhook_secret(text) to authenticated;
grant execute on function public.admin_set_plan_price(text, text) to authenticated;
grant execute on function public.admin_payments_status() to authenticated;


-- ---------------------------------------------------------------------------
-- The owner: checkout and billing
-- ---------------------------------------------------------------------------

-- What checkout needs, for an owner choosing a paid plan: refused for anyone
-- else, from a support session, while payments are off, for a plan set by
-- Tesserafy, and for a company already paying through Stripe (that is a
-- change in billing, not a second subscription).
create function public.billing_checkout(p_plan text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid        uuid := (select auth.uid());
  v_company_id uuid := private.sole_company_of_caller();
  v_sub        public.subscriptions;
  v_current    text;
  v_price      text;
begin
  if not exists (
    select 1 from public.company_members m
     where m.company_id = v_company_id and m.user_id = v_uid and m.role = 'owner'
  ) or (select private.in_support_session()) then
    raise exception 'billing_checkout: only an owner can choose what the company pays for' using errcode = '42501';
  end if;
  if not private.payments_ready() then
    raise exception 'billing_checkout: payments are not open yet' using errcode = '55000';
  end if;
  select p.stripe_price_id into v_price from public.plans p where p.id = p_plan and p.self_serve;
  if v_price is null then
    raise exception 'billing_checkout: choose Basic or Pro' using errcode = '22023';
  end if;
  select c.plan into v_current from public.companies c where c.id = v_company_id;
  if v_current in ('pilot', 'internal') then
    raise exception 'billing_checkout: your plan is set by Tesserafy; ask them to change it' using errcode = '22023';
  end if;
  select * into v_sub from public.subscriptions where company_id = v_company_id;
  if v_sub.provider = 'stripe' then
    raise exception 'billing_checkout: you already pay through Stripe; change the plan in billing' using errcode = '22023';
  end if;

  return jsonb_build_object(
    'company_id', v_company_id,
    'price_id', v_price,
    'customer_id', v_sub.provider_customer_id,
    'email', (select u.email from auth.users u where u.id = v_uid)
  );
end;
$$;

-- The Stripe customer whose billing page an owner opens.
create function public.billing_customer()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid        uuid := (select auth.uid());
  v_company_id uuid := private.sole_company_of_caller();
  v_customer   text;
begin
  if not exists (
    select 1 from public.company_members m
     where m.company_id = v_company_id and m.user_id = v_uid and m.role = 'owner'
  ) or (select private.in_support_session()) then
    raise exception 'billing_customer: only an owner can open billing' using errcode = '42501';
  end if;
  select s.provider_customer_id into v_customer from public.subscriptions s where s.company_id = v_company_id;
  if v_customer is null then
    raise exception 'billing_customer: the company has not paid through Stripe' using errcode = 'P0002';
  end if;
  return v_customer;
end;
$$;

revoke all on function public.billing_checkout(text) from public, anon;
revoke all on function public.billing_customer() from public, anon;
grant execute on function public.billing_checkout(text) to authenticated;
grant execute on function public.billing_customer() to authenticated;


-- Once payments are on, a paid plan starts or goes up only through checkout,
-- and a company paying through Stripe changes or cancels in billing. The
-- rest of change_plan and cancel_plan is as it was.
create or replace function public.change_plan(p_plan text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid        uuid := (select auth.uid());
  v_company_id uuid := private.sole_company_of_caller();
  v_sub        public.subscriptions;
  v_current    public.plans;
  v_target     public.plans;
begin
  if not exists (
    select 1 from public.company_members m
     where m.company_id = v_company_id and m.user_id = v_uid and m.role = 'owner'
  ) then
    raise exception 'change_plan: only an owner can change the plan' using errcode = '42501';
  end if;

  perform private.roll_subscription(v_company_id);
  select * into v_sub from public.subscriptions where company_id = v_company_id for update;
  select p.* into v_current from public.plans p join public.companies c on c.plan = p.id where c.id = v_company_id;
  select * into v_target from public.plans where id = p_plan;

  if v_target.id is null or not v_target.self_serve then
    raise exception 'change_plan: choose Basic or Pro' using errcode = '22023';
  end if;
  if v_current.id in ('pilot', 'internal') then
    raise exception 'change_plan: your plan is set by Tesserafy; ask them to change it' using errcode = '22023';
  end if;
  if v_sub.provider = 'stripe' then
    raise exception 'change_plan: you pay through Stripe; change the plan in billing' using errcode = '22023';
  end if;

  -- From nothing, or from the trial: a paid period starts now — through
  -- checkout once payments are on.
  if v_current.id in ('none', 'trial') then
    if private.payments_ready() then
      raise exception 'change_plan: a paid plan starts at checkout' using errcode = '22023';
    end if;
    perform private.apply_plan(v_company_id, v_target.id, 'started', 'owner', v_uid);
    return 'started';
  end if;

  -- The plan they already have: this is undoing a pending cancel or downgrade.
  if v_target.id = v_current.id then
    if not v_sub.cancel_at_period_end and v_sub.scheduled_plan is null then
      raise exception 'change_plan: you are already on %', v_target.name using errcode = '22023';
    end if;
    update public.subscriptions
       set cancel_at_period_end = false, scheduled_plan = null, updated_at = now()
     where company_id = v_company_id;
    insert into public.subscription_events (company_id, kind, from_plan, to_plan, source, actor)
    values (v_company_id, 'change_undone', v_current.id, v_current.id, 'owner', v_uid);
    return 'kept';
  end if;

  -- Up: now, and within the same period — more allowance straight away.
  if v_target.rank > v_current.rank then
    if private.payments_ready() then
      raise exception 'change_plan: a paid plan starts at checkout' using errcode = '22023';
    end if;
    update public.companies set plan = v_target.id where id = v_company_id;
    update public.subscriptions
       set cancel_at_period_end = false, scheduled_plan = null, updated_at = now()
     where company_id = v_company_id;
    insert into public.subscription_events (company_id, kind, from_plan, to_plan, source, actor)
    values (v_company_id, 'upgraded', v_current.id, v_target.id, 'owner', v_uid);
    return 'upgraded';
  end if;

  -- Down: at the end of the period they have, which is what they have had.
  update public.subscriptions
     set scheduled_plan = v_target.id, cancel_at_period_end = false, updated_at = now()
   where company_id = v_company_id;
  insert into public.subscription_events (company_id, kind, from_plan, to_plan, source, actor)
  values (v_company_id, 'downgrade_scheduled', v_current.id, v_target.id, 'owner', v_uid);
  return 'downgrade_scheduled';
end;
$$;

create or replace function public.cancel_plan()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid        uuid := (select auth.uid());
  v_company_id uuid := private.sole_company_of_caller();
  v_plan       public.plans;
begin
  if not exists (
    select 1 from public.company_members m
     where m.company_id = v_company_id and m.user_id = v_uid and m.role = 'owner'
  ) then
    raise exception 'cancel_plan: only an owner can cancel' using errcode = '42501';
  end if;
  if exists (select 1 from public.subscriptions s where s.company_id = v_company_id and s.provider = 'stripe') then
    raise exception 'cancel_plan: you pay through Stripe; cancel in billing' using errcode = '22023';
  end if;
  select p.* into v_plan from public.plans p join public.companies c on c.plan = p.id where c.id = v_company_id;
  if not v_plan.self_serve then
    raise exception 'cancel_plan: there is no paid plan to cancel' using errcode = '22023';
  end if;

  update public.subscriptions
     set cancel_at_period_end = true, scheduled_plan = null, updated_at = now()
   where company_id = v_company_id;
  insert into public.subscription_events (company_id, kind, from_plan, to_plan, source, actor)
  values (v_company_id, 'cancel_scheduled', v_plan.id, 'none', 'owner', v_uid);
end;
$$;


-- ---------------------------------------------------------------------------
-- Stripe's webhook
-- ---------------------------------------------------------------------------

-- A Stripe subscription as Stripe has it now: the plan its price is, its
-- period, and whether it ends at that period's end.
create function private.stripe_sync(
  p_company_id      uuid,
  p_plan            text,
  p_period_start    timestamptz,
  p_period_end      timestamptz,
  p_cancel_at_end   boolean,
  p_subscription_id text,
  p_customer_id     text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current  public.plans;
  v_target   public.plans;
  v_sub      public.subscriptions;
begin
  select p.* into v_current from public.plans p join public.companies c on c.plan = p.id where c.id = p_company_id for update of c;
  select * into v_target from public.plans where id = p_plan;
  select * into v_sub from public.subscriptions where company_id = p_company_id for update;

  if v_target.id <> v_current.id then
    update public.companies set plan = v_target.id where id = p_company_id;
    insert into public.subscription_events (company_id, kind, from_plan, to_plan, source)
    values (p_company_id,
            case when v_current.id in ('none', 'trial') then 'started'
                 when v_target.rank > v_current.rank then 'upgraded' else 'downgraded' end,
            v_current.id, v_target.id, 'stripe');
  end if;
  if p_cancel_at_end and not v_sub.cancel_at_period_end then
    insert into public.subscription_events (company_id, kind, from_plan, to_plan, source)
    values (p_company_id, 'cancel_scheduled', v_target.id, 'none', 'stripe');
  elsif not p_cancel_at_end and v_sub.cancel_at_period_end then
    insert into public.subscription_events (company_id, kind, from_plan, to_plan, source)
    values (p_company_id, 'change_undone', v_target.id, v_target.id, 'stripe');
  end if;

  update public.subscriptions
     set status = 'active',
         provider = 'stripe',
         provider_subscription_id = p_subscription_id,
         provider_customer_id = coalesce(p_customer_id, provider_customer_id),
         period_start = coalesce(p_period_start, period_start),
         period_end = coalesce(p_period_end, period_end),
         cancel_at_period_end = p_cancel_at_end,
         scheduled_plan = null,
         updated_at = now()
   where company_id = p_company_id;
  return 'synced ' || v_target.id;
end;
$$;

-- The Stripe subscription ended: no plan, and the next one starts at checkout
-- again (the customer is kept, so it is the same Stripe customer).
create function private.stripe_end(p_company_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.apply_plan(p_company_id, 'none', 'canceled', 'stripe', null);
  update public.subscriptions
     set provider = 'none', provider_subscription_id = null, updated_at = now()
   where company_id = p_company_id;
  return 'ended';
end;
$$;

revoke all on function private.stripe_sync(uuid, text, timestamptz, timestamptz, boolean, text, text) from public, anon, authenticated;
revoke all on function private.stripe_end(uuid) from public, anon, authenticated;

create function private.unix_time(p_value jsonb)
returns timestamptz
language sql
immutable
set search_path = ''
as $$
  select case when jsonb_typeof(p_value) = 'number' then to_timestamp((p_value)::text::double precision) end;
$$;

-- Callable by anyone, because Stripe is nobody to us: what makes an event
-- count is its signature, checked here before anything in it is read.
create function public.stripe_event(p_payload text, p_signature text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_secret   text;
  v_time     text;
  v_sigs     text[];
  v_event    jsonb;
  v_obj      jsonb;
  v_type     text;
  v_company  uuid;
  v_plan     text;
  v_item     jsonb;
  v_status   text;
  v_outcome  text;
begin
  select s.webhook_secret into v_secret from private.stripe_settings s where s.id;
  if v_secret is null then
    raise exception 'stripe_event: payments are not set up' using errcode = '55000';
  end if;
  if p_payload is null or length(p_payload) > 1000000 or p_signature is null or length(p_signature) > 2000 then
    raise exception 'stripe_event: not a Stripe event' using errcode = '28000';
  end if;

  -- Stripe-Signature: t=<unix time>,v1=<hex HMAC-SHA256 of "t.payload">[,v1=…]
  select split_part(part, '=', 2) into v_time
    from unnest(string_to_array(p_signature, ',')) as part where split_part(part, '=', 1) = 't' limit 1;
  select array_agg(substr(part, 4)) into v_sigs
    from unnest(string_to_array(p_signature, ',')) as part where part like 'v1=%';
  if v_time is null or v_time !~ '^[0-9]{1,12}$' or v_sigs is null then
    raise exception 'stripe_event: not signed' using errcode = '28000';
  end if;
  if abs(extract(epoch from now()) - v_time::bigint) > 300 then
    raise exception 'stripe_event: signed too long ago' using errcode = '28000';
  end if;
  if not (encode(extensions.hmac(convert_to(v_time || '.' || p_payload, 'UTF8'), convert_to(v_secret, 'UTF8'), 'sha256'), 'hex') = any (v_sigs)) then
    raise exception 'stripe_event: the signature does not match' using errcode = '28000';
  end if;

  v_event := p_payload::jsonb;
  v_type := v_event ->> 'type';
  v_obj := v_event -> 'data' -> 'object';
  insert into public.stripe_events (id, type) values (v_event ->> 'id', left(coalesce(v_type, '?'), 100))
  on conflict (id) do nothing;
  if not found then
    return 'duplicate';
  end if;

  if v_type = 'checkout.session.completed' then
    v_company := case when coalesce(v_obj ->> 'client_reference_id', '') ~ '^[0-9a-f-]{36}$'
                      then (v_obj ->> 'client_reference_id')::uuid end;
    v_plan := v_obj -> 'metadata' ->> 'plan';
    if v_company is null or not exists (select 1 from public.companies c where c.id = v_company and c.closed_at is null)
       or not exists (select 1 from public.plans p where p.id = v_plan and p.self_serve) then
      v_outcome := 'ignored: no company or plan';
    else
      update public.subscriptions
         set provider_customer_id = coalesce(v_obj ->> 'customer', provider_customer_id),
             updated_at = now()
       where company_id = v_company;
      -- The subscription's own events set the period; this makes sure the
      -- plan starts even if they arrive first or not at all.
      if (select s.provider from public.subscriptions s where s.company_id = v_company) = 'stripe'
         and (select c.plan from public.companies c where c.id = v_company) = v_plan then
        v_outcome := 'already started';
      else
        v_outcome := private.stripe_sync(v_company, v_plan, null, null, false, v_obj ->> 'subscription', v_obj ->> 'customer');
      end if;
    end if;

  elsif v_type in ('customer.subscription.created', 'customer.subscription.updated', 'customer.subscription.deleted') then
    select s.company_id into v_company from public.subscriptions s where s.provider_subscription_id = v_obj ->> 'id';
    if v_company is null and coalesce(v_obj -> 'metadata' ->> 'company_id', '') ~ '^[0-9a-f-]{36}$' then
      select c.id into v_company from public.companies c
       where c.id = (v_obj -> 'metadata' ->> 'company_id')::uuid and c.closed_at is null;
    end if;
    v_item := v_obj -> 'items' -> 'data' -> 0;
    select p.id into v_plan from public.plans p where p.stripe_price_id = v_item -> 'price' ->> 'id';
    v_status := v_obj ->> 'status';

    if v_company is null then
      v_outcome := 'ignored: no company';
    elsif v_type = 'customer.subscription.deleted' or v_status in ('canceled', 'unpaid', 'incomplete_expired') then
      v_outcome := private.stripe_end(v_company);
    elsif v_status in ('active', 'trialing', 'past_due') and v_plan is not null then
      -- Newer Stripe API versions keep the period on the item, older ones on
      -- the subscription.
      v_outcome := private.stripe_sync(
        v_company, v_plan,
        coalesce(private.unix_time(v_obj -> 'current_period_start'), private.unix_time(v_item -> 'current_period_start')),
        coalesce(private.unix_time(v_obj -> 'current_period_end'), private.unix_time(v_item -> 'current_period_end')),
        coalesce((v_obj ->> 'cancel_at_period_end')::boolean, false),
        v_obj ->> 'id', v_obj ->> 'customer');
    elsif v_plan is null then
      v_outcome := 'ignored: a price that is no plan';
    else
      v_outcome := 'waiting: ' || coalesce(v_status, '?');
    end if;

  else
    v_outcome := 'ignored';
  end if;

  update public.stripe_events set outcome = left(v_outcome, 100), company_id = v_company where id = v_event ->> 'id';
  return v_outcome;
end;
$$;

revoke all on function public.stripe_event(text, text) from public;
grant execute on function public.stripe_event(text, text) to anon, authenticated;
