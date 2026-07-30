-- 역할·메뉴별 접근 권한 (권한 관리 화면에서 설정)
-- 한 행 = 해당 role이 해당 href(메뉴)에 접근 허용.
-- 규칙: 대표(ceo)는 항상 전체 접근이라 저장하지 않음. 이 테이블이 비어 있으면 기존 하드코딩 기본값 사용.
create table if not exists public.menu_permissions (
  role text not null,
  href text not null,
  primary key (role, href)
);

notify pgrst, 'reload schema';
