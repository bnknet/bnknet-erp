-- 판관비 항목 추가: 차량관리비 (주유·정비·보험·검사 등 차량 유지비).
-- 과세(taxable=true)로 등록 — 매입세액 공제 가정. 비영업용 승용차라 불공제면 taxable=false로 조정.
insert into public.opex_category (key, label, nature, taxable, sort) values
  ('vehicle', '차량관리비', '변동', true, 125)
on conflict (key) do nothing;
