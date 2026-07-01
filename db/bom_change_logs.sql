-- 세트 구성 변경 로그 (2026-07-01)
-- 세트 생성/수정/삭제 이력: 누가·언제·무엇을·어떻게 바꿨는지 기록.
-- Supabase SQL Editor에서 1회 실행. (RLS 경고 시 다른 테이블과 동일하게 'Run without RLS')

create table if not exists public.bom_change_logs (
  id uuid primary key default gen_random_uuid(),
  action text not null,        -- '생성' | '수정' | '삭제'
  set_name text not null,
  detail text,                 -- 변경 상세 (이전 → 이후 구성 등)
  changed_by text,
  created_at timestamptz default now()
);
create index if not exists bom_change_logs_created_idx on public.bom_change_logs (created_at desc);

grant select, insert, update, delete on public.bom_change_logs to anon;

notify pgrst, 'reload schema';
