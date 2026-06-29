-- 테스트 계정을 "거래처 전용(partner)"으로 설정 — Supabase SQL Editor에서 실행
-- 효과: 로그인 시 거래처 관리 메뉴만 보이고, 다른 메뉴는 직접 URL로도 접근 차단.
--       거래처는 등록·수정 가능(삭제는 대표·실장만이라 불가).
-- 비밀번호는 평문 비교(베타) → password_hash 컬럼에 '1234' 저장.

update public.employees
set password_hash = '1234',
    role = 'partner',
    status = 'active'
where email = 'test@bnknet.co.kr';

-- 확인
select email, name, role, status from public.employees where email = 'test@bnknet.co.kr';
