-- employees 테이블 RLS 정책 — 앱(anon) 접근 허용 (직원 등록/수정·결재 연차 수정 등 복구)
--
-- 배경: employees는 인사관리·영업이익(인건비)·결재(연차)·로그인 등에서 공개 anon 키로
-- 읽고 쓴다. RLS가 켜졌는데 정책이 없으면 anon 쓰기가 전부 막혀
-- "new row violates row-level security policy for table employees" 에러가 난다.
--
-- 직원 로그인 비밀번호는 이미 employee_secrets(RLS 잠금, service_role만 접근)로 분리 보호됨.
-- 따라서 employees 자체는 앱이 접근하도록 허용한다. (RLS는 켜둔 채로 정책만 부여)
alter table public.employees enable row level security;

drop policy if exists employees_app_access on public.employees;
create policy employees_app_access on public.employees
  for all
  to anon, authenticated
  using (true)
  with check (true);
