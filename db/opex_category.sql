-- 판관비 '항목(카테고리)'을 사용자가 직접 추가·수정·숨김할 수 있도록 테이블화.
-- 기존 코드 고정 7항목을 기본 시드로 넣음. opex.category 는 이 테이블의 key 를 참조.

create table if not exists public.opex_category (
  key text primary key,              -- 안정 식별자(기본항목은 고정 슬러그, 커스텀은 생성값)
  label text not null,               -- 화면 표기명
  nature text not null default '고정',-- 고정/변동/준변동/혼합
  taxable boolean not null default true, -- 과세(부가세 포함 지급 → ÷1.1) / 면세
  sort int not null default 0,       -- 정렬 순서
  active boolean not null default true, -- 숨김(false)이면 입력화면에서 제외(과거 데이터는 유지)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 기본 7항목 시드 (이미 있으면 건드리지 않음)
insert into public.opex_category (key, label, nature, taxable, sort) values
  ('labor',     '인건비',       '고정',   false, 10),
  ('rent',      '임차료·관리비', '고정',   true,  20),
  ('ad',        '광고선전비',    '준변동', true,  30),
  ('fee',       '지급수수료',    '변동',   true,  40),
  ('logistics', '물류·보관비',   '고정',   true,  50),
  ('supplies',  '소모품·포장재', '변동',   true,  60),
  ('etc',       '기타 운영비',   '혼합',   true,  70)
on conflict (key) do nothing;
