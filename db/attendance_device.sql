-- 출퇴근 기기 구분(PC/모바일) 컬럼 추가 (2026-07-01)
-- 각 담당자가 출근/퇴근을 어떤 기기로 눌렀는지 기록.
-- Supabase SQL Editor에서 1회 실행.

alter table public.attendance add column if not exists check_in_device  text; -- 'pc' | 'mobile'
alter table public.attendance add column if not exists check_out_device text; -- 'pc' | 'mobile'

notify pgrst, 'reload schema';
