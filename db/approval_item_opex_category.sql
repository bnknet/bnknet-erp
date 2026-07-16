-- 판관비 태깅을 '문서 단위'에서 '품목(항목) 단위'로 확장.
-- 한 지출결의서 안에서도 품목마다 판관비 항목이 다르거나 판관비가 아닐 수 있음.
-- approval_items.opex_category = opex_category.key (없으면 판관비 아님). 지출결의서 품목에만 사용.

alter table public.approval_items
  add column if not exists opex_category text;
