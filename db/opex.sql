-- 판관비(SG&A) 월별 입력 테이블. 매출현황 '영업이익' 탭(경영진 전용)에서 사용.
-- 영업이익 = 월 공헌이익 − 월 판관비(공급가액 기준). 사업자·월·항목별 1행(upsert).

create table if not exists public.opex (
  id uuid primary key default gen_random_uuid(),
  company text not null,
  year int not null,
  month int not null,
  category text not null,       -- opex.ts OPEX_CATEGORIES 의 key (labor/rent/ad/fee/logistics/supplies/etc)
  amount numeric not null default 0,  -- 지급액(과세 항목은 부가세 포함)
  memo text,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 사업자+연월+항목 단위로 유일 → 입력 시 덮어쓰기(upsert on_conflict) 가능
create unique index if not exists opex_company_ym_cat_uidx
  on public.opex (company, year, month, category);

create index if not exists opex_ym_idx on public.opex (year, month);
