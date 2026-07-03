-- 공지사항 댓글 — 직원이 공지 글에 댓글을 달 수 있게 (2026-07-03)
-- 등록: 로그인한 직원 누구나. 삭제: 본인 댓글 + 대표·실장(앱단 제어).
-- Supabase SQL Editor에서 1회 실행.

create table if not exists public.notice_comments (
  id          uuid primary key default gen_random_uuid(),
  notice_id   uuid not null,
  author_id   uuid,
  author_name text not null,
  content     text not null,
  created_at  timestamptz not null default now()
);

create index if not exists notice_comments_notice_idx on public.notice_comments (notice_id, created_at);

grant select, insert, delete on public.notice_comments to anon;

notify pgrst, 'reload schema';
