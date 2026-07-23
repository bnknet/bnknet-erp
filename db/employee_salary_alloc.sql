-- 사업자별 급여 배분 (한 사람이 두 곳 이상에서 나눠 급여를 받는 경우)
-- 값 예시: {"BNKNET": 60000000, "IX글로벌": 63818160}  (연 기준 금액)
-- 배분이 있으면 영업이익 탭 인건비·4대보험이 이 배분대로 사업자별로 자동 반영된다.
-- (배분이 비어있는 직원은 기존대로 소속 사업자 1곳에 연봉 전액 반영)
alter table public.employees add column if not exists salary_alloc jsonb;

notify pgrst, 'reload schema';
