-- SJ글로벌 · 강웅구 · 2026-07-08 카드매입 2건: 구매처 '현대카드' → '현대홈쇼핑' 오기 수정
-- (우리카드 / 현대카드로 올린 2건. 구매처를 카드명으로 잘못 적음)

-- 1) 먼저 확인 — 아래가 정확히 2건인지 보고 실행 (2건이 아니면 조건을 좁혀서 재확인)
select id, issue_date, spend_date, card_id, total_amount, purchase_vendor
from public.approvals
where company = 'SJ글로벌'
  and organizer = '강웅구'
  and purchase_vendor = '현대카드'
  and (spend_date = '2026-07-08' or issue_date = '2026-07-08');

-- 2) 확인되면 수정
update public.approvals
set purchase_vendor = '현대홈쇼핑'
where company = 'SJ글로벌'
  and organizer = '강웅구'
  and purchase_vendor = '현대카드'
  and (spend_date = '2026-07-08' or issue_date = '2026-07-08');
