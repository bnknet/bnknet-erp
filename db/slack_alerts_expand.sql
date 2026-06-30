-- Slack 알림 확장 — 결재 상신 / 재고 부족 / 매출 이상
-- 선행: db/ship_alerts.sql 실행 완료 + pg_net 활성화 + Slack Webhook URL 발급
--
-- ⚠️ 아래 slack_notify 함수의 v_url 에 실제 Webhook URL을 넣고 Supabase SQL Editor에서 실행.
--    (URL은 한 곳(slack_notify)에서만 관리 → 나중에 바꿀 때 여기만 고치면 됨)

create extension if not exists pg_net with schema extensions;

-- ── 0) 공용 Slack 전송 함수 (URL은 여기 한 곳만) ───────────────────
create or replace function public.slack_notify(p_text text)
returns void
language plpgsql
security definer
as $$
declare
  v_url text := 'PASTE_SLACK_WEBHOOK_URL_HERE';  -- ← Slack Webhook URL
begin
  if v_url like 'https://hooks.slack.com/%' then
    perform net.http_post(
      url     := v_url,
      headers := '{"Content-Type":"application/json"}'::jsonb,
      body    := jsonb_build_object('text', p_text)
    );
  end if;
end;
$$;

-- ── 1) 자동출고 알림(ship_alerts)도 공용 함수 경유로 통일 ───────────
create or replace function public.notify_ship_alert_slack()
returns trigger
language plpgsql
security definer
as $$
declare v_kind text;
begin
  v_kind := case new.kind
    when 'unknown_product' then '인식 못한 상품(매칭데이터 추가 필요)'
    when 'unmatched' then '재고 미매칭'
    when 'negative'  then '재고 부족(마이너스)'
    when 'rpc_fail'  then '자동출고 실패'
    else new.kind end;
  perform public.slack_notify(
    ':warning: *BNKnet ERP 자동출고 알림*' || chr(10)
    || '• 사업자: ' || coalesce(new.company, '미지정') || chr(10)
    || '• 구분: ' || v_kind || chr(10)
    || '• 내용: ' || coalesce(new.detail, '') || chr(10)
    || '• 등록: ' || coalesce(new.created_by, '') || ' / ' || to_char(now() at time zone 'Asia/Seoul', 'MM-DD HH24:MI')
  );
  return new;
end;
$$;
-- (트리거는 ship_alerts.sql에서 이미 생성됨)

-- ── 2) 결재 상신 알림 (approvals INSERT) ───────────────────────────
create or replace function public.notify_approval_slack()
returns trigger
language plpgsql
security definer
as $$
declare v_doc text;
begin
  v_doc := case new.doc_type
    when '카드구매' then '매입품의서(카드구매)'
    when '지출결의서' then '지출결의서'
    when '휴가신청서' then '휴가신청서'
    else coalesce(new.doc_type, '문서') end;
  perform public.slack_notify(
    ':memo: *새 결재 상신*' || chr(10)
    || '• 문서: ' || v_doc || chr(10)
    || '• 사업자: ' || coalesce(new.company, '-') || chr(10)
    || '• 상신자: ' || coalesce(new.submitter_name, '-')
    || case when coalesce(new.total_amount,0) > 0
            then chr(10) || '• 금액: ' || to_char(new.total_amount, 'FM999,999,999') || '원' else '' end
  );
  return new;
end;
$$;

drop trigger if exists trg_approval_slack on public.approvals;
create trigger trg_approval_slack
  after insert on public.approvals
  for each row execute function public.notify_approval_slack();

-- ── 3) 재고 부족 경고 (inventory UPDATE — 임계치 이하로 떨어질 때) ──
-- 임계치(아래 5)는 자유롭게 조정. old > 임계치 → new <= 임계치 로 "내려가는 순간"만 알림(중복 방지).
create or replace function public.notify_low_stock_slack()
returns trigger
language plpgsql
security definer
as $$
declare v_threshold int := 5;  -- ← 재고 부족 기준(개). 필요시 변경.
begin
  if coalesce(old.quantity, 0) > v_threshold and coalesce(new.quantity, 0) <= v_threshold then
    perform public.slack_notify(
      ':package: *재고 부족 경고*' || chr(10)
      || '• 상품: ' || coalesce(new.product_name, '-') || chr(10)
      || '• 사업자: ' || coalesce(new.company, '-') || chr(10)
      || '• 남은 수량: ' || coalesce(new.quantity, 0) || '개'
    );
  end if;
  return new;
end;
$$;

drop trigger if exists trg_low_stock_slack on public.inventory;
create trigger trg_low_stock_slack
  after update of quantity on public.inventory
  for each row execute function public.notify_low_stock_slack();

-- ── 4) 매출 이상 징후 (매일 점검 — pg_cron 필요) ───────────────────
-- "오늘 주문은 있는데 매출 합계가 0원" → 데이터 이상. 매일 20:00(KST) 점검.
create or replace function public.check_sales_anomaly()
returns void
language plpgsql
security definer
as $$
declare v_cnt int; v_sum numeric;
begin
  select count(*), coalesce(sum(amount), 0) into v_cnt, v_sum
  from public.orders
  where upload_date = (now() at time zone 'Asia/Seoul')::date
    and coalesce(canceled, false) = false;
  if v_cnt > 0 and v_sum = 0 then
    perform public.slack_notify(
      ':rotating_light: *매출 이상 징후* — 오늘 주문 ' || v_cnt || '건인데 매출이 0원입니다. 데이터 점검이 필요합니다.'
    );
  end if;
end;
$$;

-- pg_cron 등록 (Supabase 대시보드에서 pg_cron 확장 활성화 필요)
-- 이미 같은 이름 잡이 있으면 unschedule 후 재등록
create extension if not exists pg_cron;
select cron.unschedule('erp-sales-anomaly') where exists (select 1 from cron.job where jobname = 'erp-sales-anomaly');
select cron.schedule('erp-sales-anomaly', '0 11 * * *', 'select public.check_sales_anomaly();');  -- 11:00 UTC = 20:00 KST

notify pgrst, 'reload schema';

-- ── 테스트 ─────────────────────────────────────────────────────────
-- 결재:   insert into public.approvals (doc_type, company, submitter_name, total_amount, status) values ('지출결의서','BNKNET','테스트',50000,'pending');
-- 매출이상: select public.check_sales_anomaly();
-- 재고부족: 재고 수량을 5 이하로 떨어뜨리는 update 발생 시 자동
-- 확인 후 테스트 데이터 삭제: delete from public.approvals where submitter_name='테스트';
