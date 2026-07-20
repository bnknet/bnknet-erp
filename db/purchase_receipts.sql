-- 발주 입고 기록: 승인된 발주서(approvals.doc_type='발주서')에 대해
-- "언제 몇 개 입고됐는지"를 누적 기록. 부분입고(여러 번 나눠 입고) 지원.
-- 입고 등록 시 재고(inventory_logs 입고)에도 자동 반영하며, 되돌릴 수 있게 log id를 함께 보관.
create table if not exists public.purchase_receipts (
  id uuid primary key default gen_random_uuid(),
  approval_id uuid not null references public.approvals(id) on delete cascade,   -- 발주서
  approval_item_id uuid,          -- 발주서 품목 라인(approval_items.id). 없으면 발주 전체 대상
  inventory_id uuid,              -- 연결한 재고 품목(inventory.id). null이면 재고 미반영(트래킹만)
  inventory_log_id uuid,          -- 입고 시 생성한 inventory_logs.id (삭제 시 원복용)
  product_name text,              -- 입고 품목명(스냅샷)
  received_date date not null,    -- 입고일
  received_qty integer not null,  -- 입고 수량
  memo text,
  created_by text,
  created_at timestamptz not null default now()
);

create index if not exists idx_purchase_receipts_approval on public.purchase_receipts(approval_id);
create index if not exists idx_purchase_receipts_item on public.purchase_receipts(approval_item_id);
