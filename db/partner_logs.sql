-- 거래처 변경 이력 테이블 — Supabase SQL Editor에서 1회 실행
-- 거래처 등록/수정/삭제 시 누가·언제·무엇을 했는지 기록 → 전 직원이 "변경 이력" 탭에서 조회

create table if not exists public.partner_logs (
  id uuid primary key default gen_random_uuid(),
  action text not null,        -- 거래처등록 / 거래처수정 / 거래처삭제
  target text,                 -- 거래처명
  detail text,                 -- 유형·사업자·브랜드 등
  actor text,                  -- 처리한 직원 이름
  created_at timestamptz default now()
);

create index if not exists partner_logs_created_idx on public.partner_logs (created_at desc);

-- RLS (현재 베타와 동일하게 anon 허용)
alter table public.partner_logs enable row level security;
drop policy if exists "temp_anon_all_partner_logs" on public.partner_logs;
create policy "temp_anon_all_partner_logs" on public.partner_logs
  for all to anon using (true) with check (true);
