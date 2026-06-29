-- 매출 목표 초기값 + 마진율 목표 컬럼 추가 — Supabase SQL Editor에서 실행
-- 값: 비앤케이넷 월 10억/마진율 12%, 더블아이·SJ글로벌·IX글로벌 각 월 1억/마진율 15%
-- (월별 동일값으로 2026년 1~12월 적재. 나중에 화면에서 수정 가능)

-- 마진율 목표 컬럼 (% 단위)
alter table public.sales_targets add column if not exists target_margin numeric;

-- 2026년 1~12월 시드 (company,year,month 유니크 → 있으면 갱신)
insert into public.sales_targets (company, year, month, target_amount, target_margin)
select c.company, 2026, m.month, c.amt, c.margin
from (values
  ('BNKNET', 1000000000, 12),
  ('더블아이', 100000000, 15),
  ('SJ글로벌', 100000000, 15),
  ('IX글로벌', 100000000, 15)
) as c(company, amt, margin)
cross join (select generate_series(1,12) as month) as m
on conflict (company, year, month) do update
  set target_amount = excluded.target_amount,
      target_margin = excluded.target_margin,
      updated_at = now();

notify pgrst, 'reload schema';
