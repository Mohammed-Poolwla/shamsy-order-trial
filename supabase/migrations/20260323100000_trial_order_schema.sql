-- Shamsy trial task (additive only on shared restaurant-network project)
-- Creates ONLY new shamsy_* objects. Does not DROP or ALTER existing RN tables.

create extension if not exists "pgcrypto";

do $$ begin
  create type public.shamsy_app_role as enum ('owner', 'adviser');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.shamsy_order_status as enum ('saved');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.shamsy_line_approval as enum ('none', 'required', 'approved');
exception when duplicate_object then null;
end $$;

create table if not exists public.shamsy_profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null,
  role public.shamsy_app_role not null,
  created_at timestamptz not null default now()
);

alter table public.shamsy_profiles enable row level security;

create or replace function public.shamsy_current_role()
returns public.shamsy_app_role
language sql
stable
security definer
set search_path = public
as $$
  select role from public.shamsy_profiles where id = auth.uid();
$$;

create or replace function public.shamsy_is_owner()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.shamsy_profiles
    where id = auth.uid() and role = 'owner'
  );
$$;

drop policy if exists "shamsy_profiles_select" on public.shamsy_profiles;
create policy "shamsy_profiles_select"
  on public.shamsy_profiles for select
  to authenticated
  using (id = auth.uid() or public.shamsy_is_owner());

create table if not exists public.shamsy_app_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id)
);

alter table public.shamsy_app_settings enable row level security;

drop policy if exists "shamsy_settings_select" on public.shamsy_app_settings;
create policy "shamsy_settings_select"
  on public.shamsy_app_settings for select
  to authenticated
  using (true);

drop policy if exists "shamsy_settings_update" on public.shamsy_app_settings;
create policy "shamsy_settings_update"
  on public.shamsy_app_settings for update
  to authenticated
  using (public.shamsy_is_owner())
  with check (public.shamsy_is_owner());

insert into public.shamsy_app_settings (key, value) values
  ('min_exchange_rate', '8000'::jsonb),
  ('default_exchange_rate', '8200'::jsonb)
on conflict (key) do nothing;

create table if not exists public.shamsy_products (
  id uuid primary key default gen_random_uuid(),
  sku text not null unique,
  name text not null,
  unit_price_cents bigint not null check (unit_price_cents > 0),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.shamsy_products enable row level security;

drop policy if exists "shamsy_products_select" on public.shamsy_products;
create policy "shamsy_products_select"
  on public.shamsy_products for select
  to authenticated
  using (active = true);

drop policy if exists "shamsy_products_owner_all" on public.shamsy_products;
create policy "shamsy_products_owner_all"
  on public.shamsy_products for all
  to authenticated
  using (public.shamsy_is_owner())
  with check (public.shamsy_is_owner());

create table if not exists public.shamsy_customers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  city text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.shamsy_customers enable row level security;

drop policy if exists "shamsy_customers_select" on public.shamsy_customers;
create policy "shamsy_customers_select"
  on public.shamsy_customers for select
  to authenticated
  using (active = true);

drop policy if exists "shamsy_customers_insert" on public.shamsy_customers;
create policy "shamsy_customers_insert"
  on public.shamsy_customers for insert
  to authenticated
  with check (public.shamsy_current_role() in ('owner', 'adviser'));

create table if not exists public.shamsy_orders (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.shamsy_customers (id),
  created_by uuid not null references auth.users (id),
  exchange_rate integer not null check (exchange_rate > 0),
  total_usd_cents bigint not null check (total_usd_cents >= 0),
  total_sdg bigint not null check (total_sdg >= 0),
  status public.shamsy_order_status not null default 'saved',
  created_at timestamptz not null default now()
);

alter table public.shamsy_orders enable row level security;

drop policy if exists "shamsy_orders_select" on public.shamsy_orders;
create policy "shamsy_orders_select"
  on public.shamsy_orders for select
  to authenticated
  using (public.shamsy_is_owner() or created_by = auth.uid());

drop policy if exists "shamsy_orders_no_insert" on public.shamsy_orders;
create policy "shamsy_orders_no_insert"
  on public.shamsy_orders for insert
  to authenticated
  with check (false);

drop policy if exists "shamsy_orders_no_update" on public.shamsy_orders;
create policy "shamsy_orders_no_update"
  on public.shamsy_orders for update
  to authenticated
  using (false);

drop policy if exists "shamsy_orders_no_delete" on public.shamsy_orders;
create policy "shamsy_orders_no_delete"
  on public.shamsy_orders for delete
  to authenticated
  using (false);

create table if not exists public.shamsy_order_lines (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.shamsy_orders (id) on delete cascade,
  product_id uuid not null references public.shamsy_products (id),
  quantity integer not null check (quantity > 0),
  unit_price_cents bigint not null check (unit_price_cents > 0),
  discount_cents bigint not null default 0 check (discount_cents >= 0),
  line_value_cents bigint not null check (line_value_cents > 0),
  line_total_cents bigint not null check (line_total_cents >= 0),
  discount_bps integer not null check (discount_bps >= 0),
  approval public.shamsy_line_approval not null default 'none',
  approved_by uuid references auth.users (id),
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  constraint shamsy_line_math check (
    line_value_cents = unit_price_cents * quantity
    and line_total_cents = line_value_cents - discount_cents
    and discount_cents <= line_value_cents
  )
);

alter table public.shamsy_order_lines enable row level security;

drop policy if exists "shamsy_order_lines_select" on public.shamsy_order_lines;
create policy "shamsy_order_lines_select"
  on public.shamsy_order_lines for select
  to authenticated
  using (
    exists (
      select 1 from public.shamsy_orders o
      where o.id = order_id
        and (public.shamsy_is_owner() or o.created_by = auth.uid())
    )
  );

drop policy if exists "shamsy_order_lines_no_insert" on public.shamsy_order_lines;
create policy "shamsy_order_lines_no_insert"
  on public.shamsy_order_lines for insert
  to authenticated
  with check (false);

drop policy if exists "shamsy_order_lines_owner_update" on public.shamsy_order_lines;
create policy "shamsy_order_lines_owner_update"
  on public.shamsy_order_lines for update
  to authenticated
  using (public.shamsy_is_owner())
  with check (public.shamsy_is_owner());

create table if not exists public.shamsy_discount_approvals (
  id uuid primary key default gen_random_uuid(),
  requested_by uuid not null references auth.users (id),
  customer_id uuid not null references public.shamsy_customers (id),
  exchange_rate integer not null,
  payload jsonb not null,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected', 'consumed')),
  reviewed_by uuid references auth.users (id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.shamsy_discount_approvals enable row level security;

drop policy if exists "shamsy_approvals_select" on public.shamsy_discount_approvals;
create policy "shamsy_approvals_select"
  on public.shamsy_discount_approvals for select
  to authenticated
  using (requested_by = auth.uid() or public.shamsy_is_owner());

drop policy if exists "shamsy_approvals_insert" on public.shamsy_discount_approvals;
create policy "shamsy_approvals_insert"
  on public.shamsy_discount_approvals for insert
  to authenticated
  with check (
    requested_by = auth.uid()
    and public.shamsy_current_role() in ('adviser', 'owner')
  );

drop policy if exists "shamsy_approvals_update" on public.shamsy_discount_approvals;
create policy "shamsy_approvals_update"
  on public.shamsy_discount_approvals for update
  to authenticated
  using (public.shamsy_is_owner())
  with check (public.shamsy_is_owner());

create or replace function public.shamsy_discount_bps(p_discount_cents bigint, p_line_value_cents bigint)
returns integer
language sql
immutable
as $$
  select case
    when p_line_value_cents <= 0 then 0
    else ((p_discount_cents * 10000) / p_line_value_cents)::integer
  end;
$$;

create or replace function public.shamsy_line_band(p_bps integer)
returns text
language sql
immutable
as $$
  select case
    when p_bps = 0 then 'none'
    when p_bps <= 300 then 'sand'
    when p_bps <= 500 then 'red'
    else 'blocked'
  end;
$$;

create or replace function public.shamsy_usd_cents_to_sdg(p_usd_cents bigint, p_rate integer)
returns bigint
language sql
immutable
as $$
  select (p_usd_cents * p_rate) / 100;
$$;

create or replace function public.shamsy_create_order(
  p_customer_id uuid,
  p_exchange_rate integer,
  p_lines jsonb,
  p_approval_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_role public.shamsy_app_role;
  v_min_rate integer;
  v_rate integer;
  v_order_id uuid;
  v_line jsonb;
  v_product public.shamsy_products%rowtype;
  v_qty integer;
  v_discount bigint;
  v_line_value bigint;
  v_line_total bigint;
  v_bps integer;
  v_band text;
  v_approval public.shamsy_line_approval;
  v_total_usd bigint := 0;
  v_total_sdg bigint;
  v_has_blocked boolean := false;
  v_approval_row public.shamsy_discount_approvals%rowtype;
  v_approved_map jsonb := '{}'::jsonb;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  select role into v_role from public.shamsy_profiles where id = v_uid;
  if v_role is null then
    raise exception 'No profile for user';
  end if;

  if not exists (select 1 from public.shamsy_customers c where c.id = p_customer_id and c.active) then
    raise exception 'Invalid customer';
  end if;

  select (value #>> '{}')::integer into v_min_rate
  from public.shamsy_app_settings where key = 'min_exchange_rate';

  if v_min_rate is null then
    v_min_rate := 8000;
  end if;

  v_rate := p_exchange_rate;
  if v_rate < v_min_rate then
    raise exception 'Exchange rate % is below minimum %', v_rate, v_min_rate;
  end if;

  if p_approval_id is not null then
    select * into v_approval_row
    from public.shamsy_discount_approvals
    where id = p_approval_id;

    if not found then
      raise exception 'Approval request not found';
    end if;

    if v_approval_row.status <> 'approved' then
      raise exception 'Approval request is not approved';
    end if;

    if v_approval_row.requested_by <> v_uid and v_role <> 'owner' then
      raise exception 'Cannot use another user''s approval';
    end if;

    select coalesce(jsonb_object_agg(elem->>'product_id', 'true'::jsonb), '{}'::jsonb)
    into v_approved_map
    from jsonb_array_elements(v_approval_row.payload->'lines') elem
    where coalesce((elem->>'needs_approval')::boolean, false) = true;
  end if;

  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'Order must have at least one line';
  end if;

  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    select * into v_product
    from public.shamsy_products
    where id = (v_line->>'product_id')::uuid and active;

    if not found then
      raise exception 'Invalid product %', v_line->>'product_id';
    end if;

    v_qty := (v_line->>'quantity')::integer;
    if v_qty is null or v_qty <= 0 then
      raise exception 'Quantity must be positive';
    end if;

    v_discount := coalesce((v_line->>'discount_cents')::bigint, 0);
    if v_discount < 0 then
      raise exception 'Discount cannot be negative';
    end if;

    v_line_value := v_product.unit_price_cents * v_qty;
    if v_discount > v_line_value then
      raise exception 'Discount exceeds line value';
    end if;

    v_bps := public.shamsy_discount_bps(v_discount, v_line_value);
    v_band := public.shamsy_line_band(v_bps);

    if v_band = 'blocked' then
      if p_approval_id is null
         or coalesce(v_approved_map->>(v_product.id::text), 'false') <> 'true' then
        v_has_blocked := true;
      end if;
    end if;
  end loop;

  if v_has_blocked then
    raise exception 'SAVE_BLOCKED: one or more lines exceed 5%% discount without owner approval';
  end if;

  insert into public.shamsy_orders (
    customer_id, created_by, exchange_rate, total_usd_cents, total_sdg, status
  ) values (
    p_customer_id, v_uid, v_rate, 0, 0, 'saved'
  ) returning id into v_order_id;

  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    select * into v_product
    from public.shamsy_products
    where id = (v_line->>'product_id')::uuid;

    v_qty := (v_line->>'quantity')::integer;
    v_discount := coalesce((v_line->>'discount_cents')::bigint, 0);
    v_line_value := v_product.unit_price_cents * v_qty;
    v_line_total := v_line_value - v_discount;
    v_bps := public.shamsy_discount_bps(v_discount, v_line_value);
    v_band := public.shamsy_line_band(v_bps);

    if v_band = 'blocked' then
      v_approval := 'approved';
    else
      v_approval := 'none';
    end if;

    insert into public.shamsy_order_lines (
      order_id, product_id, quantity, unit_price_cents, discount_cents,
      line_value_cents, line_total_cents, discount_bps, approval,
      approved_by, approved_at
    ) values (
      v_order_id, v_product.id, v_qty, v_product.unit_price_cents, v_discount,
      v_line_value, v_line_total, v_bps, v_approval,
      case when v_approval = 'approved' then coalesce(v_approval_row.reviewed_by, v_uid) else null end,
      case when v_approval = 'approved' then coalesce(v_approval_row.reviewed_at, now()) else null end
    );

    v_total_usd := v_total_usd + v_line_total;
  end loop;

  v_total_sdg := public.shamsy_usd_cents_to_sdg(v_total_usd, v_rate);

  update public.shamsy_orders
  set total_usd_cents = v_total_usd,
      total_sdg = v_total_sdg
  where id = v_order_id;

  if p_approval_id is not null then
    update public.shamsy_discount_approvals
    set status = 'consumed'
    where id = p_approval_id;
  end if;

  return v_order_id;
end;
$$;

revoke all on function public.shamsy_create_order(uuid, integer, jsonb, uuid) from public;
grant execute on function public.shamsy_create_order(uuid, integer, jsonb, uuid) to authenticated;

create or replace function public.shamsy_set_min_exchange_rate(p_rate integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.shamsy_is_owner() then
    raise exception 'Only owner can change minimum exchange rate';
  end if;
  if p_rate <= 0 then
    raise exception 'Rate must be positive';
  end if;
  update public.shamsy_app_settings
  set value = to_jsonb(p_rate),
      updated_at = now(),
      updated_by = auth.uid()
  where key = 'min_exchange_rate';
end;
$$;

revoke all on function public.shamsy_set_min_exchange_rate(integer) from public;
grant execute on function public.shamsy_set_min_exchange_rate(integer) to authenticated;
