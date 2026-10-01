-- 재고 원가 변경 이력 (2026-10-01)
-- 재고관리에서 개당원가를 수정하면 '기존 → 변경 원가, 변경 사유 메모, 변경자, 시각'을 남긴다.
-- (원가는 변경 후 저장되는 주문부터 적용 — 과거 주문은 orders.unit_cost 로 고정. db/order_unit_cost.sql)
-- 재실행 안전.

create table if not exists public.inventory_cost_logs (
  id           uuid primary key default gen_random_uuid(),
  inventory_id uuid,
  product_name text not null,
  company      text,
  old_cost     numeric,          -- 변경 전 개당원가
  new_cost     numeric not null, -- 변경 후 개당원가
  memo         text,             -- 변경 사유(예: 10/01 입고분 반영 평균단가)
  changed_by   text,
  created_at   timestamptz not null default now()
);

create index if not exists inventory_cost_logs_inv_idx on public.inventory_cost_logs (inventory_id, created_at desc);
create index if not exists inventory_cost_logs_created_idx on public.inventory_cost_logs (created_at desc);

alter table public.inventory_cost_logs enable row level security;
drop policy if exists "temp_anon_all_inventory_cost_logs" on public.inventory_cost_logs;
create policy "temp_anon_all_inventory_cost_logs" on public.inventory_cost_logs
  for all to anon using (true) with check (true);

notify pgrst, 'reload schema';
