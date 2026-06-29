-- 몰별 수수료 (사업자 + 판매몰 → 수수료율 %) — 영업이익 계산용
-- Supabase SQL Editor에서 1회 실행. 요율 변경 시 이 테이블만 수정하면 매출현황에 바로 반영됨.

create table if not exists public.mall_fees (
  id uuid primary key default gen_random_uuid(),
  company text not null,   -- 'BNKNET' | '더블아이' | 'SJ글로벌' | 'IX글로벌'
  mall text not null,      -- 정규화된 판매몰명 (스마트스토어 / G마켓 / 옥션 / 11번가 / 쿠팡 / 토스 / SSG / Hmall / 롯데온 / 자사몰Npay / 자사몰직접결제)
  rate numeric not null default 0,  -- 수수료율(%) — 예: 12 = 12%
  updated_at timestamptz default now()
);

create unique index if not exists mall_fees_uniq on public.mall_fees (company, mall);

-- RLS (현재 베타와 동일하게 anon 허용 — 정식 권한 전환 시 함께 교체)
alter table public.mall_fees enable row level security;
drop policy if exists "temp_anon_all_mall_fees" on public.mall_fees;
create policy "temp_anon_all_mall_fees" on public.mall_fees
  for all to anon using (true) with check (true);

-- 초기 요율 적재 (이미 있으면 요율 갱신)
insert into public.mall_fees (company, mall, rate) values
  -- 비앤케이넷 / 더블아이 / SJ글로벌 (동일 요율)
  ('BNKNET','스마트스토어',6), ('BNKNET','G마켓',12), ('BNKNET','옥션',12), ('BNKNET','11번가',12), ('BNKNET','쿠팡',10.56), ('BNKNET','토스',12.10),
  ('더블아이','스마트스토어',6), ('더블아이','G마켓',12), ('더블아이','옥션',12), ('더블아이','11번가',12), ('더블아이','쿠팡',10.56), ('더블아이','토스',12.10),
  ('SJ글로벌','스마트스토어',6), ('SJ글로벌','G마켓',12), ('SJ글로벌','옥션',12), ('SJ글로벌','11번가',12), ('SJ글로벌','쿠팡',10.56), ('SJ글로벌','토스',12.10),
  -- IX글로벌 (몰·요율 별도)
  ('IX글로벌','스마트스토어',6), ('IX글로벌','SSG',35), ('IX글로벌','Hmall',15), ('IX글로벌','롯데온',25), ('IX글로벌','자사몰Npay',2.97), ('IX글로벌','자사몰직접결제',3.24)
on conflict (company, mall) do update set rate = excluded.rate, updated_at = now();

notify pgrst, 'reload schema';
