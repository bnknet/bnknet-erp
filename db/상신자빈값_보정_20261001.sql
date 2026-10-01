-- 상신자 빈 값 보정 (2026-10-01)
-- 09-30 강웅구 지출결의서(64,322,867)가 세션 유실 상태로 저장돼 submitter_name이 '' →
-- 본인 결재 목록에서 안 보임. 담당자(organizer) 이름으로 복원.
update approvals
set submitter_name = organizer, updated_at = now()
where id = '7d139754-befa-4eb0-9eb7-e8763f13680d'
  and coalesce(submitter_name, '') = '';

-- 같은 증상의 다른 문서가 있는지 확인 (있으면 결과 공유 → 같은 방식으로 보정)
select id, doc_type, status, organizer, company, issue_date, total_amount, created_at
from approvals
where coalesce(submitter_name, '') = ''
order by created_at desc;
