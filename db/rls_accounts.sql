-- 계정 관리(accounts: 외부 서비스 비밀번호) 보호.
-- RLS를 켜고 정책을 두지 않으면 anon(공개 anon 키)·authenticated 역할은 접근 불가.
-- 서버 라우트(/api/accounts)는 service_role 키로 접근 → RLS를 우회하므로 정상 동작.
-- ⚠️ 반드시 배포 후 '계정 관리' 화면이 서버 경유로 정상 표시되는 걸 확인한 뒤 실행할 것.
alter table public.accounts enable row level security;
