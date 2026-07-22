-- 직원 로그인 비밀번호 보호. employees.password_hash(공개 anon 키로 조회 가능)를
-- RLS로 잠긴 별도 테이블로 옮긴다. 검증·변경은 서버(service_role) 라우트에서만.
--
-- [1단계] 이 파일 실행 — 추가만 하므로 앱 동작에 영향 없음(기존 로그인 그대로).
create table if not exists public.employee_secrets (
  employee_id uuid primary key references public.employees(id) on delete cascade,
  password_hash text,
  updated_at timestamptz not null default now()
);

-- 기존 비밀번호 복사
insert into public.employee_secrets (employee_id, password_hash)
select id, password_hash from public.employees where password_hash is not null
on conflict (employee_id) do nothing;

-- RLS 활성화 + 정책 없음 → anon/authenticated 접근 불가, service_role(서버)만 접근.
alter table public.employee_secrets enable row level security;

-- [2단계] 배포 후 로그인/비번변경이 서버 경유로 정상 동작하는 걸 확인한 뒤 아래를 실행:
--   update public.employees set password_hash = null;
-- 그러면 공개 anon 키로는 더 이상 어떤 직원 비밀번호도 조회할 수 없다.
