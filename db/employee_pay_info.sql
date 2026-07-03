-- 직원 급여일 + 급여 통장 컬럼 및 값 반영 (2026-07-03)
-- 인사 관리는 대표·실장만 접근(앱단 제어). Supabase SQL Editor에서 1회 실행.

alter table public.employees add column if not exists pay_day text;      -- 급여일 (예: '25', '10', '말일')
alter table public.employees add column if not exists salary_bank text;  -- 급여 통장 (은행 + 계좌)

update public.employees set pay_day = '25',  salary_bank = '국민은행 818502-04-202430'  where name = '방기현';
update public.employees set pay_day = '10',  salary_bank = '농협은행 302-213387-8861'    where name = '방성훈';
update public.employees set pay_day = '25',  salary_bank = '국민은행 801702-04-120123'    where name = '강웅구';
update public.employees set pay_day = '말일', salary_bank = '농협은행 302-167524-3811'    where name = '손사빈';
update public.employees set pay_day = '말일', salary_bank = '국민은행 439202-01-413584'    where name = '박정진';
update public.employees set pay_day = '말일', salary_bank = '기업은행 3980-45323-01013'    where name = '최영훈';

notify pgrst, 'reload schema';
