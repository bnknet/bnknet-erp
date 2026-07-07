import { NextRequest, NextResponse } from 'next/server';
import { after } from 'next/server';
import crypto from 'node:crypto';
import Anthropic from '@anthropic-ai/sdk';
import { supabaseFetch } from '@/lib/supabase';

// ── 슬랙 ERP 비서 (MVP) ─────────────────────────────────────────────
// 대표·실장이 슬랙 DM으로 ERP 데이터를 자연어로 물어보면, Claude가
// 읽기 전용 도구로 Supabase를 조회·추론해 답한다.
// 권한: SLACK_ALLOWED_USER_IDS(슬랙 계정 화이트리스트)에 있는 사람만.
// 보안 경계는 프롬프트가 아니라 이 백엔드 — 읽기(GET) 전용, rpc 차단.
export const runtime = 'nodejs';

const SIGNING_SECRET = process.env.SLACK_SIGNING_SECRET || '';
const BOT_TOKEN = process.env.SLACK_BOT_TOKEN || '';
const ALLOWED = (process.env.SLACK_ALLOWED_USER_IDS || '')
  .split(',').map(s => s.trim()).filter(Boolean);
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || '';

// 슬랙 서명 검증 (요청이 실제 슬랙에서 온 것인지 HMAC로 확인)
function verifySlack(raw: string, ts: string, sig: string): boolean {
  if (!SIGNING_SECRET || !ts || !sig) return false;
  // 재전송 공격 방지: 5분 이내 요청만
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 60 * 5) return false;
  const base = `v0:${ts}:${raw}`;
  const mine = 'v0=' + crypto.createHmac('sha256', SIGNING_SECRET).update(base).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(mine), Buffer.from(sig));
  } catch { return false; }
}

async function postSlack(channel: string, text: string) {
  await fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8', Authorization: `Bearer ${BOT_TOKEN}` },
    body: JSON.stringify({ channel, text: text.slice(0, 3800) }),
  });
}

// Claude가 쓰는 유일한 도구: ERP 읽기 전용 조회 (PostgREST GET)
const ERP_TOOL: Anthropic.Tool = {
  name: 'query_erp',
  description:
    'BNKNET ERP 데이터베이스를 읽기 전용으로 조회한다(PostgREST). 매출·재고·주문·근태·인사·결재·공지 등. ' +
    '컬럼이 확실치 않으면 먼저 select=*&limit=1 로 샘플 한 건을 조회해 컬럼을 확인하라. 집계는 조회 후 직접 계산한다.',
  input_schema: {
    type: 'object',
    properties: {
      table: { type: 'string', description: '테이블명(소문자·언더스코어). 예: orders, inventory, employees, product_matches, notices, brand_sales' },
      query: { type: 'string', description: 'PostgREST 쿼리스트링(? 이후). 예: select=product_name,quantity,company&company=eq.BNKNET&order=created_at.desc&limit=50' },
    },
    required: ['table'],
  },
};

// 보안상 봇이 읽으면 안 되는 테이블 (비밀번호 등 민감정보)
const BLOCKED_TABLES = new Set(['accounts', 'rpc']);

async function runQueryErp(input: { table?: string; query?: string }): Promise<string> {
  const table = String(input.table || '').trim();
  if (!/^[a-z_][a-z0-9_]*$/.test(table)) return '오류: 잘못된 테이블명';
  if (BLOCKED_TABLES.has(table)) return `오류: '${table}' 테이블은 보안상 조회할 수 없습니다 (rpc·비밀번호 등)`;
  let q = String(input.query || '').trim();
  if (!q) q = 'select=*&limit=20';
  // 안전장치: 최대 200건으로 제한
  if (!/[?&]?limit=/.test(q)) q += '&limit=200';
  try {
    const res = await supabaseFetch(`/${table}?${q}`, {
      headers: { 'Range-Unit': 'items', Range: '0-199' },
    });
    const txt = await res.text();
    if (!res.ok) return `조회 실패(HTTP ${res.status}): ${txt.slice(0, 500)}`;
    return txt.slice(0, 60000); // 과도한 응답 방지
  } catch (e) {
    return '조회 오류: ' + ((e as Error)?.message || e);
  }
}

// 한국시간(KST) 오늘 날짜 — 서버는 UTC라 +9시간
function todayKST(): string {
  return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

// 봇이 알아야 할 실제 DB 스키마 지도 (테이블·컬럼·집계 방법). 이게 없으면 테이블명을 추측하다 실패한다.
const SCHEMA_GUIDE = `[BNKNET ERP 데이터 지도 — PostgREST 테이블, 모두 소문자]
사업자(company) 값: 더블아이 / BNKNET / SJ글로벌 / IX글로벌

■ 매출·주문
- orders: 매출/주문 원장. 컬럼 upload_date(등록일 YYYY-MM-DD), company, mall_name(판매몰), product_name, collect_product(수집상품명), quantity(수량), amount(매출액,원), canceled(취소 boolean), order_number, delivery_fee, source, manual_cost, manual_shipping.
  · 매출 합계 = amount 합. 반드시 취소 제외(canceled=is.false). 기간은 upload_date로 필터.
  · 예) 이번달 매출: /orders?select=amount,company,canceled&canceled=is.false&upload_date=gte.<이번달1일>&upload_date=lte.<오늘> → amount를 직접 합산. 사업자별은 company로 그룹.
- order_uploads: 주문 업로드 이력. ship_alerts: 재고 미차감/출고 알림.
- sales_targets: 매출 목표. brand_sales: 과거(6월 이전) 브랜드별 매출(period_date,brand,sales,margin) 참고용.

■ 재고·상품
- inventory: 재고. product_name, company, brand, cost_price(원가), quantity(재고수량).
- products: 상품 마스터. inventory_snapshots/inventory_logs: 재고 스냅샷·변동이력.
- product_matches: 수집상품명→대표상품명 매칭. product_bom: 세트 구성(set_name, component_name, component_qty).
- mall_fees: 몰 수수료율(company, mall, rate).

■ 결재·카드
- approvals: 결재 문서. doc_type(지출결의서/카드구매/휴가신청서), status(pending/approved/rejected/canceled), company, organizer(담당), total_amount, card_id, payment_due_date(결제예정), spend_date, purchase_vendor(구매처), purchase_status, is_card_payment(선결제 여부), issue_date(발의일), settle_date.
- approval_items: 결재 상세 품목. approval_id, item_date, description, quantity, amount, canceled, prepaid_date(부분선결제).
- cards: 카드. card_name, holder_name, card_company, limit_amount(한도), billing_day, close_day, opening_balance.

■ 인사·근태
- employees: 직원. name, email, role(ceo/admin/staff/md), company, phone, hire_date, status, position, salary, pay_day.
- attendance: 근태. employee_name, work_date, check_in, check_out, status.

■ 기타
- notices/notice_comments: 공지·댓글. worklogs: 업무일지(work_date, author_name, company). calendar_events: 일정. partners: 거래처.

■ 규칙
- 날짜 필터는 PostgREST 연산자로: 컬럼=gte.YYYY-MM-DD & 컬럼=lte.YYYY-MM-DD. 취소 제외는 canceled=is.false.
- 합계·평균·순위는 데이터를 받아와 직접 계산한다(서버 집계 없음). 큰 표는 select로 필요한 컬럼만.
- 컬럼이 불확실하면 먼저 /<table>?select=*&limit=1 로 실제 컬럼을 확인한 뒤 질의를 짠다.`;

function buildSystem(): string {
  return `너는 BNKNET ERP의 사내 데이터 비서다. 대표·실장의 질문에 ERP 데이터로 정확히 답한다.
오늘은 한국시간 기준 ${todayKST()} 이다. "이번달/오늘/최근"은 이 날짜를 기준으로 계산한다.
- 답은 반드시 query_erp 도구로 조회한 실제 데이터에 근거한다. 추측하지 말 것.
- 아래 데이터 지도를 보고 알맞은 테이블·컬럼으로 질의한다. 테이블명을 넘겨짚지 말 것.
- 한국어 존댓말로, 숫자는 천단위 구분(,)과 '원' 단위로 깔끔하게. 표가 도움되면 간단한 텍스트 표로.
- 데이터로 확인 안 되는 건 모른다고 솔직히 말한다. 답변은 결론(핵심 숫자)부터 제시한다.

${SCHEMA_GUIDE}`;
}

async function handleQuestion(channel: string, question: string) {
  if (!ANTHROPIC_KEY) { await postSlack(channel, '설정 오류: ANTHROPIC_API_KEY 미설정'); return; }
  const client = new Anthropic({ apiKey: ANTHROPIC_KEY });
  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: question }];
  try {
    const system = buildSystem();
    for (let i = 0; i < 12; i++) { // 도구 호출 루프 상한
      const resp = await client.messages.create({
        model: 'claude-opus-4-8',
        max_tokens: 8192,
        thinking: { type: 'adaptive' },
        output_config: { effort: 'medium' },
        system,
        tools: [ERP_TOOL],
        messages,
      });
      if (resp.stop_reason === 'tool_use') {
        messages.push({ role: 'assistant', content: resp.content });
        const results: Anthropic.ToolResultBlockParam[] = [];
        for (const block of resp.content) {
          if (block.type === 'tool_use' && block.name === 'query_erp') {
            const out = await runQueryErp(block.input as { table?: string; query?: string });
            results.push({ type: 'tool_result', tool_use_id: block.id, content: out });
          }
        }
        messages.push({ role: 'user', content: results });
        continue;
      }
      // 최종 답변
      const text = resp.content.filter(b => b.type === 'text').map(b => (b as Anthropic.TextBlock).text).join('\n').trim();
      if (text) { await postSlack(channel, text); return; }
      // 텍스트가 비었는데 사고 예산이 부족했던 경우(max_tokens): 한 번 더 이어서 답을 받는다
      if (resp.stop_reason === 'max_tokens') {
        messages.push({ role: 'assistant', content: resp.content });
        messages.push({ role: 'user', content: '위 내용을 바탕으로 최종 답변만 간단히 정리해서 알려줘.' });
        continue;
      }
      await postSlack(channel, '죄송해요, 이 질문은 아직 정확히 처리하지 못했어요. 기간이나 사업자를 조금 더 구체적으로 알려주시겠어요?');
      return;
    }
    await postSlack(channel, '조회가 너무 길어져 중단했어요. 질문을 조금 더 좁혀주세요.');
  } catch (e) {
    await postSlack(channel, '답변 중 오류가 났어요: ' + ((e as Error)?.message || e));
  }
}

export async function POST(req: NextRequest) {
  const raw = await req.text();
  const ts = req.headers.get('x-slack-request-timestamp') || '';
  const sig = req.headers.get('x-slack-signature') || '';

  let body: Record<string, unknown>;
  try { body = JSON.parse(raw); } catch { return NextResponse.json({ ok: false }, { status: 400 }); }

  // 1) 슬랙 URL 검증 핸드셰이크 (앱 최초 설정 시)
  if (body.type === 'url_verification') {
    return NextResponse.json({ challenge: body.challenge });
  }

  // 2) 서명 검증
  if (!verifySlack(raw, ts, sig)) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  // 3) 슬랙 재전송(타임아웃 재시도)은 중복 처리 방지 위해 무시
  if (req.headers.get('x-slack-retry-num')) {
    return NextResponse.json({ ok: true });
  }

  const event = body.event as Record<string, unknown> | undefined;
  if (body.type === 'event_callback' && event) {
    const isDM = event.type === 'message' && event.channel_type === 'im';
    const isHuman = !event.bot_id && !event.subtype; // 봇 자신·수정메시지 제외
    const userId = String(event.user || '');
    const channel = String(event.channel || '');
    const text = String(event.text || '').trim();

    if (isDM && isHuman && text) {
      if (!ALLOWED.includes(userId)) {
        // 권한 없는 계정: 즉시 안내 후 종료
        after(async () => { await postSlack(channel, '죄송해요, 이 봇을 사용할 권한이 없어요. 관리자에게 문의해주세요.'); });
        return NextResponse.json({ ok: true });
      }
      // 3초 내 200 응답 필수 → 즉시 ack, 실제 처리는 응답 후 비동기로
      after(async () => { await handleQuestion(channel, text); });
    }
  }

  return NextResponse.json({ ok: true });
}
