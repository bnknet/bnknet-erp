-- 결재 변경 이력 (상신자 수정재상신·상신취소) — 대표·실장 전용 조회 (2026-07-03)
-- 상신자 본인이 잘못 올린 결재를 수정(재상신)하거나 상신 취소한 이력을 기록.
-- 화면에서 대표·실장에게만 노출(앱단 제어). Supabase SQL Editor에서 1회 실행.

create table if not exists public.approval_logs (
  id          uuid primary key default gen_random_uuid(),
  approval_id uuid,
  action      text not null,      -- '수정재상신' | '상신취소'
  detail      text,
  changed_by  text,
  created_at  timestamptz not null default now()
);

create index if not exists approval_logs_approval_idx on public.approval_logs (approval_id, created_at desc);

grant select, insert, delete on public.approval_logs to anon;

notify pgrst, 'reload schema';
