-- 이하늘 퇴사 처리 (2026-08-31)
-- status='inactive'면 ERP 로그인(서버·레거시 폴백)과 슬랙 ERP비서 DM이 모두 차단된다.
-- (인사관리 화면의 '퇴사 처리' 버튼과 동일한 동작. 재실행 안전.)
update public.employees
set status = 'inactive', updated_at = now()
where name = '이하늘' and email = 'neulahh.s2@gmail.com' and status = 'active';

-- 검증: status가 inactive인지 확인
-- select name, email, status from employees where name = '이하늘';
