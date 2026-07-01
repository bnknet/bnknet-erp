-- 도매 주문 수정 (2026-07-01)
-- 도매 주문의 상품/수량/매출/원가/배송비를 수정하면 재고·매출에 자동 반영.
-- 재고는 원자적으로: 기존 차감분 복구 → 새 내용으로 재차감.
-- 변경 이력(order_change_logs)에 누가·무엇을·어떻게 바꿨는지 기록.
-- Supabase SQL Editor에서 1회 실행 (RLS 경고 시 'Run without RLS').

-- ── 1) 주문 변경 로그 ──
create table if not exists public.order_change_logs (
  id uuid primary key default gen_random_uuid(),
  order_id bigint not null,
  action text not null,       -- '등록' | '수정' | '삭제'
  detail text,                -- 상세(이전 → 이후)
  changed_by text,
  created_at timestamptz default now()
);
create index if not exists order_change_logs_order_idx on public.order_change_logs (order_id, created_at desc);
grant select, insert, update, delete on public.order_change_logs to anon;

-- ── 2) 도매 주문 수정 RPC (재고 복구 후 재차감 + 주문 내용 갱신) ──
drop function if exists public.update_manual_order(bigint, uuid, text, integer, numeric, numeric, numeric, text);
create or replace function public.update_manual_order(
  p_order_id bigint, p_inventory_id uuid, p_product_name text, p_qty integer,
  p_amount numeric, p_cost numeric, p_shipping numeric, p_by text
) returns jsonb language plpgsql security definer as $$
declare
  v_deducted boolean; v_old_inv uuid; v_old_qty integer; v_before integer; v_after integer;
  v_old_pname text; v_old_company text; v_company text;
begin
  select stock_deducted, deducted_inventory_id, deducted_qty
    into v_deducted, v_old_inv, v_old_qty
    from public.orders where id = p_order_id for update;
  if not found then return jsonb_build_object('error','주문 없음'); end if;

  -- 1) 기존 차감분 복구
  if coalesce(v_deducted,false) and v_old_inv is not null then
    select quantity into v_before from public.inventory where id = v_old_inv for update;
    if found then
      v_after := v_before + coalesce(v_old_qty,0);
      update public.inventory set quantity = v_after, updated_at = now() where id = v_old_inv;
      select product_name, company into v_old_pname, v_old_company from public.inventory where id = v_old_inv;
      insert into public.inventory_logs (inventory_id, order_id, product_name, company, type, quantity, before_qty, after_qty, reason, created_by)
        values (v_old_inv, p_order_id, v_old_pname, v_old_company, '취소', coalesce(v_old_qty,0), v_before, v_after, '도매 수정 전 복구', p_by);
    end if;
  end if;

  -- 2) 새 내용으로 재차감
  if p_inventory_id is not null then
    select quantity, company into v_before, v_company from public.inventory where id = p_inventory_id for update;
    if found then
      v_after := v_before - coalesce(p_qty,0);
      update public.inventory set quantity = v_after, updated_at = now() where id = p_inventory_id;
      insert into public.inventory_logs (inventory_id, order_id, product_name, company, type, quantity, before_qty, after_qty, reason, created_by)
        values (p_inventory_id, p_order_id, p_product_name, v_company, '주문출고', coalesce(p_qty,0), v_before, v_after, '도매 수정 재출고', p_by);
      update public.orders set stock_deducted = true, deducted_inventory_id = p_inventory_id, deducted_qty = p_qty where id = p_order_id;
    else
      update public.orders set stock_deducted = false, deducted_inventory_id = null, deducted_qty = null where id = p_order_id;
    end if;
  else
    update public.orders set stock_deducted = false, deducted_inventory_id = null, deducted_qty = null where id = p_order_id;
  end if;

  -- 3) 주문 내용 갱신 (매출·원가·배송비는 매출현황이 실시간 재집계)
  update public.orders set
    product_name = p_product_name, collect_product = p_product_name,
    quantity = p_qty, amount = p_amount, manual_cost = p_cost, manual_shipping = p_shipping, updated_at = now()
  where id = p_order_id;

  return jsonb_build_object('ok', true);
end $$;
grant execute on function public.update_manual_order(bigint, uuid, text, integer, numeric, numeric, numeric, text) to anon;

notify pgrst, 'reload schema';
