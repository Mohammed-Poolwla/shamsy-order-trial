-- Harden the >5% discount control so it cannot be bypassed through PostgREST.
-- All legitimate writes go through security definer RPCs, so direct table
-- writes are denied and table-level constraints/triggers back up the RPCs.

-- 1. Orders: no direct updates (drafts were PATCHable to status = 'saved').
drop policy if exists "shamsy_orders_owner_or_creator_update_draft" on public.shamsy_orders;
drop policy if exists "shamsy_orders_no_update" on public.shamsy_orders;
create policy "shamsy_orders_no_update"
  on public.shamsy_orders for update
  to authenticated
  using (false)
  with check (false);

-- 2. Order lines: no direct updates or deletes; approve/reject/revise RPCs only.
drop policy if exists "shamsy_order_lines_owner_update" on public.shamsy_order_lines;
drop policy if exists "shamsy_order_lines_no_update" on public.shamsy_order_lines;
create policy "shamsy_order_lines_no_update"
  on public.shamsy_order_lines for update
  to authenticated
  using (false)
  with check (false);

drop policy if exists "shamsy_order_lines_no_delete" on public.shamsy_order_lines;
create policy "shamsy_order_lines_no_delete"
  on public.shamsy_order_lines for delete
  to authenticated
  using (false);

-- 3. Approval requests: requesters can only create pending, unreviewed rows.
drop policy if exists "shamsy_approvals_insert" on public.shamsy_discount_approvals;
create policy "shamsy_approvals_insert"
  on public.shamsy_discount_approvals for insert
  to authenticated
  with check (
    requested_by = auth.uid()
    and public.shamsy_current_role() in ('adviser', 'owner')
    and status = 'pending'
    and reviewed_by is null
    and reviewed_at is null
  );

-- 4. Line constraints: stored bps must match the money, and any line over 5%
--    must carry an approval state.
alter table public.shamsy_order_lines
  drop constraint if exists shamsy_line_bps_matches;
alter table public.shamsy_order_lines
  add constraint shamsy_line_bps_matches check (
    discount_bps = public.shamsy_discount_bps(discount_cents, line_value_cents)
  );

alter table public.shamsy_order_lines
  drop constraint if exists shamsy_line_over_5pct_needs_approval;
alter table public.shamsy_order_lines
  add constraint shamsy_line_over_5pct_needs_approval check (
    discount_bps <= 500 or approval <> 'none'
  );

alter table public.shamsy_order_lines
  drop constraint if exists shamsy_line_approved_has_reviewer;
alter table public.shamsy_order_lines
  add constraint shamsy_line_approved_has_reviewer check (
    approval <> 'approved' or (approved_by is not null and approved_at is not null)
  );

-- 5. Triggers: a saved order can never contain an unapproved >5% line,
--    regardless of which path (RPC, policy change, future code) writes it.
create or replace function public.shamsy_guard_order_status()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.status = 'saved' and new.status <> 'saved' then
    raise exception 'Saved orders cannot be reverted'
      using errcode = '42501';
  end if;

  if new.status = 'saved' and old.status <> 'saved' and exists (
    select 1 from public.shamsy_order_lines l
    where l.order_id = new.id
      and l.approval in ('required', 'rejected')
  ) then
    raise exception 'SAVE_BLOCKED: order has lines that still need owner approval'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists shamsy_guard_order_status on public.shamsy_orders;
create trigger shamsy_guard_order_status
  before update of status on public.shamsy_orders
  for each row execute function public.shamsy_guard_order_status();

create or replace function public.shamsy_guard_line_write()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_status public.shamsy_order_status;
begin
  select status into v_status
  from public.shamsy_orders
  where id = new.order_id;

  if v_status = 'saved' then
    if tg_op = 'UPDATE' then
      raise exception 'Lines on a saved order are locked'
        using errcode = '42501';
    end if;
    if new.approval in ('required', 'rejected') then
      raise exception 'SAVE_BLOCKED: saved orders cannot contain unapproved >5%% lines'
        using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists shamsy_guard_line_write on public.shamsy_order_lines;
create trigger shamsy_guard_line_write
  before insert or update on public.shamsy_order_lines
  for each row execute function public.shamsy_guard_line_write();
