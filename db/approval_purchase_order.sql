-- 결재에 '발주서' 문서 추가 지원.
-- 발주서 품목은 공급가(개당·VAT포함)를 별도로 저장 → 합계금액(amount) = 수량 × 공급가.
-- 발주처는 기존 approvals.purchase_vendor 재사용, 발의/결재/지출 날짜·결재라인도 기존 구조 그대로 사용.

alter table public.approval_items
  add column if not exists unit_price numeric;
