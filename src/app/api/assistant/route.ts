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

async function runQueryErp(input: { table?: string; query?: string }): Promise<string> {
  const table = String(input.table || '').trim();
  if (!/^[a-z_][a-z0-9_]*$/.test(table)) return '오류: 잘못된 테이블명';
  if (table === 'rpc') return '오류: rpc(쓰기/함수 호출)는 허용되지 않습니다';
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

const SYSTEM = `너는 BNKNET ERP의 사내 데이터 비서다. 대표·실장의 질문에 ERP 데이터로 정확히 답한다.
- 답은 반드시 query_erp 도구로 조회한 실제 데이터에 근거한다. 추측하지 말 것.
- 컬럼이 확실치 않으면 먼저 select=*&limit=1 로 샘플을 확인하고 조회를 짠다.
- 집계(합계·평균·순위 등)는 데이터를 가져와 직접 계산한다.
- 사업자(company)는 BNKNET 등으로 구분된다. 필요하면 company로 필터한다.
- 한국어 존댓말로, 숫자는 천단위 구분(,)과 '원' 단위로 깔끔하게. 표가 도움되면 간단한 텍스트 표로.
- 데이터로 확인 안 되는 건 모른다고 솔직히 말한다.`;

async function handleQuestion(channel: string, question: string) {
  if (!ANTHROPIC_KEY) { await postSlack(channel, '설정 오류: ANTHROPIC_API_KEY 미설정'); return; }
  const client = new Anthropic({ apiKey: ANTHROPIC_KEY });
  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: question }];
  try {
    for (let i = 0; i < 12; i++) { // 도구 호출 루프 상한
      const resp = await client.messages.create({
        model: 'claude-opus-4-8',
        max_tokens: 4096,
        thinking: { type: 'adaptive' },
        system: SYSTEM,
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
      await postSlack(channel, text || '(답변을 생성하지 못했어요)');
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
