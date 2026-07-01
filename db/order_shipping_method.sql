-- 출고방식(택배/직접수령/화물) + 택배 출고 건수 컬럼 추가 (2026-07-01)
-- · 사방넷 자동주문: shipping_method 미지정(null) → 화면에서 '택배'로 간주(주문번호당 1택배)
-- · 직접주문등록: 출고방식 선택 + 택배 선택 시 택배 상자 수(courier_count) 입력
-- Supabase SQL Editor에서 1회 실행.

alter table public.orders add column if not exists shipping_method text;  -- '택배' | '직접수령' | '화물'
alter table public.orders add column if not exists courier_count integer; -- 택배 출고 건수(직접주문 입력값)

notify pgrst, 'reload schema';
