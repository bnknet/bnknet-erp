-- 선결제 오상신 정리 v2 — 부분취소 수정판 (2026-08-21)
-- v1 오류: approval_items.item_date가 날짜형이 아니라 자유 텍스트('06/28','07월10일')여서
--          'YYYY-MM-DD' 비교가 ①에서는 전부 참(전체 삭제·연회비 소실), ②④⑨에서는 전부 거짓(미삭제)이 됨.
-- 조치: ① 연회비 품목 백업으로 복원 / ②④⑨ 품목 id 직접 지정 삭제 / 총액 재계산.
-- 참고: ④의 '769,558'은 실데이터 769,482(덴프스 7개)로 확인되어 그 품목을 삭제.

-- F1. ① 방기현 현대(포) 연회비 복원
insert into approval_items (id, approval_id, item_date, description, amount, sort_order, quantity, canceled)
values ('f63d9eb0-0705-475d-84f2-f29f687742f2','09d58b1b-c8bf-49f2-af4b-6076fa76b9ab',
        '06/28','블루월넛(주) - (주)대한항공_연회비',39200,0,1,false)
on conflict (id) do nothing;

-- F2. ②④⑨ 지정 품목 삭제 (id 기준)
delete from approval_items where id in (
'd17c4b83-769e-41f3-a7bb-94a97fdc848c','b59d69eb-f32a-4264-a273-215f1d94e631',                -- ② 국민 668,660×2
'bdf09a3d-7497-4e03-bcfa-e15118ab5249','def4b2bf-70f0-4f63-9de4-ca9f3770515e','909885af-1cd0-44e8-b6ec-4bf6c978bb56', -- ④ 롯데 덴프스 3건
'184a2ddc-f0d2-4fde-af8f-248f4489834a','d5799678-b766-4e38-922a-5d0e1769eeb3','a600702e-16b8-4678-8d99-a53689e4c84c','dd534089-f33c-4581-9e70-ca1dbd6e7305', -- ④ 롯데 668,660×4
'5d320bc8-fd95-4ae2-93d8-a2e0c3e13da0','8e497b32-2984-4d72-a65f-ed6c23476077','34c2faa1-0c54-4b8f-af2b-da07aef35005'  -- ⑨ 국민포 3건
);

-- F3. 총액 재계산
update approvals a
set total_amount = coalesce((select sum(i.amount) from approval_items i where i.approval_id = a.id), 0),
    updated_at = now()
where a.id in ('09d58b1b-c8bf-49f2-af4b-6076fa76b9ab','48808534-1ddc-4147-b4bc-467017a675bf',
               '771079ab-614f-454f-892c-7869cd732ab8','4ac2ed6a-8237-4cc3-bcca-62e2b6f86c4f');

-- F4. 검증 기대값: 09d58b1b=39,200 / 48808534=4,937,840 / 771079ab=1,771,030 / 4ac2ed6a=14,454,022
--     + 전체취소 9건 잔존수 0 확인.
