-- 부분취소(취소수량) + 반품 구분 — Supabase SQL Editor에서 1회 실행
-- 선행: db/order_inventory_sync.sql 실행 완료(취소/복구 RPC, stock_deducted 등)

-- 1) 컬럼 추가
alter table public.orders add column if not exists canceled_qty integer not null default 0; -- 누적 부분취소 수량
alter table public.orders add column if not exists cancel_type text;                        -- 마지막 취소 유형(취소/반품) 참고용

-- 2) 부분취소 RPC (수량 일부 취소/반품 + 금액 비례 차감 + 재고 복구, 한 트랜잭션)
--    취소수량 >= 현재수량 이면 전체취소(cancel_orders)로 위임.
create or replace function public.partial_cancel_order(
  p_order_id uuid, p_cancel_qty integer, p_reason text, p_type text, p_by text
)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_canceled boolean; v_deducted boolean; v_inv_id uuid;
  v_qty integer; v_amount numeric; v_ded_qty integer;
  v_unit numeric; v_new_qty integer; v_new_amount numeric;
  v_before integer; v_after integer; v_pname text; v_company text;
  v_restored integer := 0;
  v_type text := coalesce(nullif(p_type,''), '취소');
begin
  select canceled, stock_deducted, deducted_inventory_id, deducted_qty, quantity, amount
    into v_canceled, v_deducted, v_inv_id, v_ded_qty, v_qty, v_amount
    from public.orders where id = p_order_id for update;
  if not found then return jsonb_build_object('error', '주문 없음'); end if;
  if coalesce(v_canceled, false) then return jsonb_build_object('error', '이미 취소된 주문'); end if;
  if p_cancel_qty is null or p_cancel_qty < 1 then return jsonb_build_object('error', '취소 수량 오류'); end if;

  -- 전체 수량 이상 → 전체취소로 위임
  if p_cancel_qty >= coalesce(v_qty, 0) then
    perform public.cancel_orders(array[p_order_id], v_type || ': ' || coalesce(p_reason, ''), p_by);
    update public.orders set cancel_type = v_type where id = p_order_id;
    return jsonb_build_object('full_canceled', true);
  end if;

  v_unit := case when coalesce(v_qty, 0) > 0 then v_amount / v_qty else 0 end;
  v_new_qty := v_qty - p_cancel_qty;
  v_new_amount := round(coalesce(v_amount,0) - v_unit * p_cancel_qty);

  update public.orders
     set quantity = v_new_qty,
         amount = v_new_amount,
         deducted_qty = case when coalesce(v_deducted,false) then greatest(coalesce(v_ded_qty,0) - p_cancel_qty, 0) else v_ded_qty end,
         canceled_qty = coalesce(canceled_qty, 0) + p_cancel_qty,
         cancel_type = v_type,
         updated_at = now()
   where id = p_order_id;

  -- 차감돼 있던 재고만 부분 복구
  if coalesce(v_deducted, false) and v_inv_id is not null then
    select quantity into v_before from public.inventory where id = v_inv_id for update;
    if found then
      v_after := v_before + p_cancel_qty;
      update public.inventory set quantity = v_after, updated_at = now() where id = v_inv_id;
      select product_name, company into v_pname, v_company from public.inventory where id = v_inv_id;
      insert into public.inventory_logs
        (inventory_id, order_id, product_name, company, type, quantity, before_qty, after_qty, reason, created_by)
      values
        (v_inv_id, p_order_id, v_pname, v_company, '취소', p_cancel_qty, v_before, v_after,
         v_type || '(부분) ' || coalesce(p_reason, ''), p_by);
      v_restored := 1;
    end if;
  end if;

  return jsonb_build_object('partial_canceled', true, 'type', v_type, 'cancel_qty', p_cancel_qty, 'new_qty', v_new_qty, 'restored', v_restored);
end;
$$;

grant execute on function public.partial_cancel_order(uuid, integer, text, text, text) to anon;

notify pgrst, 'reload schema';
