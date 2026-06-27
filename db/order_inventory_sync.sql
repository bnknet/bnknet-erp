-- 주문 ↔ 재고 3중 정합성 (주문변환 시 자동 출고 + 취소/복구)
-- Supabase SQL Editor에서 1회 실행. (이 코드가 배포되기 "전에" 먼저 실행해야 함 —
--  orders.company 컬럼이 없으면 주문 저장이 실패함)
--
-- 설계 요약:
--  · 주문 저장 시 company(사업자) 함께 저장 → (상품명 + 사업자)로 재고 정확히 매칭해 자동 출고
--  · 출고/취소/복구는 RPC(트랜잭션)로 처리 → "반쪽 반영" 불가 (모두 성공 or 모두 롤백)
--  · 각 주문에 stock_deducted(현재 차감상태) + deducted_inventory_id/qty 기록
--    → 취소·복구·재취소를 몇 번 반복해도 이중 차감/복구가 구조적으로 불가능
--  · inventory_logs 에 order_id/company + 구분 '주문출고'/'취소' 누적 → 이력 추적

-- ── 1) 컬럼 추가 (이미 있으면 무시) ─────────────────────────────
alter table public.orders add column if not exists company text;
alter table public.orders add column if not exists stock_deducted boolean not null default false;
alter table public.orders add column if not exists deducted_inventory_id uuid;
alter table public.orders add column if not exists deducted_qty integer;

alter table public.inventory_logs add column if not exists order_id uuid;
alter table public.inventory_logs add column if not exists company text;

create index if not exists inventory_logs_order_idx on public.inventory_logs (order_id);

-- ── 2) 자동 출고 RPC ───────────────────────────────────────────
-- p_moves = [{order_id, inventory_id, quantity, product_name, company, created_by}, ...]
-- 클라이언트가 (상품명+사업자)로 재고를 미리 매칭해 넘김. 못 찾은 건은 애초에 안 넘어옴(경고 처리).
create or replace function public.ship_orders(p_moves jsonb)
returns jsonb
language plpgsql
security definer
as $$
declare
  m jsonb;
  v_order_id uuid;
  v_inv_id uuid;
  v_qty integer;
  v_pname text;
  v_company text;
  v_by text;
  v_already boolean;
  v_before integer;
  v_after integer;
  v_shipped integer := 0;
  v_skipped integer := 0;
  v_negative jsonb := '[]'::jsonb;
begin
  for m in select * from jsonb_array_elements(p_moves)
  loop
    v_order_id := (m->>'order_id')::uuid;
    v_inv_id   := (m->>'inventory_id')::uuid;
    v_qty      := coalesce((m->>'quantity')::integer, 0);
    v_pname    := m->>'product_name';
    v_company  := m->>'company';
    v_by       := coalesce(m->>'created_by', '');

    -- 주문 잠금 + 이미 차감됐으면 skip (이중 차감 방지)
    select stock_deducted into v_already from public.orders where id = v_order_id for update;
    if not found then v_skipped := v_skipped + 1; continue; end if;
    if coalesce(v_already, false) then v_skipped := v_skipped + 1; continue; end if;

    -- 재고 잠금
    select quantity into v_before from public.inventory where id = v_inv_id for update;
    if not found then v_skipped := v_skipped + 1; continue; end if;

    v_after := v_before - v_qty;
    update public.inventory set quantity = v_after, updated_at = now() where id = v_inv_id;

    insert into public.inventory_logs
      (inventory_id, order_id, product_name, company, type, quantity, before_qty, after_qty, reason, created_by)
    values
      (v_inv_id, v_order_id, v_pname, v_company, '주문출고', v_qty, v_before, v_after, '주문변환 자동출고', v_by);

    update public.orders
       set stock_deducted = true, deducted_inventory_id = v_inv_id, deducted_qty = v_qty
     where id = v_order_id;

    v_shipped := v_shipped + 1;
    if v_after < 0 then
      v_negative := v_negative || jsonb_build_object('product_name', v_pname, 'company', v_company, 'after', v_after);
    end if;
  end loop;

  return jsonb_build_object('shipped', v_shipped, 'skipped', v_skipped, 'negative', v_negative);
end;
$$;

-- ── 3) 취소 RPC (주문 취소 + 재고 복구, 한 트랜잭션) ─────────────
create or replace function public.cancel_orders(p_order_ids uuid[], p_reason text, p_by text)
returns jsonb
language plpgsql
security definer
as $$
declare
  oid uuid;
  v_canceled boolean;
  v_deducted boolean;
  v_inv_id uuid;
  v_qty integer;
  v_pname text;
  v_company text;
  v_before integer;
  v_after integer;
  v_canceled_count integer := 0;
  v_restored integer := 0;
begin
  foreach oid in array p_order_ids
  loop
    select canceled, stock_deducted, deducted_inventory_id, deducted_qty
      into v_canceled, v_deducted, v_inv_id, v_qty
      from public.orders where id = oid for update;
    if not found then continue; end if;
    if coalesce(v_canceled, false) then continue; end if; -- 이미 취소 → 이중 복구 방지

    update public.orders set canceled = true, canceled_at = now(), canceled_by = p_by where id = oid;
    v_canceled_count := v_canceled_count + 1;

    -- 차감돼 있던 재고만 정확히 복구
    if coalesce(v_deducted, false) and v_inv_id is not null then
      select quantity into v_before from public.inventory where id = v_inv_id for update;
      if found then
        v_after := v_before + coalesce(v_qty, 0);
        update public.inventory set quantity = v_after, updated_at = now() where id = v_inv_id;
        select product_name, company into v_pname, v_company from public.inventory where id = v_inv_id;
        insert into public.inventory_logs
          (inventory_id, order_id, product_name, company, type, quantity, before_qty, after_qty, reason, created_by)
        values
          (v_inv_id, oid, v_pname, v_company, '취소', coalesce(v_qty,0), v_before, v_after, coalesce(p_reason,'주문 취소'), p_by);
        update public.orders set stock_deducted = false where id = oid;
        v_restored := v_restored + 1;
      end if;
    end if;
  end loop;
  return jsonb_build_object('canceled', v_canceled_count, 'restored', v_restored);
end;
$$;

-- ── 4) 취소 해제 RPC (정상 복귀 + 재고 재차감) ──────────────────
create or replace function public.uncancel_orders(p_order_ids uuid[], p_by text)
returns jsonb
language plpgsql
security definer
as $$
declare
  oid uuid;
  v_canceled boolean;
  v_deducted boolean;
  v_inv_id uuid;
  v_qty integer;
  v_pname text;
  v_company text;
  v_before integer;
  v_after integer;
  v_uncanceled integer := 0;
  v_rededucted integer := 0;
begin
  foreach oid in array p_order_ids
  loop
    select canceled, stock_deducted, deducted_inventory_id, deducted_qty
      into v_canceled, v_deducted, v_inv_id, v_qty
      from public.orders where id = oid for update;
    if not found then continue; end if;
    if not coalesce(v_canceled, false) then continue; end if; -- 이미 정상

    update public.orders set canceled = false, canceled_at = null, canceled_by = null where id = oid;
    v_uncanceled := v_uncanceled + 1;

    -- 취소 때 복구했던 재고를 다시 차감 (차감 상태가 아닐 때만)
    if not coalesce(v_deducted, false) and v_inv_id is not null then
      select quantity into v_before from public.inventory where id = v_inv_id for update;
      if found then
        v_after := v_before - coalesce(v_qty, 0);
        update public.inventory set quantity = v_after, updated_at = now() where id = v_inv_id;
        select product_name, company into v_pname, v_company from public.inventory where id = v_inv_id;
        insert into public.inventory_logs
          (inventory_id, order_id, product_name, company, type, quantity, before_qty, after_qty, reason, created_by)
        values
          (v_inv_id, oid, v_pname, v_company, '주문출고', coalesce(v_qty,0), v_before, v_after, '취소 해제 재출고', p_by);
        update public.orders set stock_deducted = true where id = oid;
        v_rededucted := v_rededucted + 1;
      end if;
    end if;
  end loop;
  return jsonb_build_object('uncanceled', v_uncanceled, 'rededucted', v_rededucted);
end;
$$;

-- ── 5) anon 실행 권한 (현재 베타 정책과 동일) ───────────────────
grant execute on function public.ship_orders(jsonb) to anon;
grant execute on function public.cancel_orders(uuid[], text, text) to anon;
grant execute on function public.uncancel_orders(uuid[], text) to anon;

-- PostgREST 스키마 캐시 새로고침
notify pgrst, 'reload schema';
