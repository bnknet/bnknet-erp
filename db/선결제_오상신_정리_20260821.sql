-- 선결제(한도복구) 오상신 정리 (2026-08-21)
-- 배경: ERP에 카드구매 결재가 있는 구매인데도 별도 '선결제(한도복구)' 결재로 중복 상신 → 한도 이중복구.
--       독립 선결제 결재는 영구 크레딧이라 매입이 결제일 경과로 사라진 뒤에도 한도를 계속 부풀림(카드값 불일치의 근본 원인).
-- 조치(사용자 확인 목록 기준): 전체취소 9건 삭제 + 부분취소 4건(지정 품목 삭제 후 총액 재계산).
-- 이후: 결제예정일 미도래 매입만 카드매입→한도현황→선결제 처리로 재처리(실제 결제일). 경과 건은 자동 결제완료라 불필요.
-- 실행 전 approvals/approval_items 백업 SELECT 결과 보관. 최종적으로 카드사 앱 실잔여 기준 기준잔여 재보정 예정.

-- B. 부분취소 — 지정 품목 삭제
delete from approval_items
where approval_id = '09d58b1b-c8bf-49f2-af4b-6076fa76b9ab'          -- ① 7/16 방기현 현대(포) 8,273,160
  and not (item_date = '2026-06-28' and amount = 39200);            --    6/28 연회비 39,200원만 유지

delete from approval_items
where approval_id = '48808534-1ddc-4147-b4bc-467017a675bf'          -- ② 7/24 법인 국민 6,275,160
  and item_date = '2026-07-08' and amount = 668660;                 --    7/8 668,660 × 2건 취소 → 4,937,840

delete from approval_items
where approval_id = '771079ab-614f-454f-892c-7869cd732ab8'          -- ④ 8/4 법인 롯데 19,725,384
  and ( (item_date = '2026-07-08' and amount = 668660)              --    7/8 668,660 × 4건
     or (item_date = '2026-07-14' and amount in (10882674, 3627558, 769558)) ); -- → 1,770,954

delete from approval_items
where approval_id = '4ac2ed6a-8237-4cc3-bcca-62e2b6f86c4f'          -- ⑨ 8/7 방기현 국민(포) 19,418,900
  and item_date = '2026-07-08' and amount in (668660, 3627558);     --    → 14,454,022

-- C. 부분취소 4건 총액 재계산(남은 품목 합)
update approvals a
set total_amount = coalesce((select sum(i.amount) from approval_items i where i.approval_id = a.id), 0),
    updated_at = now()
where a.id in ('09d58b1b-c8bf-49f2-af4b-6076fa76b9ab','48808534-1ddc-4147-b4bc-467017a675bf',
               '771079ab-614f-454f-892c-7869cd732ab8','4ac2ed6a-8237-4cc3-bcca-62e2b6f86c4f');

-- D. 전체취소 9건 삭제
-- ③8,023,920 방성훈 삼성 / ⑤8,613,517 방성훈 현대 / ⑥21,765,348 방기현 삼성(포) / ⑦4,385,808 조현상 국민
-- ⑧16,111,392 박정진 국민 / ⑩8,647,983 방성훈 현대 / ⑪24,843,276 방성훈 우리 / ⑫15,702,032 방성훈 현대 / ⑬10,882,674 박정진 현대
delete from approval_items where approval_id in (
'51bdeb39-4b5a-45dc-b978-6376a577f00d','bcb05448-47ce-422a-a825-e9e10bf3805d','8476ca8f-0d9d-494d-9ee0-3493fe4d5233',
'efdd344a-fcfa-4675-9e80-5cf2908fc7dd','27143a61-0190-453a-ab5c-7804d90323a6','a16e0274-a8be-4ac4-a2d7-2968872af8d9',
'da30fc37-4b04-46fc-b9c4-ff3b72a64512','61011f5e-42be-4868-8f7a-fe032209063f','2038127d-ccad-4ded-8d6a-609ef64934c4');
delete from approvals where is_card_payment = true and id in (
'51bdeb39-4b5a-45dc-b978-6376a577f00d','bcb05448-47ce-422a-a825-e9e10bf3805d','8476ca8f-0d9d-494d-9ee0-3493fe4d5233',
'efdd344a-fcfa-4675-9e80-5cf2908fc7dd','27143a61-0190-453a-ab5c-7804d90323a6','a16e0274-a8be-4ac4-a2d7-2968872af8d9',
'da30fc37-4b04-46fc-b9c4-ff3b72a64512','61011f5e-42be-4868-8f7a-fe032209063f','2038127d-ccad-4ded-8d6a-609ef64934c4');

-- E. 검증(기대값): 09d58b1b=39,200 / 48808534=4,937,840 / 771079ab=1,770,954 / 4ac2ed6a=14,454,022
-- select id, total_amount from approvals where id in ('09d58b1b-...','48808534-...','771079ab-...','4ac2ed6a-...');
