-- 발주서 발주처 담당자 연락처 저장용 컬럼.
-- 거래처관리(partners)에서 거래처 선택 시 담당자명·연락처가 자동 입력된다.
alter table public.approvals add column if not exists vendor_manager_phone text;
