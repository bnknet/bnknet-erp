-- 부분취소/반품 실패 수정 (2026-09-14)
-- 증상: 주문 조회·취소 탭 [부분취소/반품] → "부분취소 처리 중 오류"
-- 원인: partial_cancel_order RPC(db/fix_order_id_bigint.sql)가 orders.updated_at = now() 를 갱신하는데
--       orders 테이블에 updated_at 컬럼이 없어 실행 시 42703(column does not exist)으로 롤백됨.
--       (전체취소 cancel_orders 는 이 컬럼을 안 건드려 정상 동작. 부분취소는 지금까지 성공 이력 0건)
-- 조치: 컬럼 추가만으로 해결. 재실행 안전(if not exists).

alter table public.orders add column if not exists updated_at timestamptz;

notify pgrst, 'reload schema';
