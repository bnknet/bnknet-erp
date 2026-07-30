-- 업무일지 항목별 첨부파일 저장용 컬럼
-- in_progress / planned / notes 각 항목별 첨부파일 목록을 jsonb로 저장
alter table public.worklogs add column if not exists attachments jsonb;

-- PostgREST 스키마 캐시 리로드
notify pgrst, 'reload schema';
