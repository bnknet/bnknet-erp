-- 주문 원가(unit_cost) 정정 기록 — 'N개/BN' 등 표기로 1개분 원가만 기록된 주문 61건 (2026-11-12)
-- 배경: 10/30부터 옥션·지마켓 상품명이 'N개/BN' 형식으로 바뀌었는데 변환기가 이 수량을 읽지 못함.
--       담당자가 세트(BOM) 등록으로 대응했으나, 세트 등록 전에 저장된 주문은 단품 1개분 원가가 주문에 고정(unit_cost)됨.
--       토스 세포랩 에코팩 '1박스'(=155ml×4) 8건도 같은 유형(8~9월).
-- 담당자 확인: 실물은 표기대로 출고했고 재고는 당일 수기 조정으로 실사와 일치 → 재고·수량·차감기록은 변경하지 않음.
-- 조치(ERP API로 적용 완료, 주문별 응답 검증): unit_cost = 저장 당시 단품 원가 × 표기 수량(세트 구성 수량).
--       order_change_logs 에 '원가정정' 61건 기록(changed_by='시스템(원가정정 11-12)').
-- 결과(공헌이익): 8월 BNKNET −194,765 / 9월 BNKNET −681,679 / 11월 BNKNET −775,704 / 11월 더블아이 −87,273.
--       10/30 세포랩 30ml 2개/BN 6건은 10월 정산 반영 주문이라 원가가 정산 파일값 → 10월 공헌이익 변화 없음.
-- 아래는 적용 내역(기록용). 이미 반영됐으므로 실행할 필요 없음.

-- 2026-08-20 2157023046 BNKNET 토스쇼핑 | 세포랩 바이오제닉 에센스 하이드레이션 에코팩 리뉴얼 155ml 4개 | ×4 | 35707 → 142828
-- 2026-08-24 2157855410 BNKNET 토스쇼핑 | 세포랩 바이오제닉 에센스 하이드레이션 에코팩 리뉴얼 155ml 4개 | ×4 | 35707 → 142828
-- 2026-09-15 2162795159 BNKNET 토스쇼핑 | 세포랩 바이오제닉 에센스 하이드레이션 에코팩 리뉴얼 155ml 4개 | ×4 | 35707 → 142828
-- 2026-09-17 2163381790 BNKNET 토스쇼핑 | 세포랩 바이오제닉 에센스 하이드레이션 에코팩 리뉴얼 155ml 4개 | ×4 | 35707 → 142828
-- 2026-09-17 2163381789 BNKNET 토스쇼핑 | 세포랩 바이오제닉 에센스 하이드레이션 에코팩 리뉴얼 155ml 4개 | ×4 | 35707 → 142828
-- 2026-09-21 2164003999 BNKNET 토스쇼핑 | 세포랩 바이오제닉 에센스 하이드레이션 에코팩 리뉴얼 155ml 4개 | ×4 | 35707 → 142828
-- 2026-09-21 2164003998 BNKNET 토스쇼핑 | 세포랩 바이오제닉 에센스 하이드레이션 에코팩 리뉴얼 155ml 4개 | ×4 | 35707 → 142828
-- 2026-09-28 2164859211 BNKNET 토스쇼핑 | 세포랩 바이오제닉 에센스 하이드레이션 에코팩 리뉴얼 155ml 4개 | ×4 | 35707 → 142828
-- 2026-10-30 2170999488 BNKNET ESM지마켓 | 세포랩 바이오제닉스 에센스 클렙스 여행용 오리지널 90% 30ml 2개/BN | ×2 | null → 15070
-- 2026-10-30 2170999460 BNKNET ESM옥션 | 세포랩 바이오제닉스 에센스 클렙스 여행용 오리지널 90% 30ml 2개/BN | ×2 | null → 15070
-- 2026-10-30 2170999459 BNKNET ESM옥션 | 세포랩 바이오제닉스 에센스 클렙스 여행용 오리지널 90% 30ml 2개/BN | ×2 | null → 15070
-- 2026-10-30 2170999461 BNKNET ESM옥션 | 세포랩 바이오제닉스 에센스 클렙스 여행용 오리지널 90% 30ml 2개/BN | ×2 | null → 15070
-- 2026-10-30 2170999487 BNKNET ESM지마켓 | 세포랩 바이오제닉스 에센스 클렙스 여행용 오리지널 90% 30ml 2개/BN | ×2 | null → 15070
-- 2026-10-30 2171135334 BNKNET ESM지마켓 | 세포랩 바이오제닉스 에센스 클렙스 여행용 오리지널 90% 30ml 2개/BN | ×2 | 7535 → 15070
-- 2026-11-02 2171446186 BNKNET ESM지마켓 | 세포랩 바이오제닉 에센스 클렙스 오리지널 90% 155ml 4개 / BNK | ×4 | null → 155076
-- 2026-11-02 2171446117 BNKNET ESM지마켓 | 세포랩 바이오제닉 에센스 클렙스 오리지널 90% 155ml 4개 / BNK | ×4 | null → 155076
-- 2026-11-02 2171446188 BNKNET ESM지마켓 | 세포랩 바이오제닉 에센스 클렙스 오리지널 90% 155ml 4개 / BNK | ×4 | null → 155076
-- 2026-11-02 2171446190 BNKNET ESM지마켓 | 세포랩 바이오제닉스 에센스 클렙스 여행용 오리지널 90% 30ml 2개/BN | ×2 | 7535 → 15070
-- 2026-11-02 2171445893 BNKNET ESM옥션 | 세포랩 바이오제닉스 에센스 클렙스 여행용 오리지널 90% 30ml 2개/BN | ×2 | 7535 → 15070
-- 2026-11-02 2171446185 BNKNET ESM지마켓 | 세포랩 바이오제닉스 에센스 클렙스 여행용 오리지널 90% 30ml 4개/BN | ×4 | null → 30140
-- 2026-11-02 2171446171 BNKNET ESM지마켓 | 세포랩 바이오제닉스 에센스 클렙스 여행용 오리지널 90% 30ml 4개/BN | ×4 | null → 30140
-- 2026-11-02 2171446168 BNKNET ESM지마켓 | 세포랩 바이오제닉스 에센스 클렙스 여행용 오리지널 90% 30ml 4개/BN | ×4 | null → 30140
-- 2026-11-02 2171463099 더블아이 ESM옥션 | 더마클라센 시노덤 리페어 헤어팩 두피케어 300ml 2개 / BN | ×2 | null → 24000
-- 2026-11-03 2171690961 BNKNET ESM지마켓 | 세포랩 바이오제닉스 에센스 클렙스 여행용 오리지널 90% 30ml 2개/BN | ×2 | 7535 → 15070
-- 2026-11-03 2171690986 BNKNET ESM지마켓 | 세포랩 바이오제닉스 에센스 클렙스 여행용 오리지널 90% 30ml 2개/BN | ×2 | 7535 → 15070
-- 2026-11-03 2171690979 BNKNET ESM지마켓 | 세포랩 바이오제닉스 에센스 클렙스 여행용 오리지널 90% 30ml 2개/BN | ×2 | 7535 → 15070
-- 2026-11-03 2171880717 BNKNET ESM지마켓 | 세포랩 바이오제닉스 에센스 클렙스 여행용 오리지널 90% 30ml 2개/BN | ×2 | 7535 → 15070
-- 2026-11-03 2171880722 BNKNET ESM지마켓 | 세포랩 바이오제닉스 에센스 클렙스 여행용 오리지널 90% 30ml 2개/BN | ×2 | 7535 → 15070
-- 2026-11-03 2171880698 BNKNET ESM옥션 | 세포랩 바이오제닉스 에센스 클렙스 여행용 오리지널 90% 30ml 2개/BN | ×2 | 7535 → 15070
-- 2026-11-04 2171943966 BNKNET ESM지마켓 | 세포랩 바이오제닉 에센스 클렙스 오리지널 90% 100ml 2개/BN | ×2 | null → 50046
-- 2026-11-04 2171943970 BNKNET ESM지마켓 | 세포랩 바이오제닉 에센스 클렙스 오리지널 90% 100ml 2개/BN | ×2 | null → 50046
-- 2026-11-04 2171943982 BNKNET ESM지마켓 | 세포랩 바이오제닉 에센스 클렙스 오리지널 90% 155ml 4개 / BNK | ×4 | 38929 → 155716
-- 2026-11-04 2171943978 BNKNET ESM지마켓 | 세포랩 바이오제닉 에센스 클렙스 오리지널 90% 155ml 4개 / BNK | ×4 | 38929 → 155716
-- 2026-11-04 2171943984 BNKNET ESM지마켓 | 세포랩 바이오제닉스 에센스 클렙스 여행용 오리지널 90% 30ml 2개/BN | ×2 | 7535 → 15070
-- 2026-11-04 2171943878 BNKNET ESM옥션 | 세포랩 바이오제닉스 에센스 클렙스 여행용 오리지널 90% 30ml 2개/BN | ×2 | 7535 → 15070
-- 2026-11-04 2171943983 BNKNET ESM지마켓 | 세포랩 바이오제닉스 에센스 클렙스 여행용 오리지널 90% 30ml 2개/BN | ×2 | 7535 → 15070
-- 2026-11-04 2171943969 BNKNET ESM지마켓 | 세포랩 바이오제닉스 에센스 클렙스 여행용 오리지널 90% 30ml 4개/BN | ×4 | 7535 → 30140
-- 2026-11-04 2171943981 BNKNET ESM지마켓 | 세포랩 바이오제닉스 에센스 클렙스 여행용 오리지널 90% 30ml 2개/BN | ×2 | 7535 → 15070
-- 2026-11-04 2171956184 더블아이 ESM옥션 | 더마클라센 시노덤 리페어 헤어팩 두피케어 300ml 2개 / BN | ×2 | 12000 → 24000
-- 2026-11-04 2172116377 BNKNET ESM지마켓 | 세포랩 바이오제닉 에센스 클렙스 오리지널 90% 100ml 2개/BN | ×2 | 25115 → 50230
-- 2026-11-04 2172116382 BNKNET ESM지마켓 | 세포랩 바이오제닉 에센스 클렙스 오리지널 90% 100ml 2개/BN | ×2 | 25115 → 50230
-- 2026-11-04 2172116372 BNKNET ESM지마켓 | 세포랩 바이오제닉 에센스 클렙스 오리지널 90% 155ml 4개 / BNK | ×4 | 38929 → 155716
-- 2026-11-04 2172116370 BNKNET ESM지마켓 | 세포랩 바이오제닉스 에센스 클렙스 여행용 오리지널 90% 30ml 2개/BN | ×2 | 7535 → 15070
-- 2026-11-04 2172116123 BNKNET ESM옥션 | 세포랩 바이오제닉스 에센스 클렙스 여행용 오리지널 90% 30ml 2개/BN | ×2 | 7535 → 15070
-- 2026-11-04 2172116374 BNKNET ESM지마켓 | 세포랩 바이오제닉스 에센스 클렙스 여행용 오리지널 90% 30ml 4개/BN | ×4 | 7535 → 30140
-- 2026-11-05 2172178270 BNKNET ESM지마켓 | 세포랩 바이오제닉스 에센스 클렙스 여행용 오리지널 90% 30ml 4개/BN | ×4 | 7535 → 30140
-- 2026-11-05 2172178272 BNKNET ESM지마켓 | 세포랩 바이오제닉스 에센스 클렙스 여행용 오리지널 90% 30ml 2개/BN | ×2 | 7535 → 15070
-- 2026-11-05 2172178210 BNKNET ESM옥션 | 세포랩 바이오제닉스 에센스 클렙스 여행용 오리지널 90% 30ml 2개/BN | ×2 | 7535 → 15070
-- 2026-11-05 2172178211 BNKNET ESM옥션 | 세포랩 바이오제닉스 에센스 클렙스 여행용 오리지널 90% 30ml 2개/BN | ×2 | 7535 → 15070
-- 2026-11-05 2172178271 BNKNET ESM지마켓 | 세포랩 바이오제닉스 에센스 클렙스 여행용 오리지널 90% 30ml 2개/BN | ×2 | 7535 → 15070
-- 2026-11-05 2172329855 BNKNET ESM지마켓 | 세포랩 바이오제닉 에센스 클렙스 오리지널 90% 155ml 4개 / BNK | ×4 | 38769 → 155076
-- 2026-11-05 2172333179 더블아이 ESM옥션 | 더마클라센 시노덤 리페어 헤어팩 두피케어 300ml 2개 / BN | ×2 | 12000 → 24000
-- 2026-11-05 2172333299 더블아이 쿠팡 | 본사직영 리포좀 효모발효 NMN l 엔엠엔 l 파이토에스 울트라 X 필름, 5세트, 30회분 | ×5 | null → 61930
-- 2026-11-09 2172718175 BNKNET ESM지마켓 | 세포랩 바이오제닉 에센스 클렙스 오리지널 90% 100ml 2개/BN | ×2 | 25023 → 50046
-- 2026-11-09 2172718157 BNKNET ESM지마켓 | 세포랩 바이오제닉 에센스 클렙스 오리지널 90% 100ml 2개/BN | ×2 | 25023 → 50046
-- 2026-11-09 2172751320 더블아이 ESM옥션 | 더마클라센 시노덤 리페어 헤어팩 두피케어 300ml 2개 / BN | ×2 | 12000 → 24000
-- 2026-11-09 2172751337 더블아이 ESM옥션 | 더마클라센 시노덤 리페어 헤어팩 두피케어 300ml 2개 / BN | ×2 | 12000 → 24000
-- 2026-11-09 2172751331 더블아이 ESM옥션 | 더마클라센 시노덤 리페어 헤어팩 두피케어 300ml 2개 / BN | ×2 | 12000 → 24000
-- 2026-11-10 2173156156 더블아이 ESM옥션 | 더마클라센 시노덤 리페어 헤어팩 두피케어 300ml 2개 / BN | ×2 | 12000 → 24000
-- 2026-11-11 2173431623 더블아이 ESM옥션 | 더마클라센 시노덤 리페어 헤어팩 두피케어 300ml 2개 / BN | ×2 | 12000 → 24000
-- 2026-11-11 2173431622 더블아이 ESM옥션 | 더마클라센 시노덤 리페어 헤어팩 두피케어 300ml 2개 / BN | ×2 | 12000 → 24000

-- ─────────────────────────────────────────────────────────────
-- 되돌릴 때만 실행 (정정 전 값으로 복원)
-- ─────────────────────────────────────────────────────────────
/*
update orders set unit_cost = 35707 where id = 24776 and unit_cost = 142828;
update orders set unit_cost = 35707 where id = 27257 and unit_cost = 142828;
update orders set unit_cost = 35707 where id = 39729 and unit_cost = 142828;
update orders set unit_cost = 35707 where id = 40554 and unit_cost = 142828;
update orders set unit_cost = 35707 where id = 40555 and unit_cost = 142828;
update orders set unit_cost = 35707 where id = 41431 and unit_cost = 142828;
update orders set unit_cost = 35707 where id = 41432 and unit_cost = 142828;
update orders set unit_cost = 35707 where id = 43288 and unit_cost = 142828;
update orders set unit_cost = null where id = 60639 and unit_cost = 15070;
update orders set unit_cost = null where id = 60640 and unit_cost = 15070;
update orders set unit_cost = null where id = 60641 and unit_cost = 15070;
update orders set unit_cost = null where id = 60642 and unit_cost = 15070;
update orders set unit_cost = null where id = 60643 and unit_cost = 15070;
update orders set unit_cost = 7535 where id = 60819 and unit_cost = 15070;
update orders set unit_cost = null where id = 61808 and unit_cost = 155076;
update orders set unit_cost = null where id = 61809 and unit_cost = 155076;
update orders set unit_cost = null where id = 61810 and unit_cost = 155076;
update orders set unit_cost = 7535 where id = 61816 and unit_cost = 15070;
update orders set unit_cost = 7535 where id = 61817 and unit_cost = 15070;
update orders set unit_cost = null where id = 61818 and unit_cost = 30140;
update orders set unit_cost = null where id = 61819 and unit_cost = 30140;
update orders set unit_cost = null where id = 61820 and unit_cost = 30140;
update orders set unit_cost = null where id = 61917 and unit_cost = 24000;
update orders set unit_cost = 7535 where id = 62595 and unit_cost = 15070;
update orders set unit_cost = 7535 where id = 62596 and unit_cost = 15070;
update orders set unit_cost = 7535 where id = 62597 and unit_cost = 15070;
update orders set unit_cost = 7535 where id = 62862 and unit_cost = 15070;
update orders set unit_cost = 7535 where id = 62863 and unit_cost = 15070;
update orders set unit_cost = 7535 where id = 62865 and unit_cost = 15070;
update orders set unit_cost = null where id = 63262 and unit_cost = 50046;
update orders set unit_cost = null where id = 63263 and unit_cost = 50046;
update orders set unit_cost = 38929 where id = 63267 and unit_cost = 155716;
update orders set unit_cost = 38929 where id = 63268 and unit_cost = 155716;
update orders set unit_cost = 7535 where id = 63269 and unit_cost = 15070;
update orders set unit_cost = 7535 where id = 63270 and unit_cost = 15070;
update orders set unit_cost = 7535 where id = 63271 and unit_cost = 15070;
update orders set unit_cost = 7535 where id = 63272 and unit_cost = 30140;
update orders set unit_cost = 7535 where id = 63273 and unit_cost = 15070;
update orders set unit_cost = 12000 where id = 63293 and unit_cost = 24000;
update orders set unit_cost = 25115 where id = 63620 and unit_cost = 50230;
update orders set unit_cost = 25115 where id = 63621 and unit_cost = 50230;
update orders set unit_cost = 38929 where id = 63622 and unit_cost = 155716;
update orders set unit_cost = 7535 where id = 63625 and unit_cost = 15070;
update orders set unit_cost = 7535 where id = 63626 and unit_cost = 15070;
update orders set unit_cost = 7535 where id = 63627 and unit_cost = 30140;
update orders set unit_cost = 7535 where id = 63993 and unit_cost = 30140;
update orders set unit_cost = 7535 where id = 63994 and unit_cost = 15070;
update orders set unit_cost = 7535 where id = 63995 and unit_cost = 15070;
update orders set unit_cost = 7535 where id = 63996 and unit_cost = 15070;
update orders set unit_cost = 7535 where id = 63997 and unit_cost = 15070;
update orders set unit_cost = 38769 where id = 64321 and unit_cost = 155076;
update orders set unit_cost = 12000 where id = 64340 and unit_cost = 24000;
update orders set unit_cost = null where id = 64345 and unit_cost = 61930;
update orders set unit_cost = 25023 where id = 66502 and unit_cost = 50046;
update orders set unit_cost = 25023 where id = 66503 and unit_cost = 50046;
update orders set unit_cost = 12000 where id = 66606 and unit_cost = 24000;
update orders set unit_cost = 12000 where id = 66608 and unit_cost = 24000;
update orders set unit_cost = 12000 where id = 66611 and unit_cost = 24000;
update orders set unit_cost = 12000 where id = 67620 and unit_cost = 24000;
update orders set unit_cost = 12000 where id = 68224 and unit_cost = 24000;
update orders set unit_cost = 12000 where id = 68226 and unit_cost = 24000;
delete from order_change_logs where action = '원가정정' and changed_by = '시스템(원가정정 11-12)';
*/
