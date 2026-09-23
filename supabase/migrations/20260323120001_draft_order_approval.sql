-- Step B: draft order RPCs (runs after enum commit)

drop policy if exists "shamsy_orders_no_update" on public.shamsy_orders;
drop policy if exists "shamsy_orders_owner_or_creator_update_draft" on public.shamsy_orders;
create policy "shamsy_orders_owner_or_creator_update_draft"
  on public.shamsy_orders for update
  to authenticated
  using (
    status = 'draft'
    and (public.shamsy_is_owner() or created_by = auth.uid())
  )
  with check (
    (public.shamsy_is_owner() or created_by = auth.uid())
  );

drop policy if exists "shamsy_order_lines_no_insert" on public.shamsy_order_lines;
drop policy if exists "shamsy_order_lines_owner_update" on public.shamsy_order_lines;
drop policy if exists "shamsy_order_lines_insert_via_visible_draft" on public.shamsy_order_lines;

create policy "shamsy_order_lines_insert_via_visible_draft"
  on public.shamsy_order_lines for insert
  to authenticated
  with check (false);

create policy "shamsy_order_lines_owner_update"
  on public.shamsy_order_lines for update
  to authenticated
  using (
    public.shamsy_is_owner()
    and exists (
      select 1 from public.shamsy_orders o
      where o.id = order_id and o.status = 'draft'
    )
  )
  with check (public.shamsy_is_owner());

create or replace function public.shamsy_create_draft_order(
  p_customer_id uuid,
  p_exchange_rate integer,
  p_lines jsonb
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
  if v_min_rate is null then v_min_rate := 8000; end if;

  v_rate := p_exchange_rate;
  if v_rate < v_min_rate then
    raise exception 'Exchange rate % is below minimum %', v_rate, v_min_rate;
  end if;

  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'Order must have at least one line';
  end if;

  insert into public.shamsy_orders (
    customer_id, created_by, exchange_rate, total_usd_cents, total_sdg, status
  ) values (
    p_customer_id, v_uid, v_rate, 0, 0, 'draft'
  ) returning id into v_order_id;

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

    v_line_total := v_line_value - v_discount;
    v_bps := public.shamsy_discount_bps(v_discount, v_line_value);
    v_band := public.shamsy_line_band(v_bps);

    if v_band = 'blocked' then
      v_approval := 'required';
    else
      v_approval := 'none';
    end if;

    insert into public.shamsy_order_lines (
      order_id, product_id, quantity, unit_price_cents, discount_cents,
      line_value_cents, line_total_cents, discount_bps, approval
    ) values (
      v_order_id, v_product.id, v_qty, v_product.unit_price_cents, v_discount,
      v_line_value, v_line_total, v_bps, v_approval
    );

    v_total_usd := v_total_usd + v_line_total;
  end loop;

  v_total_sdg := public.shamsy_usd_cents_to_sdg(v_total_usd, v_rate);
  update public.shamsy_orders
  set total_usd_cents = v_total_usd, total_sdg = v_total_sdg
  where id = v_order_id;

  return v_order_id;
end;
$$;

revoke all on function public.shamsy_create_draft_order(uuid, integer, jsonb) from public;
grant execute on function public.shamsy_create_draft_order(uuid, integer, jsonb) to authenticated;

create or replace function public.shamsy_approve_draft_line(
  p_order_id uuid,
  p_line_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.shamsy_orders%rowtype;
begin
  if not public.shamsy_is_owner() then
    raise exception 'Only owner can approve discount lines';
  end if;

  select * into v_order from public.shamsy_orders where id = p_order_id;
  if not found then
    raise exception 'Order not found';
  end if;
  if v_order.status <> 'draft' then
    raise exception 'Only draft orders can have lines approved';
  end if;

  update public.shamsy_order_lines
  set approval = 'approved',
      approved_by = auth.uid(),
      approved_at = now()
  where id = p_line_id
    and order_id = p_order_id
    and approval = 'required';

  if not found then
    raise exception 'Line not found or does not need approval';
  end if;
end;
$$;

revoke all on function public.shamsy_approve_draft_line(uuid, uuid) from public;
grant execute on function public.shamsy_approve_draft_line(uuid, uuid) to authenticated;

create or replace function public.shamsy_finalize_draft_order(p_order_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_order public.shamsy_orders%rowtype;
  v_blocked integer;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  select * into v_order from public.shamsy_orders where id = p_order_id;
  if not found then
    raise exception 'Order not found';
  end if;
  if v_order.status <> 'draft' then
    raise exception 'Order is not a draft';
  end if;
  if v_order.created_by <> v_uid and not public.shamsy_is_owner() then
    raise exception 'Not allowed to finalize this draft';
  end if;

  select count(*) into v_blocked
  from public.shamsy_order_lines
  where order_id = p_order_id and approval = 'required';

  if v_blocked > 0 then
    raise exception 'SAVE_BLOCKED: % line(s) still need owner approval', v_blocked;
  end if;

  update public.shamsy_orders
  set status = 'saved'
  where id = p_order_id;

  return p_order_id;
end;
$$;

revoke all on function public.shamsy_finalize_draft_order(uuid) from public;
grant execute on function public.shamsy_finalize_draft_order(uuid) to authenticated;
