-- 상품 매칭 셀프 관리 (담당자가 ERP에서 신규 매칭을 직접 추가/수정) (2026-07-02)
-- 목적: 매칭데이터 파일을 사람이 주고받던 병목 제거.
--   · 하드코딩 PRODUCT_MAP(검증된 820개)은 base 유지, 여기에 DB 매칭을 '덧씌워' 병합
--   · 담당자가 신규 상품 매칭을 등록 → 새로고침하면 변환/재고매칭 즉시 반영, 미매칭 알림 해소
-- Supabase SQL Editor에서 1회 실행. (RLS 미사용 — anon 권한으로 접근)

create table if not exists public.product_matches (
  id           uuid primary key default gen_random_uuid(),
  collect_name text not null,                 -- 수집상품명(옵션 포함 원문 또는 정리된 형태)
  product_name text not null,                 -- 대표상품명(재고/매출 매칭 기준)
  created_by   text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- 같은 수집상품명 중복 방지 (upsert 기준). 대소문자·공백 그대로 유니크.
create unique index if not exists product_matches_collect_uidx
  on public.product_matches (collect_name);

-- 변경 이력
create table if not exists public.product_match_logs (
  id             uuid primary key default gen_random_uuid(),
  action         text not null,               -- 'create' | 'update' | 'delete'
  collect_name   text not null,
  before_product text,                         -- 수정/삭제 전 대표명
  after_product  text,                         -- 생성/수정 후 대표명
  changed_by     text,
  created_at     timestamptz not null default now()
);

create index if not exists product_match_logs_created_idx
  on public.product_match_logs (created_at desc);

-- 권한(anon 접근 — 앱단에서 역할 제어)
grant select, insert, update, delete on public.product_matches to anon;
grant select, insert on public.product_match_logs to anon;
grant delete on public.product_match_logs to anon; -- 로그 삭제는 앱단에서 대표·실장만 노출
