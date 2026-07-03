-- 직원 연봉 컬럼 + 담당자별 연봉 반영 (2026-07-03)
-- 인사 관리는 대표·실장만 접근(앱단 제어). Supabase SQL Editor에서 1회 실행.

alter table public.employees add column if not exists salary bigint;

update public.employees set salary = 123818160 where name = '방기현';
update public.employees set salary = 62925720  where name = '방성훈';
update public.employees set salary = 48853685  where name = '강웅구';
update public.employees set salary = 42000000  where name = '손사빈';
update public.employees set salary = 37000000  where name = '박정진';
update public.employees set salary = 32000000  where name = '최영훈';

notify pgrst, 'reload schema';
