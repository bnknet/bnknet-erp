-- 🎁 세트상품(BOM) 구성 자동 차감 (2026-07-01)
-- 세트 주문 1건 = 여러 구성품 재고를 각각 차감(주문수량 × 구성수량).
-- 기존 단일상품 로직은 그대로 두고 '세트 경로'만 추가 (회귀 위험 최소화).
-- Supabase SQL Editor에서 1회 실행.

-- ── 1) 세트 구성표 ──
create table if not exists public.product_bom (
  id uuid primary key default gen_random_uuid(),
  set_name text not null,           -- 세트 대표상품명 (matchProduct 결과와 동일)
  component_name text not null,      -- 구성품 재고 상품명 (inventory.product_name과 일치)
  component_qty integer not null default 1, -- 세트 1개당 구성품 수량
  company text,                      -- (선택) 특정 사업자 전용 구성, null=공통
  created_at timestamptz default now()
);
create index if not exists product_bom_set_idx on public.product_bom (set_name);

-- ── 2) 주문별 다중 차감 이력 (세트 전용, 취소 복구 정합성) ──
create table if not exists public.order_deductions (
  id uuid primary key default gen_random_uuid(),
  order_id bigint not null,
  inventory_id uuid not null,
  product_name text,
  qty integer not null default 0,
  created_at timestamptz default now()
);
create index if not exists order_deductions_order_idx on public.order_deductions (order_id);

-- ── 3) 자동 출고 RPC (단일 + 세트 components 지원) ──
drop function if exists public.ship_orders(jsonb);
create or replace function public.ship_orders(p_moves jsonb)
returns jsonb language plpgsql security definer as $$
declare
  m jsonb; c jsonb; v_order_id bigint; v_inv_id uuid; v_qty integer; v_pname text; v_company text; v_by text;
  v_already boolean; v_before integer; v_after integer; v_ok boolean; v_first boolean;
  v_shipped integer := 0; v_skipped integer := 0; v_negative jsonb := '[]'::jsonb;
begin
  for m in select * from jsonb_array_elements(p_moves) loop
    v_order_id := (m->>'order_id')::bigint;
    v_company  := m->>'company';
    v_by       := coalesce(m->>'created_by', '');

    select stock_deducted into v_already from public.orders where id = v_order_id for update;
    if not found then v_skipped := v_skipped + 1; continue; end if;
    if coalesce(v_already, false) then v_skipped := v_skipped + 1; continue; end if;

    -- ▶ 세트 경로: components 배열이 있으면 구성품 각각 차감 (all-or-nothing)
    if jsonb_typeof(m->'components') = 'array' and jsonb_array_length(m->'components') > 0 then
      v_ok := true;
      for c in select * from jsonb_array_elements(m->'components') loop
        if not exists (select 1 from public.inventory where id = (c->>'inventory_id')::uuid) then v_ok := false; end if;
      end loop;
      if not v_ok then v_skipped := v_skipped + 1; continue; end if; -- 구성품 재고 미등록 → 미차감(안전)

      v_first := true;
      for c in select * from jsonb_array_elements(m->'components') loop
        v_inv_id := (c->>'inventory_id')::uuid;
        v_qty    := coalesce((c->>'quantity')::integer, 0);
        v_pname  := c->>'product_name';
        select quantity into v_before from public.inventory where id = v_inv_id for update;
        v_after := v_before - v_qty;
        update public.inventory set quantity = v_after, updated_at = now() where id = v_inv_id;
        insert into public.inventory_logs
          (inventory_id, order_id, product_name, company, type, quantity, before_qty, after_qty, reason, created_by)
        values (v_inv_id, v_order_id, v_pname, v_company, '주문출고', v_qty, v_before, v_after, '세트 자동출고', v_by);
        insert into public.order_deductions (order_id, inventory_id, product_name, qty)
        values (v_order_id, v_inv_id, v_pname, v_qty);
        if v_first then
          update public.orders set deducted_inventory_id = v_inv_id, deducted_qty = v_qty where id = v_order_id;
          v_first := false;
        end if;
        if v_after < 0 then
          v_negative := v_negative || jsonb_build_object('product_name', v_pname, 'company', v_company, 'after', v_after);
        end if;
      end loop;
      update public.orders set stock_deducted = true where id = v_order_id;
      v_shipped := v_shipped + 1;
      continue;
    end if;

    -- ▶ 단일 경로 (기존 로직 그대로)
    v_inv_id := (m->>'inventory_id')::uuid;
    v_qty    := coalesce((m->>'quantity')::integer, 0);
    v_pname  := m->>'product_name';
    select quantity into v_before from public.inventory where id = v_inv_id for update;
    if not found then v_skipped := v_skipped + 1; continue; end if;
    v_after := v_before - v_qty;
    update public.inventory set quantity = v_after, updated_at = now() where id = v_inv_id;
    insert into public.inventory_logs
      (inventory_id, order_id, product_name, company, type, quantity, before_qty, after_qty, reason, created_by)
    values (v_inv_id, v_order_id, v_pname, v_company, '주문출고', v_qty, v_before, v_after, '주문변환 자동출고', v_by);
    update public.orders set stock_deducted = true, deducted_inventory_id = v_inv_id, deducted_qty = v_qty where id = v_order_id;
    v_shipped := v_shipped + 1;
    if v_after < 0 then
      v_negative := v_negative || jsonb_build_object('product_name', v_pname, 'company', v_company, 'after', v_after);
    end if;
  end loop;
  return jsonb_build_object('shipped', v_shipped, 'skipped', v_skipped, 'negative', v_negative);
end $$;

-- ── 4) 취소 RPC (세트=order_deductions 복구, 단일=기존) ──
drop function if exists public.cancel_orders(bigint[], text, text);
create or replace function public.cancel_orders(p_order_ids bigint[], p_reason text, p_by text)
returns jsonb language plpgsql security definer as $$
declare
  oid bigint; v_canceled boolean; v_deducted boolean; v_inv_id uuid; v_qty integer;
  v_pname text; v_company text; v_before integer; v_after integer; d record;
  v_canceled_count integer := 0; v_restored integer := 0;
begin
  foreach oid in array p_order_ids loop
    select canceled, stock_deducted, deducted_inventory_id, deducted_qty
      into v_canceled, v_deducted, v_inv_id, v_qty from public.orders where id = oid for update;
    if not found then continue; end if;
    if coalesce(v_canceled, false) then continue; end if;
    update public.orders set canceled = true, canceled_at = now(), canceled_by = p_by where id = oid;
    v_canceled_count := v_canceled_count + 1;
    if not coalesce(v_deducted, false) then continue; end if;

    if exists (select 1 from public.order_deductions where order_id = oid) then
      -- 세트: 구성품 각각 복구
      for d in select * from public.order_deductions where order_id = oid loop
        select quantity into v_before from public.inventory where id = d.inventory_id for update;
        if found then
          v_after := v_before + coalesce(d.qty, 0);
          update public.inventory set quantity = v_after, updated_at = now() where id = d.inventory_id;
          select company into v_company from public.inventory where id = d.inventory_id;
          insert into public.inventory_logs (inventory_id, order_id, product_name, company, type, quantity, before_qty, after_qty, reason, created_by)
            values (d.inventory_id, oid, d.product_name, v_company, '취소', coalesce(d.qty,0), v_before, v_after, coalesce(p_reason,'주문 취소(세트)'), p_by);
        end if;
      end loop;
      update public.orders set stock_deducted = false where id = oid;
      v_restored := v_restored + 1;
    elsif v_inv_id is not null then
      -- 단일 (기존)
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

-- ── 5) 취소 해제 RPC (세트=재차감, 단일=기존) ──
drop function if exists public.uncancel_orders(bigint[], text);
create or replace function public.uncancel_orders(p_order_ids bigint[], p_by text)
returns jsonb language plpgsql security definer as $$
declare
  oid bigint; v_canceled boolean; v_deducted boolean; v_inv_id uuid; v_qty integer;
  v_pname text; v_company text; v_before integer; v_after integer; d record;
  v_uncanceled integer := 0; v_rededucted integer := 0;
begin
  foreach oid in array p_order_ids loop
    select canceled, stock_deducted, deducted_inventory_id, deducted_qty
      into v_canceled, v_deducted, v_inv_id, v_qty from public.orders where id = oid for update;
    if not found then continue; end if;
    if not coalesce(v_canceled, false) then continue; end if;
    update public.orders set canceled = false, canceled_at = null, canceled_by = null where id = oid;
    v_uncanceled := v_uncanceled + 1;
    if coalesce(v_deducted, false) then continue; end if; -- 이미 차감상태면 스킵

    if exists (select 1 from public.order_deductions where order_id = oid) then
      for d in select * from public.order_deductions where order_id = oid loop
        select quantity into v_before from public.inventory where id = d.inventory_id for update;
        if found then
          v_after := v_before - coalesce(d.qty, 0);
          update public.inventory set quantity = v_after, updated_at = now() where id = d.inventory_id;
          select company into v_company from public.inventory where id = d.inventory_id;
          insert into public.inventory_logs (inventory_id, order_id, product_name, company, type, quantity, before_qty, after_qty, reason, created_by)
            values (d.inventory_id, oid, d.product_name, v_company, '주문출고', coalesce(d.qty,0), v_before, v_after, '취소 해제 재출고(세트)', p_by);
        end if;
      end loop;
      update public.orders set stock_deducted = true where id = oid;
      v_rededucted := v_rededucted + 1;
    elsif v_inv_id is not null then
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

-- ── 6) 부분취소 RPC — 세트는 부분취소 미지원(전체취소만) ──
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
  if exists (select 1 from public.order_deductions where order_id = p_order_id) then
    return jsonb_build_object('error', '세트 상품은 부분취소를 지원하지 않습니다. 전체취소를 이용하세요.');
  end if;
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

-- ── 7) 권한 ──
grant execute on function public.ship_orders(jsonb) to anon;
grant execute on function public.cancel_orders(bigint[], text, text) to anon;
grant execute on function public.uncancel_orders(bigint[], text) to anon;
grant execute on function public.partial_cancel_order(bigint, integer, text, text, text) to anon;
grant select, insert, update, delete on public.product_bom to anon;
grant select, insert, update, delete on public.order_deductions to anon;

-- ── 8) 픽프롬 세트 구성 시드 (구성품 재고명이 아래와 정확히 일치해야 함) ──
delete from public.product_bom where set_name like '픽프롬%';
insert into public.product_bom (set_name, component_name, component_qty) values
('픽프롬 슬로우에이징 리겐 올인원 본품1개+리필1개', '픽프롬 슬로우에이징 리겐 올인원 로션 본품 50ml', 1),
('픽프롬 슬로우에이징 리겐 올인원 본품1개+리필1개', '픽프롬 슬로우에이징 리겐 올인원 로션 리필 50ml', 1),
('픽프롬 슬로우에이징 리겐 올인원 본품1개+리필2개', '픽프롬 슬로우에이징 리겐 올인원 로션 본품 50ml', 1),
('픽프롬 슬로우에이징 리겐 올인원 본품1개+리필2개', '픽프롬 슬로우에이징 리겐 올인원 로션 리필 50ml', 2);

notify pgrst, 'reload schema';
