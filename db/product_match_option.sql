-- 상품매칭에 '수집옵션'을 추가해 옵션별 매칭 지원
-- (예: 같은 수집상품명이라도 색상:자연갈색 → 자연갈색 대표명, 색상:흑색 → 흑색 대표명)
-- 옵션이 빈 값('')이면 기존처럼 이름만으로 매칭(하위호환).

alter table public.product_matches
  add column if not exists collect_option text not null default '';

-- 기존 유니크(collect_name 단독)를 (collect_name, collect_option) 복합으로 교체.
-- 그래야 같은 수집명이 옵션별로 여러 대표명을 가질 수 있음.
-- ⚠️ 원본 단독 유니크 인덱스 이름은 product_matches_collect_uidx (db/product_matches.sql 기준).
--    과거 이 파일이 엉뚱한 이름을 drop 하는 바람에 옛 인덱스가 남아 옵션별 등록이 막혔음 → 정확한 이름으로 삭제.
alter table public.product_matches drop constraint if exists product_matches_collect_name_key;
drop index if exists public.product_matches_collect_name_key;
drop index if exists public.product_matches_collect_uidx;   -- 실제 원본 인덱스(이게 원인)
-- 혹시 남아있을 수 있는 NULL 옵션 정리(복합 유니크 정확성)
update public.product_matches set collect_option = '' where collect_option is null;
create unique index if not exists product_matches_name_opt_uidx
  on public.product_matches (collect_name, collect_option);

notify pgrst, 'reload schema';
