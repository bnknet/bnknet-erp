-- 직접(수기) 주문 등록 지원 컬럼 — Supabase SQL Editor에서 실행
-- source: 주문 출처 구분 (사방넷 변환분은 null/'사방넷', 직접등록='수기', 도매='도매')
-- manual_cost / manual_shipping: 도매 전용 입력값(개당원가·배송비) → 매출현황에서 마진 확정 계산에 사용
alter table public.orders add column if not exists source text;
alter table public.orders add column if not exists manual_cost integer;
alter table public.orders add column if not exists manual_shipping integer;

notify pgrst, 'reload schema';
