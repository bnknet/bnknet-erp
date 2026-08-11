-- 방기현 한도공유(마일리지/포인트 2장) 기준잔여 중복 제거 (2026-08-11)
-- 원리: 한도공유 그룹의 기준잔여(opening_balance)는 '두 장 합산'으로 계산됨.
--       같은 값이 양쪽에 중복 입력돼 합이 2배 → 한도보다 커지면 사용 0으로 표시(하나카드 증상).
-- 조치: 기준잔여는 마일리지 카드에만 남기고 포인트 카드는 0으로. 삼성(포)는 한도 45,000,000으로 통일.
update cards set opening_balance = 0 where id in (
  'd83874f5-9dfa-4e18-89bc-e789fd2275be',  -- 국민(포)
  'ac8712e7-b567-4bc4-98e6-1225db731839',  -- 롯데(포)
  'bcbb9866-1e33-4549-8977-c44869e646b8',  -- 하나(포)
  'acbf9fa6-1a31-4e51-beba-fe0889049f92'   -- 현대(포)
);
update cards set limit_amount = 45000000, opening_balance = 0
where id = 'cf55d631-3c0a-49aa-933c-ce5d395ce01f';  -- 삼성(포)
