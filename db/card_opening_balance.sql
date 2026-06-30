-- 카드 6/30 기준 실제 잔여한도(참고용) 컬럼 — Supabase SQL Editor에서 실행
-- 전체한도(limit_amount)와 별개로, 06/30 시점 실잔여를 저장해 한도현황에 함께 표시.
alter table public.cards add column if not exists opening_balance numeric;

notify pgrst, 'reload schema';
