-- 자동출고 알림 → Slack 전송 (ship_alerts INSERT 시 트리거로 pg_net.http_post)
-- 선행: db/ship_alerts.sql 실행 완료 + pg_net 확장 활성화 + Slack Incoming Webhook URL 발급
--
-- ⚠️ 아래 v_url 의 'PASTE_SLACK_WEBHOOK_URL_HERE' 를 실제 Webhook URL로 바꿔서 Supabase SQL Editor에서 실행.
--    (실제 URL은 보안상 repo에 커밋하지 말 것 — Supabase에서만 입력)

-- pg_net 확장 (이미 있으면 무시)
create extension if not exists pg_net with schema extensions;

create or replace function public.notify_ship_alert_slack()
returns trigger
language plpgsql
security definer
as $$
declare
  v_url  text := 'PASTE_SLACK_WEBHOOK_URL_HERE';  -- ← Slack Webhook URL 붙여넣기
  v_kind text;
  v_msg  text;
begin
  v_kind := case new.kind
    when 'unmatched' then '재고 미매칭'
    when 'negative'  then '재고 부족(마이너스)'
    when 'rpc_fail'  then '자동출고 실패'
    else new.kind end;

  v_msg := ':warning: *BNKnet ERP 자동출고 알림*' || chr(10)
        || '• 사업자: ' || coalesce(new.company, '미지정') || chr(10)
        || '• 구분: ' || v_kind || chr(10)
        || '• 내용: ' || coalesce(new.detail, '') || chr(10)
        || '• 등록: ' || coalesce(new.created_by, '') || ' / ' || to_char(now() at time zone 'Asia/Seoul', 'MM-DD HH24:MI');

  -- URL 미설정 시 아무것도 안 함(에러 없음)
  if v_url like 'https://hooks.slack.com/%' then
    perform net.http_post(
      url     := v_url,
      headers := '{"Content-Type":"application/json"}'::jsonb,
      body    := jsonb_build_object('text', v_msg)
    );
  end if;

  return new;
end;
$$;

drop trigger if exists trg_ship_alert_slack on public.ship_alerts;
create trigger trg_ship_alert_slack
  after insert on public.ship_alerts
  for each row execute function public.notify_ship_alert_slack();

notify pgrst, 'reload schema';

-- 테스트: 아래 INSERT 실행 → Slack 채널에 알림 오면 성공 (확인 후 행 삭제)
-- insert into public.ship_alerts (company, kind, detail, order_count, created_by)
--   values ('BNKNET','unmatched','테스트 알림 - 비타민C(2개)',1,'테스트');
