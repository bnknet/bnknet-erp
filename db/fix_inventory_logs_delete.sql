-- inventory_logs 삭제 권한 수정 (2026-06-24)
-- 증상: 입출고 내역 "삭제"를 눌러도 재고 수량만 되돌아가고 로그 행은 안 지워짐.
-- 원인: inventory_logs RLS가 INSERT/SELECT만 허용하고 DELETE 정책이 없어,
--       PostgREST가 204를 반환해도 실제로는 0건 삭제됨(조용한 실패).
-- 조치: anon에 ALL 권한 정책 추가(베타 임시 정책, 정식 권한 전환 시 함께 교체).

drop policy if exists "temp_anon_all_inventory_logs" on public.inventory_logs;
create policy "temp_anon_all_inventory_logs" on public.inventory_logs
  for all to anon using (true) with check (true);

-- 점검용 임시 로그 정리
delete from public.inventory_logs where product_name = '__del_test__';
