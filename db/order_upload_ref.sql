-- 업로드 이력에서 직접등록 건 클릭 시 상세(등록 품목·변경 이력) 조회용 (2026-07-02)
-- 직접등록 배치의 주문번호(order_number)를 order_uploads에 저장 → 클릭 시 해당 주문·변경이력 조회.
-- Supabase SQL Editor에서 1회 실행.

alter table public.order_uploads add column if not exists ref_order_number text;
