-- 카드 06/30 잔여한도 채우기 + 한도 변경 + 신규카드 (끝4자리 매칭)

-- ① 잔여한도(opening_balance) 채우기
update public.cards set opening_balance=133104 where last4='0900';
update public.cards set opening_balance=3497013 where last4='6539';
update public.cards set opening_balance=2066040 where last4='5756';
update public.cards set opening_balance=11899160 where last4='1859';
update public.cards set opening_balance=7513464 where last4='5803';
update public.cards set opening_balance=14136 where last4='6403';
update public.cards set opening_balance=9620866 where last4='9608';
update public.cards set opening_balance=15426170 where last4='3885';
update public.cards set opening_balance=6618 where last4='8081';
update public.cards set opening_balance=12467989 where last4='6006';
update public.cards set opening_balance=6580560 where last4='4220';
update public.cards set opening_balance=511340 where last4='9343';
update public.cards set opening_balance=354502 where last4='7725';
update public.cards set opening_balance=138558 where last4='2447';
update public.cards set opening_balance=2044884 where last4='5341';
update public.cards set opening_balance=4583580 where last4='5053';
update public.cards set opening_balance=6116006 where last4='9303';
update public.cards set opening_balance=177720 where last4='9191';
update public.cards set opening_balance=29361754 where last4='4059';
update public.cards set opening_balance=35920 where last4='1900';
update public.cards set opening_balance=52286 where last4='2772';
update public.cards set opening_balance=0 where last4='5995';
update public.cards set opening_balance=4985540 where last4='0313';
update public.cards set opening_balance=16008185 where last4='9733';
update public.cards set opening_balance=155360 where last4='8183';
update public.cards set opening_balance=1094477 where last4='5074';
update public.cards set opening_balance=12395140 where last4='4155';
update public.cards set opening_balance=10068820 where last4='7865';
update public.cards set opening_balance=10000000 where last4='5693';
update public.cards set opening_balance=20000000 where last4='5870';
update public.cards set opening_balance=3000000 where last4='9172';
update public.cards set opening_balance=5151100 where last4='4802';
update public.cards set opening_balance=14200000 where last4='3244';
update public.cards set opening_balance=18000000 where last4='1002';
update public.cards set opening_balance=30000000 where last4='8909';
update public.cards set opening_balance=30000000 where last4='7317';
update public.cards set opening_balance=5500000 where last4='7608';
update public.cards set opening_balance=11000000 where last4='4047';
update public.cards set opening_balance=19968500 where last4='2013';
update public.cards set opening_balance=3172849 where last4='2706';
update public.cards set opening_balance=2834652 where last4='5644';
update public.cards set opening_balance=2762458 where last4='8822';
update public.cards set opening_balance=7685022 where last4='0799';
update public.cards set opening_balance=2117326 where last4='9761';
update public.cards set opening_balance=489768 where last4='6653';

-- ② 한도 변경(전체한도 갱신)
update public.cards set limit_amount=31000000 where last4='1900';  -- 조현상 현대카드 30,000,000→31,000,000
update public.cards set limit_amount=14000000 where last4='4802';  -- 강웅구 현대카드 13,000,000→14,000,000
update public.cards set limit_amount=18000000 where last4='1002';  -- 강웅구 국민카드 20,000,000→18,000,000
update public.cards set limit_amount=37500000 where last4='0799';  -- 방성훈 우리카드 30,000,000→37,500,000

-- ③ 신규 카드 등록
insert into public.cards (card_name, card_type, holder_name, card_company, last4, limit_amount, opening_balance, billing_day, close_day, is_active, sort_order)
 values ('삼성카드','방성훈카드','방성훈','삼성','5655',34800000,2148678,26,12,true,90);

notify pgrst, 'reload schema';
