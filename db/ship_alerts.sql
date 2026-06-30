-- 자동출고 안전장치 알림 — 주문변환 시 재고 매칭 실패/부족/RPC오류를 기록 → 대시보드 경고
-- Supabase SQL Editor에서 1회 실행.

create table if not exists public.ship_alerts (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),
  company text,                          -- 사업자
  kind text not null,                    -- 'unmatched'(재고 미매칭) | 'negative'(재고 부족) | 'rpc_fail'(자동출고 실패)
  detail text,                           -- 사람이 읽는 요약 (상품명·수량 등)
  order_count integer default 0,         -- 관련 주문 수
  resolved boolean not null default false,-- 담당자 확인 처리 여부
  resolved_by text,
  resolved_at timestamptz,
  created_by text
);

create index if not exists ship_alerts_unresolved_idx on public.ship_alerts (resolved, created_at desc);

-- RLS (현재 베타와 동일하게 anon 허용 — 정식 권한 전환 시 함께 교체)
alter table public.ship_alerts enable row level security;
drop policy if exists "temp_anon_all_ship_alerts" on public.ship_alerts;
create policy "temp_anon_all_ship_alerts" on public.ship_alerts
  for all to anon using (true) with check (true);

notify pgrst, 'reload schema';
