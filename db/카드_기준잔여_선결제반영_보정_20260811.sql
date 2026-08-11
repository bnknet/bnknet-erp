-- 카드 기준잔여(opening_balance) 보정 v2 — 선결제·미결제 반영 (2026-08-11)
-- 화면 사용액 = (한도 − 기준잔여합) + 미결제 − 선결제(전액 즉시복구).
-- v1(한도−사용분)은 선결제 크레딧을 반영 안 해 사용액이 목표보다 작게 표시됨(하나카드 379,134−353,644=25,490로 확인).
-- 조치: 목표 사용분 P에 대해 opening = 한도 − P + 미결제 − 선결제 로 설정(그룹 합산 기준).
update cards set limit_amount = 45000000
where id = 'cf55d631-3c0a-49aa-933c-ce5d395ce01f'; -- 방기현 삼성(포) 한도 통일

with grp as (
  select id, coalesce(limit_group::text, id::text) gkey from cards
), t as (
  select g.gkey,
    coalesce(sum(case when a.is_card_payment then a.total_amount end),0) prepay,
    coalesce(sum(case when not a.is_card_payment
      and a.payment_due_date >= (now() at time zone 'Asia/Seoul')::date then a.total_amount end),0) unpaid
  from approvals a join grp g on g.id = a.card_id
  where a.doc_type in ('지출결의서','카드구매') and a.status = 'approved'
  group by g.gkey
), target(cid, p) as ( values
  ('2b4155fe-a64e-4757-b4a3-80337eaa2603'::uuid, 1700662),   -- 방기현 우리(마) 사용분
  ('c375b1f7-793a-4c77-a48f-22c9e8f45895'::uuid, 9361240),   -- 방기현 농협(마)
  ('43c79c8c-e419-4c82-968c-b3a7b5ae31a9'::uuid, 50384788),  -- 방기현 삼성(마)
  ('8dc0f5fa-42ed-4497-9efd-3221c134ff3d'::uuid, 22314978),  -- 방성훈 우리
  ('476fc2eb-efa3-4b57-9e46-0e556229512f'::uuid, 30175561),  -- 법인 롯데
  ('c5951144-5c15-42ae-837b-a380a2680f8f'::uuid, 6275160)    -- 법인 국민
)
update cards c
set opening_balance = c.limit_amount - target.p
    + coalesce(t.unpaid,0) - coalesce(t.prepay,0)
from target
left join grp g on g.id = target.cid
left join t on t.gkey = g.gkey
where c.id = target.cid;
