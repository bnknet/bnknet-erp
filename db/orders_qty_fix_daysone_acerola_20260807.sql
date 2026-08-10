-- 더블아이(ESM지마켓/옥션) 데이즈온 그린 아세로라C 주문 수량 보정
-- 원인: 수집상품명이 "…분말 N개 BN" 형태(수량 뒤에 'BN' 꼬리표)라 끝-앵커 정규식이 수량을 못 잡아
--       모두 수량 1로 저장됨. 코드는 정규식 보강으로 수정(이후 변환분은 정상). 이 SQL은 이미 저장된 8건 보정.
--
-- 주의: collect_quantity(수집수량=1)는 그대로 두고, quantity(주문수량*EA)만 실제 개수로 보정.
-- 재실행 안전(멱등): 주문번호로 값 직접 지정.

-- 1) 확인용 SELECT (현재 quantity 확인)
select order_number, recipient_name, mall_name, quantity, collect_product
from orders
where order_number in (
  '2154974008','2154973989','2154973993','2154974016',
  '2154974014','2154974007','2154974015','2154974013'
)
order by order_number;

-- 2) 수량 보정 UPDATE
update orders set quantity = 2 where order_number = '2154974008'; -- 조진희 · 2개
update orders set quantity = 3 where order_number = '2154973989'; -- 차준호 · 3개
update orders set quantity = 3 where order_number = '2154973993'; -- 정용기 · 3개
update orders set quantity = 3 where order_number = '2154974016'; -- 김수경 · 3개
update orders set quantity = 4 where order_number = '2154974014'; -- 김명희 · 4개
update orders set quantity = 4 where order_number = '2154974007'; -- 파크드림 · 4개
update orders set quantity = 6 where order_number = '2154974015'; -- 강숙진 · 6개
update orders set quantity = 6 where order_number = '2154974013'; -- 장윤영 · 6개
