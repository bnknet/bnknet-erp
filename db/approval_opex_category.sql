-- 판관비 2단계: 지출결의서에 '판관비 항목'을 태깅 → 영업이익 탭이 자동 합산.
-- 값은 opex_category.key (labor/rent/ad/fee/logistics/supplies/etc 또는 커스텀 key).
-- 지출결의서에만 사용(매입품의서/카드구매는 상품 매입=원가라 제외, 이미 공헌이익에 반영됨).

alter table public.approvals
  add column if not exists opex_category text;
