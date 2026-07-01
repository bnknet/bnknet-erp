-- 🔧 orders.id 는 bigint 인데 RPC들이 uuid로 변환해 깨지던 문제 수정 (2026-07-01)
-- inventory.id = uuid (유지), orders.id = bigint (여기에 맞춤).
-- 데이터는 안 건드리고 함수 + inventory_logs.order_id 타입만 수정.
-- Supabase SQL Editor에서 1회 실행.

-- ── 1) inventory_logs.order_id: uuid → bigint (성공 이력 없어 비어있음) ──
drop index if exists inventory_logs_order_idx;
alter table public.inventory_logs drop column if exists order_id;
alter table public.inventory_logs add column order_id bigint;
create index if not exists inventory_logs_order_idx on public.inventory_logs (order_id);

-- ── 2) 자동 출고 RPC (order_id bigint) ──
drop function if exists public.ship_orders(jsonb);
create or replace function public.ship_orders(p_moves jsonb)
returns jsonb language plpgsql security definer as $$
declare
  m jsonb; v_order_id bigint; v_inv_id uuid; v_qty integer; v_pname text; v_company text; v_by text;
  v_already boolean; v_before integer; v_after integer;
  v_shipped integer := 0; v_skipped integer := 0; v_negative jsonb := '[]'::jsonb;
begin
  for m in select * from jsonb_array_elements(p_moves) loop
    v_order_id := (m->>'order_id')::bigint;
    v_inv_id   := (m->>'inventory_id')::uuid;
    v_qty      := coalesce((m->>'quantity')::integer, 0);
    v_pname    := m->>'product_name';
    v_company  := m->>'company';
    v_by       := coalesce(m->>'created_by', '');

    select stock_deducted into v_already from public.orders where id = v_order_id for update;
    if not found then v_skipped := v_skipped + 1; continue; end if;
    if coalesce(v_already, false) then v_skipped := v_skipped + 1; continue; end if;

    select quantity into v_before from public.inventory where id = v_inv_id for update;
    if not found then v_skipped := v_skipped + 1; continue; end if;

    v_after := v_before - v_qty;
    update public.inventory set quantity = v_after, updated_at = now() where id = v_inv_id;
    insert into public.inventory_logs
      (inventory_id, order_id, product_name, company, type, quantity, before_qty, after_qty, reason, created_by)
    values
      (v_inv_id, v_order_id, v_pname, v_company, '주문출고', v_qty, v_before, v_after, '주문변환 자동출고', v_by);
    update public.orders set stock_deducted = true, deducted_inventory_id = v_inv_id, deducted_qty = v_qty where id = v_order_id;

    v_shipped := v_shipped + 1;
    if v_after < 0 then
      v_negative := v_negative || jsonb_build_object('product_name', v_pname, 'company', v_company, 'after', v_after);
    end if;
  end loop;
  return jsonb_build_object('shipped', v_shipped, 'skipped', v_skipped, 'negative', v_negative);
end $$;

-- ── 3) 취소 RPC (p_order_ids bigint[]) ──
drop function if exists public.cancel_orders(uuid[], text, text);
drop function if exists public.cancel_orders(bigint[], text, text);
create or replace function public.cancel_orders(p_order_ids bigint[], p_reason text, p_by text)
returns jsonb language plpgsql security definer as $$
declare
  oid bigint; v_canceled boolean; v_deducted boolean; v_inv_id uuid; v_qty integer;
  v_pname text; v_company text; v_before integer; v_after integer;
  v_canceled_count integer := 0; v_restored integer := 0;
begin
  foreach oid in array p_order_ids loop
    select canceled, stock_deducted, deducted_inventory_id, deducted_qty
      into v_canceled, v_deducted, v_inv_id, v_qty from public.orders where id = oid for update;
    if not found then continue; end if;
    if coalesce(v_canceled, false) then continue; end if;
    update public.orders set canceled = true, canceled_at = now(), canceled_by = p_by where id = oid;
    v_canceled_count := v_canceled_count + 1;
    if coalesce(v_deducted, false) and v_inv_id is not null then
      select quantity into v_before from public.inventory where id = v_inv_id for update;
      if found then
        v_after := v_before + coalesce(v_qty, 0);
        update public.inventory set quantity = v_after, updated_at = now() where id = v_inv_id;
        select product_name, company into v_pname, v_company from public.inventory where id = v_inv_id;
        insert into public.inventory_logs (inventory_id, order_id, product_name, company, type, quantity, before_qty, after_qty, reason, created_by)
          values (v_inv_id, oid, v_pname, v_company, '취소', coalesce(v_qty,0), v_before, v_after, coalesce(p_reason,'주문 취소'), p_by);
        update public.orders set stock_deducted = false where id = oid;
        v_restored := v_restored + 1;
      end if;
    end if;
  end loop;
  return jsonb_build_object('canceled', v_canceled_count, 'restored', v_restored);
end $$;

-- ── 4) 취소 해제 RPC (p_order_ids bigint[]) ──
drop function if exists public.uncancel_orders(uuid[], text);
drop function if exists public.uncancel_orders(bigint[], text);
create or replace function public.uncancel_orders(p_order_ids bigint[], p_by text)
returns jsonb language plpgsql security definer as $$
declare
  oid bigint; v_canceled boolean; v_deducted boolean; v_inv_id uuid; v_qty integer;
  v_pname text; v_company text; v_before integer; v_after integer;
  v_uncanceled integer := 0; v_rededucted integer := 0;
begin
  foreach oid in array p_order_ids loop
    select canceled, stock_deducted, deducted_inventory_id, deducted_qty
      into v_canceled, v_deducted, v_inv_id, v_qty from public.orders where id = oid for update;
    if not found then continue; end if;
    if not coalesce(v_canceled, false) then continue; end if;
    update public.orders set canceled = false, canceled_at = null, canceled_by = null where id = oid;
    v_uncanceled := v_uncanceled + 1;
    if not coalesce(v_deducted, false) and v_inv_id is not null then
      select quantity into v_before from public.inventory where id = v_inv_id for update;
      if found then
        v_after := v_before - coalesce(v_qty, 0);
        update public.inventory set quantity = v_after, updated_at = now() where id = v_inv_id;
        select product_name, company into v_pname, v_company from public.inventory where id = v_inv_id;
        insert into public.inventory_logs (inventory_id, order_id, product_name, company, type, quantity, before_qty, after_qty, reason, created_by)
          values (v_inv_id, oid, v_pname, v_company, '주문출고', coalesce(v_qty,0), v_before, v_after, '취소 해제 재출고', p_by);
        update public.orders set stock_deducted = true where id = oid;
        v_rededucted := v_rededucted + 1;
      end if;
    end if;
  end loop;
  return jsonb_build_object('uncanceled', v_uncanceled, 'rededucted', v_rededucted);
end $$;

-- ── 5) 부분취소 RPC (p_order_id bigint) ──
drop function if exists public.partial_cancel_order(uuid, integer, text, text, text);
drop function if exists public.partial_cancel_order(bigint, integer, text, text, text);
create or replace function public.partial_cancel_order(
  p_order_id bigint, p_cancel_qty integer, p_reason text, p_type text, p_by text
) returns jsonb language plpgsql security definer as $$
declare
  v_canceled boolean; v_deducted boolean; v_inv_id uuid;
  v_qty integer; v_amount numeric; v_ded_qty integer;
  v_unit numeric; v_new_qty integer; v_new_amount numeric;
  v_before integer; v_after integer; v_pname text; v_company text;
  v_restored integer := 0; v_type text := coalesce(nullif(p_type,''), '취소');
begin
  select canceled, stock_deducted, deducted_inventory_id, deducted_qty, quantity, amount
    into v_canceled, v_deducted, v_inv_id, v_ded_qty, v_qty, v_amount
    from public.orders where id = p_order_id for update;
  if not found then return jsonb_build_object('error', '주문 없음'); end if;
  if coalesce(v_canceled, false) then return jsonb_build_object('error', '이미 취소된 주문'); end if;
  if p_cancel_qty is null or p_cancel_qty < 1 then return jsonb_build_object('error', '취소 수량 오류'); end if;

  if p_cancel_qty >= coalesce(v_qty, 0) then
    perform public.cancel_orders(array[p_order_id]::bigint[], v_type || ': ' || coalesce(p_reason, ''), p_by);
    update public.orders set cancel_type = v_type where id = p_order_id;
    return jsonb_build_object('full_canceled', true);
  end if;

  v_unit := case when coalesce(v_qty, 0) > 0 then v_amount / v_qty else 0 end;
  v_new_qty := v_qty - p_cancel_qty;
  v_new_amount := round(coalesce(v_amount,0) - v_unit * p_cancel_qty);

  update public.orders
     set quantity = v_new_qty, amount = v_new_amount,
         deducted_qty = case when coalesce(v_deducted,false) then greatest(coalesce(v_ded_qty,0) - p_cancel_qty, 0) else v_ded_qty end,
         canceled_qty = coalesce(canceled_qty, 0) + p_cancel_qty, cancel_type = v_type, updated_at = now()
   where id = p_order_id;

  if coalesce(v_deducted, false) and v_inv_id is not null then
    select quantity into v_before from public.inventory where id = v_inv_id for update;
    if found then
      v_after := v_before + p_cancel_qty;
      update public.inventory set quantity = v_after, updated_at = now() where id = v_inv_id;
      select product_name, company into v_pname, v_company from public.inventory where id = v_inv_id;
      insert into public.inventory_logs (inventory_id, order_id, product_name, company, type, quantity, before_qty, after_qty, reason, created_by)
        values (v_inv_id, p_order_id, v_pname, v_company, '취소', p_cancel_qty, v_before, v_after, v_type || '(부분) ' || coalesce(p_reason, ''), p_by);
      v_restored := 1;
    end if;
  end if;
  return jsonb_build_object('partial_canceled', true, 'type', v_type, 'cancel_qty', p_cancel_qty, 'new_qty', v_new_qty, 'restored', v_restored);
end $$;

-- ── 6) anon 실행권한 재부여 ──
grant execute on function public.ship_orders(jsonb) to anon;
grant execute on function public.cancel_orders(bigint[], text, text) to anon;
grant execute on function public.uncancel_orders(bigint[], text) to anon;
grant execute on function public.partial_cancel_order(bigint, integer, text, text, text) to anon;

notify pgrst, 'reload schema';
