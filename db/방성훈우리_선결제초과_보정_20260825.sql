-- 방성훈 우리카드 선결제 초과분 보정 (2026-08-25)
-- 상황: 기준값 이전 사용분 19,786,680인데 독립 선결제 결재(da8faa11, 7/24)가 22,314,978로 2,528,298 초과
--       → 화면 잔여한도가 카드사 앱(약 8,521,200)보다 초과분만큼 크게(11,049,498) 표시.
-- 분석: 품목이 전부 덴프스 개당 109,926원 → 초과 2,528,298 = 정확히 23개. 33개 품목 하나를 10개로 축소.
-- 결과: 선결제 총액 19,786,680 = 이전사용분과 일치 → 잔여 8,521,200(카드사 앱과 일치).
update approval_items
set amount = 1099260, quantity = 10
where id = '2851cccb-efab-4854-b64c-882c4477e6c4' and amount = 3627558;

update approvals a
set total_amount = (select sum(i.amount) from approval_items i where i.approval_id = a.id),
    updated_at = now()
where a.id = 'da8faa11-c110-4c18-ade7-04a710690dbc';
-- 검증: select total_amount from approvals where id = 'da8faa11-...'; → 19,786,680
