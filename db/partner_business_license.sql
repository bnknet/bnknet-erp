-- 거래처 사업자등록증 첨부 URL 저장용 컬럼.
-- 거래처 등록/수정 시 사업자등록증 파일을 업로드해 보관(세무·검증용).
alter table public.partners add column if not exists business_license_url text;
