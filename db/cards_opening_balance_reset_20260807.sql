-- 카드 기준 잔여한도(opening_balance) 재설정
-- 목적: 초기값(기준 잔여한도)만 잘못 세팅돼 실시간 잔여한도가 안 맞는 문제 해결.
--       결재/선결제/차감 금액은 정상이므로, "7월 ERP 사용 시작 직전 잔여한도"만 각 카드에 넣어주면
--       실시간 잔여한도 = 기준값 − ERP사용분 + 선결제복구 로 자동으로 맞아짐.
--
-- ※ 여기 넣는 값은 "현재 남은 한도"가 아니라 "ERP 쓰기 직전(6말/7초) 잔여한도"여야 함.
--
-- 실행 순서: 1) SELECT로 각 카드가 정확히 1행씩 잡히는지 확인 → 2) UPDATE 실행
-- 재실행에 안전(멱등): 조건에 맞는 카드의 opening_balance만 덮어씀.

-- 1) 확인용 SELECT (각 항목이 딱 1행씩이어야 함)
select id, holder_name, card_type, card_company, card_name, last4, limit_amount, opening_balance
from cards
where (holder_name ilike '%조현상%' or card_type ilike '%조현상%') and (card_company ilike '%신한%' or card_name ilike '%신한%')
   or (holder_name ilike '%조현상%' or card_type ilike '%조현상%') and (card_company ilike '%하나%' or card_name ilike '%하나%')
   or (holder_name ilike '%방기현%' or card_type ilike '%방기현%') and (card_company ilike '%농협%' or card_name ilike '%농협%')
   or (holder_name ilike '%방기현%' or card_type ilike '%방기현%') and (card_company ilike '%우리%' or card_name ilike '%우리%');

-- 2) 각 1행씩 맞으면 아래 UPDATE 실행
update cards set opening_balance = 155360
 where (holder_name ilike '%조현상%' or card_type ilike '%조현상%')
   and (card_company ilike '%신한%' or card_name ilike '%신한%');

update cards set opening_balance = 2179540
 where (holder_name ilike '%조현상%' or card_type ilike '%조현상%')
   and (card_company ilike '%하나%' or card_name ilike '%하나%');

update cards set opening_balance = 9361240
 where (holder_name ilike '%방기현%' or card_type ilike '%방기현%')
   and (card_company ilike '%농협%' or card_name ilike '%농협%');

update cards set opening_balance = 1700662
 where (holder_name ilike '%방기현%' or card_type ilike '%방기현%')
   and (card_company ilike '%우리%' or card_name ilike '%우리%');
