-- 7/1 정식 가동 전 테스트 데이터 정리 — Supabase SQL Editor에서 "원하는 줄만" 골라 실행
-- ⚠️ DELETE는 되돌리기 어렵습니다. 실행 전 백업(Export CSV) 권장.

-- 1) 행사 및 일정 전체 삭제
delete from public.calendar_events;

-- 2) 직원 출퇴근 내역 전체 삭제
delete from public.attendance;

-- 4) 주문 변환 업로드 이력 삭제
delete from public.order_uploads;

-- 4-2) (선택) 테스트 주문 데이터까지 삭제 → 7/1부터 매출 0에서 시작.
--      "업로드 이력만" 지우려면 아래 줄은 실행하지 마세요.
delete from public.orders;

-- 5) 연차(휴가신청서) 테스트 일정 전체 삭제 → 연차 사용내역 0으로 초기화
--    ※ 직원 부여 연차(employees.annual_leave_total)는 설정값이라 유지됨.
delete from public.approvals where doc_type = '휴가신청서';
