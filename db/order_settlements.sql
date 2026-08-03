-- 오픈마켓 실정산 보정값 (옥션·지마켓·11번가)
-- 주문번호(사방넷) 기준 실수수료·실원가 저장 → 매출현황·주문조회 공헌이익을 실제 정산 기준으로 보정.
-- 매출(판매금액)은 ERP가 이미 정확하므로 저장/보정하지 않는다. 수수료·원가만 실제값으로 교체한다.
-- 재실행 안전(if not exists / on conflict).

create table if not exists public.order_settlements (
  order_number text primary key,   -- = orders.order_number (사방넷 주문번호)
  amount       integer not null default 0,  -- 실판매금액 합 (판매금액 — admin 기준, 쿠폰 반영된 정확값)
  fee          integer not null default 0,  -- 마켓 실공제 총액 = 판매금액 − 정산예정금액 (서비스이용료+판매촉진비·적립금 등)
  cost         integer not null default 0,  -- 실원가 합 (원가X수량)
  company      text,                         -- 사업자(참고)
  updated_at   timestamptz not null default now()
);

-- 기존 테이블에 amount 컬럼이 없으면 추가 (이미 실행한 사용자 대상 · 재실행 안전)
alter table public.order_settlements add column if not exists amount integer not null default 0;

-- anon 읽기/쓰기 (현재 베타 정책과 동일). 민감정보 아님(수수료·원가 집계값).
grant select, insert, update, delete on public.order_settlements to anon;

-- PostgREST 스키마 캐시 새로고침
notify pgrst, 'reload schema';
