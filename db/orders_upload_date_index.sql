-- 매출현황 로딩 속도 개선 (시간이 지나도 느려지지 않게)
-- 매출현황·대시보드·주문조회는 upload_date로 기간 필터(최근 3개월 등)를 건다.
-- 인덱스가 없으면 전체 orders 테이블을 매번 스캔 → 데이터가 쌓일수록 점점 느려짐.
-- upload_date 인덱스를 추가하면 필요한 기간만 바로 조회 → 총 데이터량과 무관하게 빠름.
--
-- ※ create index는 잠깐 테이블 잠금이 걸립니다(수 초). 트래픽 적은 시간에 실행 권장.
--   대용량이라 잠금이 부담되면 아래 concurrently 버전을 대신 쓰세요(트랜잭션 밖에서 단독 실행).
--   create index concurrently if not exists orders_upload_date_idx on public.orders (upload_date);

create index if not exists orders_upload_date_idx on public.orders (upload_date);

-- 사업자별 기간 조회도 잦으므로 복합 인덱스도 함께(선택). company 필터+기간에 유리.
create index if not exists orders_company_upload_date_idx on public.orders (company, upload_date);

-- PostgREST 스키마 캐시 새로고침
notify pgrst, 'reload schema';
