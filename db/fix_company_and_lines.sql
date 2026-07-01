-- 사업자 표기 통일 + 결재라인/정리인 보정 (2026-07-01 저녁)
-- 원인: 일부 직원 사업자가 국문(비앤케이넷/에스제이글로벌)으로 등록 → 결재라인 키(BNKNET/SJ글로벌)와 불일치
--       → BNKNET 휴가에 실장 단계 누락. IX 문서 정리인도 작성자명으로 남아있던 것 일괄 정정.
-- Supabase SQL Editor에서 1회 실행.

-- 1) 직원 사업자 표기 영문 코드로 통일 (결재라인·매출집계·근태 등 전반 정상화)
update public.employees set company = 'BNKNET'  where company = '비앤케이넷';
update public.employees set company = 'SJ글로벌' where company = '에스제이글로벌';

-- 2) 기존 결재문서 사업자 표기도 통일 (결재라인 정상 렌더)
update public.approvals set company = 'BNKNET'  where company = '비앤케이넷';
update public.approvals set company = 'SJ글로벌' where company = '에스제이글로벌';

-- 3) 진행중(결재중) BNKNET 휴가신청서에 실장 단계 보정 (누락분)
update public.approvals
   set approver2_name = '실장',
       approver2_status = coalesce(nullif(approver2_status, ''), 'pending')
 where doc_type = '휴가신청서' and company = 'BNKNET'
   and status = 'pending'
   and (approver2_name is null or approver2_name = '');

-- 4) IX글로벌 지출결의서·매입품의서(카드구매) 정리인·영수자 방성훈 일괄 정정
update public.approvals set organizer = '방성훈'
 where company = 'IX글로벌' and doc_type in ('지출결의서', '카드구매');
