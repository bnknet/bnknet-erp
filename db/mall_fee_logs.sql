-- 몰 수수료 변경 이력 (누가·언제·무엇을 바꿨나) — 몰 수수료 관리 화면용 (2026-07-06)
-- 없어도 화면은 동작(조회 실패 시 무시). 이력을 남기려면 1회 실행.

create table if not exists public.mall_fee_logs (
  id          uuid primary key default gen_random_uuid(),
  action      text not null,      -- 'create' | 'update' | 'delete'
  company     text not null,
  mall        text not null,
  before_rate numeric,
  after_rate  numeric,
  changed_by  text,
  created_at  timestamptz not null default now()
);

create index if not exists mall_fee_logs_created_idx on public.mall_fee_logs (created_at desc);

alter table public.mall_fee_logs enable row level security;
drop policy if exists "temp_anon_all_mall_fee_logs" on public.mall_fee_logs;
create policy "temp_anon_all_mall_fee_logs" on public.mall_fee_logs
  for all to anon using (true) with check (true);

notify pgrst, 'reload schema';
