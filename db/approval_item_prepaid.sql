-- 카드 매입 항목(구매 상품)별 부분 선결제 지원
-- 매입 전체가 아니라 상품 건별로 골라 선결제(앞당겨 결제)하면
-- 해당 항목 금액만 그 날짜에 한도 복구된다. (취소 패턴과 동일 구조)
--   prepaid_date : 선결제(실제 결제)한 날짜 → 이 날 한도 복구
--   prepaid_at   : 선결제 처리 시각(감사/이력용)
alter table public.approval_items
  add column if not exists prepaid_date date,
  add column if not exists prepaid_at timestamptz;

-- 조회 성능(선결제된 항목만 훑기)
create index if not exists idx_approval_items_prepaid
  on public.approval_items (approval_id)
  where prepaid_date is not null;
