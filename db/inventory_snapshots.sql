-- 일자별 재고 (스냅샷) 설정 — Supabase SQL Editor에서 1회 실행
-- 매일 한국시간 23:50에 현재 재고를 그날 스냅샷으로 자동 저장 → 재고관리 "일자별 재고" 탭에서 날짜별 조회

-- 1) 스냅샷 테이블
create table if not exists public.inventory_snapshots (
  id uuid primary key default gen_random_uuid(),
  snapshot_date date not null,
  inventory_id uuid,
  product_id uuid,
  product_name text not null,
  category text,
  brand text,
  company text not null,
  quantity integer not null default 0,
  cost_price integer not null default 0,
  created_at timestamptz default now()
);

-- 같은 날짜+재고항목 중복 방지 (재실행 시 수량 갱신)
create unique index if not exists inventory_snapshots_uniq
  on public.inventory_snapshots (snapshot_date, inventory_id);
create index if not exists inventory_snapshots_date_idx
  on public.inventory_snapshots (snapshot_date);

-- 2) RLS (현재 베타와 동일하게 anon 허용 — 정식 권한 전환 시 함께 교체)
alter table public.inventory_snapshots enable row level security;
drop policy if exists "temp_anon_all_snapshots" on public.inventory_snapshots;
create policy "temp_anon_all_snapshots" on public.inventory_snapshots
  for all to anon using (true) with check (true);

-- 3) 스냅샷 함수: 현재 inventory 전체를 오늘(KST) 날짜로 저장
create or replace function public.take_inventory_snapshot()
returns void language sql as $$
  insert into public.inventory_snapshots
    (snapshot_date, inventory_id, product_id, product_name, category, brand, company, quantity, cost_price)
  select (now() at time zone 'Asia/Seoul')::date,
         id, product_id, product_name, category, brand, company, quantity, coalesce(cost_price, 0)
  from public.inventory
  on conflict (snapshot_date, inventory_id)
  do update set quantity = excluded.quantity, cost_price = excluded.cost_price;
$$;

-- 4) pg_cron 확장 + 매일 23:50 KST(= 14:50 UTC) 자동 실행 예약
create extension if not exists pg_cron;
select cron.schedule('daily_inventory_snapshot', '50 14 * * *',
  $$ select public.take_inventory_snapshot(); $$);

-- 5) 지금 즉시 한 번 실행 (오늘 데이터 생성 → 화면 테스트용)
select public.take_inventory_snapshot();
