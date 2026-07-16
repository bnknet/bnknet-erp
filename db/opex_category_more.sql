-- 판관비 항목 추가: 4대보험, 접대비, 영업·판촉비, 여비교통비.
-- opex_category 테이블에 없으면 추가(이미 있으면 유지). ⚙ 항목 관리에서도 추가/수정 가능.

insert into public.opex_category (key, label, nature, taxable, sort) values
  ('insurance',   '4대보험',     '고정',   false, 15),
  ('entertain',   '접대비',      '변동',   true,  80),
  ('sales_promo', '영업·판촉비', '준변동', true,  90),
  ('travel',      '여비교통비',  '변동',   true,  100)
on conflict (key) do nothing;
