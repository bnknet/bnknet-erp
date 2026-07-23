-- 판관비 수동 추가 항목 (카테고리당 여러 건 · 항목명 + 금액)
-- 기존 opex(카테고리당 1건 금액)는 그대로 두고, 추가 등록분만 여기에 여러 건 쌓는다.
create table if not exists public.opex_item (
  id uuid primary key default gen_random_uuid(),
  company text not null,
  year int not null,
  month int not null,
  category text not null,
  label text,
  amount numeric not null default 0,
  created_by text,
  created_at timestamptz not null default now()
);

create index if not exists opex_item_ym_idx on public.opex_item (year, month, company);
