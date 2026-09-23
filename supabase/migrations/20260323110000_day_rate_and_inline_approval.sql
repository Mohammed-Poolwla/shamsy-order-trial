-- Additive: day's rate setter + create_order accepts owner-approved product ids

create or replace function public.shamsy_set_day_exchange_rate(p_rate integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_min integer;
begin
  if not public.shamsy_is_owner() then
    raise exception 'Only owner can change the day''s exchange rate';
  end if;
  if p_rate <= 0 then
    raise exception 'Rate must be positive';
  end if;

  select (value #>> '{}')::integer into v_min
  from public.shamsy_app_settings where key = 'min_exchange_rate';
  if v_min is null then
    v_min := 8000;
  end if;
  if p_rate < v_min then
    raise exception 'Day rate % cannot be below minimum %', p_rate, v_min;
  end if;

  insert into public.shamsy_app_settings (key, value, updated_at, updated_by)
  values ('default_exchange_rate', to_jsonb(p_rate), now(), auth.uid())
  on conflict (key) do update
    set value = excluded.value,
        updated_at = now(),
        updated_by = auth.uid();
end;
$$;

revoke all on function public.shamsy_set_day_exchange_rate(integer) from public;
grant execute on function public.shamsy_set_day_exchange_rate(integer) to authenticated;

-- Drop prior 4-arg overload if present, replace with 5-arg version
drop function if exists public.shamsy_create_order(uuid, integer, jsonb, uuid);

create or replace function public.shamsy_create_order(
  p_customer_id uuid,
  p_exchange_rate integer,
  p_lines jsonb,
  p_approval_id uuid default null,
  p_owner_approved_product_ids uuid[] default null
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

  -- Owner may approve blocked product lines inline at save time
  if v_role = 'owner'
     and p_owner_approved_product_ids is not null
     and cardinality(p_owner_approved_product_ids) > 0 then
    select coalesce(jsonb_object_agg(pid::text, 'true'::jsonb), '{}'::jsonb)
    into v_approved_map
    from unnest(p_owner_approved_product_ids) as pid;
  elsif p_owner_approved_product_ids is not null
        and cardinality(p_owner_approved_product_ids) > 0
        and v_role <> 'owner' then
    raise exception 'Only owner can pass inline line approvals';
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

    select coalesce(v_approved_map, '{}'::jsonb) || coalesce(
      (
        select jsonb_object_agg(elem->>'product_id', 'true'::jsonb)
        from jsonb_array_elements(v_approval_row.payload->'lines') elem
        where coalesce((elem->>'needs_approval')::boolean, false) = true
          and coalesce((elem->>'line_approved')::boolean, true) = true
      ),
      '{}'::jsonb
    )
    into v_approved_map;
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
      if coalesce(v_approved_map->>(v_product.id::text), 'false') <> 'true' then
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

revoke all on function public.shamsy_create_order(uuid, integer, jsonb, uuid, uuid[]) from public;
grant execute on function public.shamsy_create_order(uuid, integer, jsonb, uuid, uuid[]) to authenticated;
