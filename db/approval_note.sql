-- 결재 승인 시 선택적 지시·요청사항 메모 (2026-07-02)
-- 승인할 때 추가 지시/요청사항을 남길 수 있게(미입력해도 승인됨). 다단계 결재 시 승인자별로 누적.
-- Supabase SQL Editor에서 1회 실행.

alter table public.approvals add column if not exists approval_note text;
