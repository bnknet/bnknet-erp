-- 주영엔에스 오메가3 재고 2건 신규 추가 (2026-07-01, 기존 재고 미변경)
-- 중복 방지: 같은 (상품명+사업자) 없을 때만 insert.

insert into public.products (name, category, brand, company, cost_price, sell_price, unit, is_active)
 select '주영엔에스 식물성 오메가3 600 미니', '건강기능식품', '주영엔에스', 'BNKNET', 0, 0, '개', true
 where not exists (select 1 from public.products where name='주영엔에스 식물성 오메가3 600 미니' and company='BNKNET');
insert into public.inventory (product_name, category, brand, company, cost_price, quantity, unit, is_active)
 select '주영엔에스 식물성 오메가3 600 미니', '건강기능식품', '주영엔에스', 'BNKNET', 0, 1000, '개', true
 where not exists (select 1 from public.inventory where product_name='주영엔에스 식물성 오메가3 600 미니' and company='BNKNET');

insert into public.products (name, category, brand, company, cost_price, sell_price, unit, is_active)
 select '주영엔에스 식물성 오메가3 600 미니', '건강기능식품', '주영엔에스', '더블아이', 0, 0, '개', true
 where not exists (select 1 from public.products where name='주영엔에스 식물성 오메가3 600 미니' and company='더블아이');
insert into public.inventory (product_name, category, brand, company, cost_price, quantity, unit, is_active)
 select '주영엔에스 식물성 오메가3 600 미니', '건강기능식품', '주영엔에스', '더블아이', 0, 1000, '개', true
 where not exists (select 1 from public.inventory where product_name='주영엔에스 식물성 오메가3 600 미니' and company='더블아이');

update public.inventory i set product_id=p.id from public.products p where i.product_id is null and i.product_name=p.name and i.company=p.company;

notify pgrst, 'reload schema';
