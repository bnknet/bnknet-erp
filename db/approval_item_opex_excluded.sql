-- 영업이익 탭: 결재(지출결의서) 자동연동 판관비 품목을 건별로 계산에서 제외 (2026-09-21)
-- 배경: 지출결의서 품목에 판관비를 태깅하면 영업이익 탭에 자동 합산되는데,
--       건당 택배비처럼 이미 공헌이익에서 차감된 비용은 이중 차감이 됨.
-- 조치: 품목별 제외 플래그. 영업이익 탭 세부내역의 체크박스를 해제하면 true 로 저장되어
--       판관비 합계·영업이익(화면 + 슬랙봇 profit_summary)에서 빠짐. 결재 문서 자체는 변경 없음.
-- 재실행 안전.

alter table public.approval_items add column if not exists opex_excluded boolean not null default false;

notify pgrst, 'reload schema';
