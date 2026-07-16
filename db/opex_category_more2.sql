-- 판관비 항목 추가: 법인카드 사용 (제품매입 제외한 법인카드 일반사용분 수기 입력용).
insert into public.opex_category (key, label, nature, taxable, sort) values
  ('corp_card', '법인카드 사용', '변동', true, 120)
on conflict (key) do nothing;
