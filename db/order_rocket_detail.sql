-- 쿠팡 로켓그로스 직접등록: 비용 세부내역 저장용 컬럼
-- 직접주문등록 '쿠팡 로켓그로스' 모드에서 풀필먼트비용·판매수수료·광고비·쿠폰비용을 jsonb로 보관.
-- (매출=amount, 총원가=manual_cost, 부대비용합=manual_shipping 은 기존 컬럼 재사용 · 매출현황 계산에 사용)
-- 재실행 안전.
alter table public.orders add column if not exists rocket_detail jsonb;

-- PostgREST 스키마 캐시 새로고침
notify pgrst, 'reload schema';
