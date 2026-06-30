-- 카드 선결제(한도 복구) — 매입품의서(카드구매) 결재에 '선결제' 유형 추가
-- 선결제 결재 = 카드 사용분을 앞당겨 결제 → 승인 시 그 카드 한도가 살아남(복구).
-- Supabase SQL Editor에서 1회 실행.

-- is_card_payment = true 면 '선결제(결제/한도복구)', false 면 일반 '카드구매(한도차감)'
alter table public.approvals add column if not exists is_card_payment boolean not null default false;

notify pgrst, 'reload schema';
