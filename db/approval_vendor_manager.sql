-- 발주서 발주처 담당자명 저장용 컬럼.
-- 결재(발주서) 기안 시 거래처관리(partners)에서 거래처를 선택하면 상호(purchase_vendor)와
-- 담당자명(vendor_manager)이 자동 입력된다. 발주서에 "담당: OOO"로 표기.
alter table public.approvals add column if not exists vendor_manager text;
