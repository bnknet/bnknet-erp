-- 카드 '기준값 이전 사용분' 재설정 (2026-08-11)
-- 규칙: 기준값 이전 사용분 = 한도 − opening_balance  →  opening_balance = 한도 − 사용분.
--       (사용분이 한도보다 크면 opening_balance 음수 = 정상. 그만큼 이전 사용분으로 잡힘)
-- 법인 = 홀더 '비앤케이넷'. 방기현은 (마일리지)/(포인트) 2장 중 마일리지 카드 기준.

-- 방기현 (마일리지)
update cards set opening_balance = 18299338 where id = '2b4155fe-a64e-4757-b4a3-80337eaa2603'; -- 우리(마) 한도 20,000,000 − 사용분 1,700,662
update cards set opening_balance = 12638760 where id = 'c375b1f7-793a-4c77-a48f-22c9e8f45895'; -- 농협(마) 한도 22,000,000 − 사용분 9,361,240
update cards set limit_amount = 45000000, opening_balance = -5384788 where id = '43c79c8c-e419-4c82-968c-b3a7b5ae31a9'; -- 삼성(마) 한도 45,000,000 − 사용분 50,384,788

-- 방성훈
update cards set opening_balance = 15185022 where id = '8dc0f5fa-42ed-4497-9efd-3221c134ff3d'; -- 우리 한도 37,500,000 − 사용분 22,314,978

-- 법인(비앤케이넷)
update cards set opening_balance = -10175561 where id = '476fc2eb-efa3-4b57-9e46-0e556229512f'; -- 롯데 한도 20,000,000 − 사용분 30,175,561
update cards set opening_balance = 10524840 where id = 'c5951144-5c15-42ae-837b-a380a2680f8f'; -- 국민 한도 16,800,000 − 사용분 6,275,160
