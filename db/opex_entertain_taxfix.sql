-- 접대비는 부가세 매입세액 불공제 → 영업이익 계산 시 ÷1.1 하지 않고 지급액 그대로가 비용.
-- 기존에 과세(taxable=true)로 잘못 설정된 접대비 항목을 면세(그대로)로 정정.
update public.opex_category set taxable = false, updated_at = now() where key = 'entertain';
