-- Owner reject + adviser revise/resubmit for >5% draft lines

create or replace function public.shamsy_reject_draft_line(
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
    raise exception 'Only owner can reject discount lines';
  end if;

  select * into v_order from public.shamsy_orders where id = p_order_id;
  if not found then
    raise exception 'Order not found';
  end if;
  if v_order.status <> 'draft' then
    raise exception 'Only draft orders can have lines rejected';
  end if;

  update public.shamsy_order_lines
  set approval = 'rejected',
      approved_by = null,
      approved_at = null
  where id = p_line_id
    and order_id = p_order_id
    and approval = 'required';

  if not found then
    raise exception 'Line not found or does not need approval';
  end if;
end;
$$;

revoke all on function public.shamsy_reject_draft_line(uuid, uuid) from public;
grant execute on function public.shamsy_reject_draft_line(uuid, uuid) to authenticated;

-- Adviser (creator) or owner: change discount on a rejected line and
-- send it back for approval (or clear approval if now ≤5%).
create or replace function public.shamsy_revise_draft_line(
  p_order_id uuid,
  p_line_id uuid,
  p_discount_cents bigint
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_order public.shamsy_orders%rowtype;
  v_line public.shamsy_order_lines%rowtype;
  v_discount bigint;
  v_line_total bigint;
  v_bps integer;
  v_band text;
  v_approval public.shamsy_line_approval;
  v_total_usd bigint;
  v_total_sdg bigint;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  select * into v_order from public.shamsy_orders where id = p_order_id;
  if not found then
    raise exception 'Order not found';
  end if;
  if v_order.status <> 'draft' then
    raise exception 'Only draft orders can be revised';
  end if;
  if v_order.created_by <> v_uid and not public.shamsy_is_owner() then
    raise exception 'Not allowed to revise this draft';
  end if;

  select * into v_line
  from public.shamsy_order_lines
  where id = p_line_id and order_id = p_order_id;
  if not found then
    raise exception 'Line not found';
  end if;
  if v_line.approval <> 'rejected' then
    raise exception 'Only rejected lines can be revised';
  end if;

  v_discount := coalesce(p_discount_cents, 0);
  if v_discount < 0 then
    raise exception 'Discount cannot be negative';
  end if;
  if v_discount > v_line.line_value_cents then
    raise exception 'Discount exceeds line value';
  end if;

  v_line_total := v_line.line_value_cents - v_discount;
  v_bps := public.shamsy_discount_bps(v_discount, v_line.line_value_cents);
  v_band := public.shamsy_line_band(v_bps);

  if v_band = 'blocked' then
    v_approval := 'required';
  else
    v_approval := 'none';
  end if;

  update public.shamsy_order_lines
  set discount_cents = v_discount,
      line_total_cents = v_line_total,
      discount_bps = v_bps,
      approval = v_approval,
      approved_by = null,
      approved_at = null
  where id = p_line_id;

  select coalesce(sum(line_total_cents), 0) into v_total_usd
  from public.shamsy_order_lines
  where order_id = p_order_id;

  v_total_sdg := public.shamsy_usd_cents_to_sdg(v_total_usd, v_order.exchange_rate);

  update public.shamsy_orders
  set total_usd_cents = v_total_usd,
      total_sdg = v_total_sdg
  where id = p_order_id;
end;
$$;

revoke all on function public.shamsy_revise_draft_line(uuid, uuid, bigint) from public;
grant execute on function public.shamsy_revise_draft_line(uuid, uuid, bigint) to authenticated;

-- Finalize must also refuse rejected lines (adviser must revise first)
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
  where order_id = p_order_id
    and approval in ('required', 'rejected');

  if v_blocked > 0 then
    raise exception 'SAVE_BLOCKED: % line(s) still need owner approval or revision', v_blocked;
  end if;

  update public.shamsy_orders
  set status = 'saved'
  where id = p_order_id;

  return p_order_id;
end;
$$;
