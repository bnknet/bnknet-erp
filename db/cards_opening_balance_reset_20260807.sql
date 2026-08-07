-- 카드 기준 잔여한도(opening_balance) 재설정
-- 목적: 초기값(기준 잔여한도)만 잘못 세팅돼 실시간 잔여한도가 안 맞는 문제 해결.
--       결재/선결제/차감 금액은 정상이므로, "7월 ERP 사용 시작 직전 잔여한도"만 각 카드에 넣어주면
--       실시간 잔여한도 = 기준값 − ERP사용분 + 선결제복구 로 자동으로 맞아짐.
--
-- ※ 여기 넣는 값은 "현재 남은 한도"가 아니라 "ERP 쓰기 직전(6말/7초) 잔여한도"여야 함.
--
-- 한도 공유(limit_group) 카드는 로직이 그룹 내 두 장의 opening_balance를 "합산"해서 사용함.
-- (src/app/cards/CardsContent.tsx: opening = 그룹 카드들의 opening_balance 합)
-- 따라서 공유 그룹은 "한 장에 목표값 · 다른 장에 0"을 넣어 합계가 목표가 되게 함.
--
-- id로 정확히 지정 → 오매칭 없음. 재실행에 안전(멱등).

-- ── 조현상 (단독 카드) ─────────────────────────────
-- 신한카드 8183 → 155,360
update cards set opening_balance = 155360  where id = '97504c81-ba1a-4aca-9947-644f4f65e348';
-- 하나카드 4155 → 2,179,540
update cards set opening_balance = 2179540 where id = '02891a73-b490-4cb0-b12b-2c931a468046';

-- ── 방기현 농협 (limit_group=방기현_농협, 한도 공유) 합계 9,361,240 ──
-- 마일리지 2008 → 9,361,240
update cards set opening_balance = 9361240 where id = 'c375b1f7-793a-4c77-a48f-22c9e8f45895';
-- 포인트 6006 → 0
update cards set opening_balance = 0       where id = '57f09bea-5d33-4d20-a6d1-a4c3ebe6b46a';

-- ── 방기현 우리 (limit_group=방기현_우리, 한도 공유) 합계 1,700,662 ──
-- 마일리지 2936 → 1,700,662
update cards set opening_balance = 1700662 where id = '2b4155fe-a64e-4757-b4a3-80337eaa2603';
-- 포인트 3885 → 0
update cards set opening_balance = 0       where id = 'bdc16a37-7155-4b87-99c4-3eead26afadd';

-- 확인: 아래로 반영 결과 조회
-- select holder_name, card_company, last4, limit_group, opening_balance from cards
--  where id in ('97504c81-ba1a-4aca-9947-644f4f65e348','02891a73-b490-4cb0-b12b-2c931a468046',
--               'c375b1f7-793a-4c77-a48f-22c9e8f45895','57f09bea-5d33-4d20-a6d1-a4c3ebe6b46a',
--               '2b4155fe-a64e-4757-b4a3-80337eaa2603','bdc16a37-7155-4b87-99c4-3eead26afadd');
