-- 업로드 이력 삭제 시 주문·재고·매출 원상복구 지원 (2026-07-02)
-- 파일 업로드로 저장된 주문에 upload_id를 연결 → 업로드 이력 삭제 시 해당 주문 일괄 삭제 + 재고 복구.
-- (직접등록은 order_uploads.ref_order_number로 이미 연결됨)
-- Supabase SQL Editor에서 1회 실행.

alter table public.orders add column if not exists upload_id uuid;
create index if not exists orders_upload_id_idx on public.orders (upload_id);

notify pgrst, 'reload schema';
