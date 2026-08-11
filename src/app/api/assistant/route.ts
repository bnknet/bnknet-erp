import { NextRequest, NextResponse } from 'next/server';
import { after } from 'next/server';
import crypto from 'node:crypto';
import Anthropic from '@anthropic-ai/sdk';
import { supabaseFetch, supabaseFetchAll } from '@/lib/supabase';
import { computeOrderLines, type FullOrder, type FullInv } from '@/lib/salesStats';
import { repNameFor, loadDbMatches } from '@/lib/orderConvert';
import type { MallFee } from '@/lib/mallFees';
import { OPEX_COMPANIES, OPEX_CATEGORIES, INSURANCE_RATE, toSupply } from '@/lib/opex';

// ── 슬랙 ERP 비서 (DM 개인봇 + 팀 채널봇) ───────────────────────────
// 직원이 슬랙에서 ERP 데이터를 자연어로 물어보면, Claude가 읽기 전용 도구로 Supabase를 조회·추론해 답한다.
// 권한(조회 범위):
//   · DM(1:1): 슬랙 이메일 → employees(활성) 역할 → 스코프(경영/영업/물류/영업물류). 개인 권한 기준.
//     (매칭 실패 시 SLACK_ALLOWED_USER_IDS 화이트리스트는 경영으로 폴백)
//   · 채널(@멘션): SLACK_CHANNEL_SCOPES의 채널→스코프 매핑. 사람 권한 무시, 채널 기준(멤버 전원이 답을 봄).
// 보안 경계는 프롬프트가 아니라 이 백엔드 — 읽기(GET) 전용, rpc·비밀번호(accounts·employees.password_hash) 차단.
export const runtime = 'nodejs';
export const maxDuration = 60; // 복잡한 질문(여러 조회·집계)도 시간 내 답하도록 상향(기본 너무 짧아 무응답 발생)

const SIGNING_SECRET = process.env.SLACK_SIGNING_SECRET || '';
const BOT_TOKEN = process.env.SLACK_BOT_TOKEN || '';
const ALLOWED = (process.env.SLACK_ALLOWED_USER_IDS || '')
  .split(',').map(s => s.trim()).filter(Boolean);
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || '';

// ── 조회 권한 = ERP "메뉴" 기준 ──────────────────────────────
// 보안 경계는 프롬프트가 아니라 백엔드(runQueryErp/도구)에서 강제한다.
// 채널·개인 모두 "메뉴 묶음(프로필)"으로 권한을 정한다. 메뉴 → 실제 테이블/집계도구로 변환.
type MenuName =
  | '매출현황' | '매출목표' | '주문변환' | '재고관리' | '상품마스터' | '거래처관리'
  | '공지사항' | '업무일지' | '행사일정' | '출퇴근' | '인사관리' | '카드매입' | '결재' | '영업이익';

// 각 ERP 메뉴가 봇에게 허용하는 테이블·집계도구. (계정관리=비밀번호는 어떤 메뉴에도 없음 → 항상 차단)
const MENU_DEF: Record<MenuName, { tables: string[]; tools: string[] }> = {
  매출현황: { tables: ['orders', 'mall_fees', 'brand_sales', 'order_settlements', 'order_fee_overrides'], tools: ['sales_summary'] },
  매출목표: { tables: ['sales_targets'], tools: [] },
  주문변환: { tables: ['orders', 'order_uploads'], tools: [] },
  재고관리: { tables: ['inventory', 'inventory_logs', 'inventory_snapshots', 'ship_alerts'], tools: ['stock_summary', 'outbound_summary'] },
  상품마스터: { tables: ['products', 'product_matches', 'product_bom'], tools: [] },
  거래처관리: { tables: ['partners'], tools: [] },
  공지사항: { tables: ['notices', 'notice_comments'], tools: [] },
  업무일지: { tables: ['worklogs'], tools: [] },
  행사일정: { tables: ['calendar_events'], tools: [] },
  출퇴근: { tables: ['attendance'], tools: [] },
  인사관리: { tables: ['employees'], tools: [] },        // 급여 포함(단 password_hash는 항상 차단)
  카드매입: { tables: ['cards', 'purchase_receipts'], tools: [] },
  결재: { tables: ['approvals', 'approval_items'], tools: [] },
  영업이익: { tables: ['opex', 'opex_item', 'opex_category'], tools: ['profit_summary'] }, // 판관비·영업이익(민감: 급여 반영)
};

// 프로필(권한 묶음) = 메뉴 목록. '전체'는 accounts·rpc만 빼고 전부.
const PROFILE_MENUS: Record<string, MenuName[] | '전체'> = {
  물류: ['매출현황', '매출목표', '주문변환', '재고관리', '상품마스터', '거래처관리'],
  영업: ['매출현황', '매출목표', '주문변환', '재고관리', '상품마스터', '거래처관리', '공지사항', '업무일지'],
  경영지원: ['매출현황', '매출목표', '주문변환', '재고관리', '상품마스터', '거래처관리', '공지사항', '업무일지', '행사일정', '출퇴근', '카드매입', '결재'],
  전체: '전체',
};

type Perm = { label: string; tables: ReadonlySet<string> | 'all'; tools: ReadonlySet<string> };
const ALL_TOOLS: ReadonlySet<string> = new Set(['sales_summary', 'stock_summary', 'outbound_summary', 'profit_summary']);

// 프로필명 → 실제 허용 테이블·도구로 변환. 없는 프로필은 null(접근 불가).
function permForProfile(name: string | undefined): Perm | null {
  if (!name) return null;
  const menus = PROFILE_MENUS[name];
  if (!menus) return null;
  if (menus === '전체') return { label: name, tables: 'all', tools: ALL_TOOLS };
  const tables = new Set<string>();
  const tools = new Set<string>();
  for (const m of menus) { const d = MENU_DEF[m]; if (d) { d.tables.forEach((t) => tables.add(t)); d.tools.forEach((t) => tools.add(t)); } }
  return { label: name, tables, tools };
}

// employees.role → 기본 프로필(개인 DM). 직원별 개별 지정(EMAIL_PROFILE)이 우선.
const ROLE_PROFILE: Record<string, string> = {
  ceo: '전체', admin: '전체',
  sales: '영업', md: '영업',
  inventory: '물류',
};

// 직원별 개별 권한(이메일 소문자 → 프로필명). 대표님이 직원별로 전달하면 여기에 채운다. 역할보다 우선.
const EMAIL_PROFILE: Record<string, string> = {
};

// 팀 채널봇: 채널 ID → 프로필명. 채널에서 @봇 부르면 "사람"이 아니라 "채널" 권한으로 답한다.
// (채널은 멤버 전원이 답을 보므로, 대표라도 채널 프로필 범위만 조회 가능)
// 코드에 직접 넣거나(아래), 환경변수 SLACK_CHANNEL_SCOPES="C012=물류,C345=영업,C678=경영지원"로 지정. 미매핑 채널은 기본 차단.
const CHANNEL_PROFILE: Record<string, string> = (() => {
  const m: Record<string, string> = {
    // 채널 ID → 프로필. 예: 'C0ABCD1234': '물류',
  };
  const raw = process.env.SLACK_CHANNEL_SCOPES || '';
  for (const pair of raw.split(',')) {
    const [id, name] = pair.split('=').map((s) => s.trim());
    if (id && name && PROFILE_MENUS[name]) m[id] = name;
  }
  return m;
})();

// employees에서 봇이 노출해도 되는 컬럼(비밀번호 password_hash는 절대 제외)
const EMP_SAFE_COLS = 'id,name,email,role,company,phone,hire_date,status,position,salary,pay_day,created_at';

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

// 슬랙 계정 → 이메일 (users:read.email 권한 필요). 직원 매칭·권한 판별용.
async function slackUserEmail(userId: string): Promise<string> {
  if (!BOT_TOKEN || !userId) return '';
  try {
    const r = await fetch(`https://slack.com/api/users.info?user=${encodeURIComponent(userId)}`, {
      headers: { Authorization: `Bearer ${BOT_TOKEN}` },
    });
    const j = await r.json();
    return j?.ok ? String(j.user?.profile?.email || '').toLowerCase() : '';
  } catch { return ''; }
}

// 이메일 → 활성 직원의 역할·사업자. 없으면 null.
async function employeeByEmail(email: string): Promise<{ role: string; company: string } | null> {
  if (!email) return null;
  try {
    const res = await supabaseFetch(`/employees?email=eq.${encodeURIComponent(email)}&status=eq.active&select=role,company&limit=1`);
    if (!res.ok) return null;
    const rows = await res.json();
    return Array.isArray(rows) && rows[0] ? rows[0] : null;
  } catch { return null; }
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

// 매출·공헌이익 전용 집계 도구 — ERP 매출현황과 '똑같은' 계산을 서버에서 전량 수행.
// query_erp로 큰 표를 LLM이 직접 합산하면 200건 잘림·부가세/실정산 누락으로 틀린다.
const SALES_TOOL: Anthropic.Tool = {
  name: 'sales_summary',
  description:
    '기간별 매출(공급가액)·공헌이익을 ERP 매출현황과 동일한 정식 계산으로 집계한다. ' +
    '매출·공헌이익·사업자별/몰별/상품별/기간(주차 포함) 합계 질문은 반드시 이 도구를 쓴다(query_erp로 orders를 받아 직접 합산 금지 — 전량 반영 안 돼 틀림). ' +
    '부가세 제외(÷1.1), 취소 제외, 오픈마켓 실정산·몰수수료·원가·세트구성까지 반영해 화면과 100% 일치한다. ' +
    '주차별은 start_date~end_date로 그 주 범위를 지정한다(예: 7월3주=07-14~07-20). 몰·상품 지정 시 해당 조건만 집계.',
  input_schema: {
    type: 'object',
    properties: {
      start_date: { type: 'string', description: '시작일 YYYY-MM-DD (포함). 예: 이번달이면 그 달 1일, 특정 주면 그 주 월요일.' },
      end_date: { type: 'string', description: '종료일 YYYY-MM-DD (포함). 생략 시 오늘(KST).' },
      company: { type: 'string', description: '특정 사업자만: 더블아이/BNKNET/SJ글로벌/IX글로벌. 생략 시 전체.' },
      mall: { type: 'string', description: '특정 판매몰만(부분일치). 예: 네이버, 스마트스토어, 쿠팡, 지마켓. 생략 시 전체 몰.' },
      product: { type: 'string', description: '특정 상품/브랜드만(대표상품명·브랜드 부분일치). 예: 덴프스. 생략 시 전체 상품.' },
      group_by: { type: 'string', enum: ['company', 'mall', 'product'], description: '내역을 무엇별로 나눌지. 기본 company(사업자별).' },
    },
    required: ['start_date'],
  },
};

// 재고 현황 전용 집계 — inventory 전량 페이징 합산(200건 잘림 방지).
const STOCK_TOOL: Anthropic.Tool = {
  name: 'stock_summary',
  description:
    '현재 재고 현황을 정식 계산으로 집계한다. 총재고수량·재고평가액(수량×개당원가)·사업자별·마이너스재고 품목. ' +
    '재고 수량/금액 질문은 반드시 이 도구를 쓴다(query_erp로 inventory를 받아 직접 합산 금지 — 200건 잘림으로 틀린다).',
  input_schema: {
    type: 'object',
    properties: {
      company: { type: 'string', description: '특정 사업자만: 더블아이/BNKNET/SJ글로벌/IX글로벌. 생략 시 전체+사업자별.' },
    },
  },
};

// 출고(판매 출고) 전용 집계 — 기간 내 주문을 전량 페이징 + 대표상품명 매칭.
const OUTBOUND_TOOL: Anthropic.Tool = {
  name: 'outbound_summary',
  description:
    '기간별 출고 수량을 정식 계산으로 집계한다. 취소 제외, 대표상품명(수집옵션 반영) 매칭. ' +
    '총출고수량·사업자별·상위상품·미매칭 내역. 출고/판매수량 질문은 반드시 이 도구를 쓴다. "이번달"이면 start_date=그 달 1일.',
  input_schema: {
    type: 'object',
    properties: {
      start_date: { type: 'string', description: '시작일 YYYY-MM-DD (포함).' },
      end_date: { type: 'string', description: '종료일 YYYY-MM-DD (포함). 생략 시 오늘(KST).' },
      company: { type: 'string', description: '특정 사업자만. 생략 시 전체+사업자별.' },
      exclude_wholesale: { type: 'boolean', description: '도매(소스=도매) 제외 여부. 기본 false.' },
    },
    required: ['start_date'],
  },
};

// 영업이익 전용 집계 — 월·사업자 단위(ERP 매출현황 영업이익 탭과 동일). 급여·판관비 포함 민감지표.
const PROFIT_TOOL: Anthropic.Tool = {
  name: 'profit_summary',
  description:
    '월별·사업자별 영업이익을 ERP 영업이익 탭과 동일하게 집계한다(영업이익=공헌이익−판관비). ' +
    '판관비=수동입력+승인된 지출결의서 태깅+급여×4대보험까지 반영. 영업이익 질문은 반드시 이 도구를 쓴다. ' +
    '★영업이익은 "월 단위"만 가능하다(판관비가 월 고정비라 주차별/몰별/상품별로 나눌 수 없음 — 그렇게 요청되면 사유를 설명하고 월 기준으로 안내).',
  input_schema: {
    type: 'object',
    properties: {
      year_month: { type: 'string', description: '기준월 YYYY-MM. 생략 시 이번달(KST).' },
      company: { type: 'string', description: '특정 사업자만: 더블아이/BNKNET/SJ글로벌/IX글로벌. 생략 시 전체+사업자별.' },
    },
  },
};

// 보안상 봇이 읽으면 안 되는 테이블 (비밀번호 등 민감정보)
const BLOCKED_TABLES = new Set(['accounts', 'rpc']);

async function runQueryErp(input: { table?: string; query?: string }, perm: Perm): Promise<string> {
  const table = String(input.table || '').trim();
  if (!/^[a-z_][a-z0-9_]*$/.test(table)) return '오류: 잘못된 테이블명';
  if (BLOCKED_TABLES.has(table)) return `오류: '${table}' 테이블은 보안상 조회할 수 없습니다 (rpc·비밀번호 등)`;
  // 권한(메뉴)별 허용 테이블 검사 (허용목록 = 기본 차단)
  if (perm.tables !== 'all' && !perm.tables.has(table)) {
    return `오류: '${table}' 테이블은 현재 권한(${perm.label})으로 조회할 수 없습니다.`;
  }
  let q = String(input.query || '').trim();
  if (!q) q = 'select=*&limit=20';
  // employees: 비밀번호(password_hash) 노출 차단 — 안전 컬럼만 허용
  if (table === 'employees') {
    if (/password/i.test(q)) return '오류: 보호된 컬럼(비밀번호)은 조회할 수 없습니다.';
    if (!/[?&]?select=/.test(q) || /select=\*/.test(q)) {
      q = q.replace(/(^|&)select=\*/g, '').replace(/^&/, '');
      q = `select=${EMP_SAFE_COLS}` + (q ? `&${q}` : '');
    }
  }
  // 안전장치: 최대 200건으로 제한
  if (!/[?&]?limit=/.test(q)) q += '&limit=200';
  try {
    const res = await supabaseFetch(`/${table}?${q}`, {
      headers: { 'Range-Unit': 'items', Range: '0-199', Prefer: 'count=exact' },
    });
    const txt = await res.text();
    if (!res.ok) return `조회 실패(HTTP ${res.status}): ${txt.slice(0, 500)}`;
    // 조용한 잘림 방지: 전체 건수(content-range)가 반환분보다 많으면 명시 경고.
    const cr = res.headers.get('content-range') || '';        // 예: "0-199/1234"
    const total = cr.includes('/') ? cr.split('/')[1] : '';
    let out = txt.slice(0, 60000);
    if (total && total !== '*' && Number(total) > 200) {
      out = `⚠️ 총 ${total}건 중 200건만 반환됨(잘림). 이 데이터로 합계·평균을 직접 계산하면 실제와 다릅니다. ` +
        `매출·공헌이익은 sales_summary 도구를 쓰고, 그 밖의 큰 집계는 기간/조건을 좁혀 다시 조회하세요.\n` + out;
    }
    return out;
  } catch (e) {
    return '조회 오류: ' + ((e as Error)?.message || e);
  }
}

// 매출·공헌이익을 ERP 매출현황과 동일하게 집계(전량 페이징 + computeOrderLines).
async function runSalesSummary(input: { start_date?: string; end_date?: string; company?: string; mall?: string; product?: string; group_by?: string }, perm: Perm): Promise<string> {
  if (!perm.tools.has('sales_summary')) return `오류: 매출은 현재 권한(${perm.label})으로 조회할 수 없습니다.`;
  const start = String(input.start_date || '').trim();
  const end = String(input.end_date || '').trim() || todayKST();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) return '오류: 날짜는 YYYY-MM-DD 형식이어야 합니다.';
  const companyFilter = String(input.company || '').trim();
  const mallFilter = String(input.mall || '').trim().toLowerCase();
  const productFilter = String(input.product || '').trim().toLowerCase();
  const groupBy = (['company', 'mall', 'product'].includes(String(input.group_by)) ? input.group_by : 'company') as 'company' | 'mall' | 'product';
  try {
    await loadDbMatches(true); // 대표상품명 매칭(product_matches) 반영 — 원가·공헌이익 정확도
    const cols = 'upload_date,mall_name,product_name,collect_product,collect_option,quantity,amount,canceled,company,order_number,delivery_fee,source,manual_cost,manual_shipping';
    let oq = `/orders?select=${cols}&upload_date=gte.${start}&upload_date=lte.${end}&order=upload_date.asc`;
    if (companyFilter) oq += `&company=eq.${encodeURIComponent(companyFilter)}`;
    const [orders, inventory, fees, bom, stRows, foRows] = await Promise.all([
      supabaseFetchAll<FullOrder>(oq),
      supabaseFetchAll<FullInv>('/inventory?select=product_name,company,brand,cost_price'),
      supabaseFetchAll<MallFee>('/mall_fees?select=company,mall,rate'),
      supabaseFetchAll<{ set_name: string; component_name: string; component_qty: number }>('/product_bom?select=set_name,component_name,component_qty').catch(() => []),
      supabaseFetchAll<{ order_number: string; fee: number; cost: number; amount: number }>('/order_settlements?select=order_number,fee,cost,amount').catch(() => []),
      supabaseFetchAll<{ order_number: string; fee_rate: number }>('/order_fee_overrides?select=order_number,fee_rate').catch(() => []),
    ]);
    const settle = new Map<string, { fee: number; cost: number; amount: number }>();
    for (const s of stRows) if (s.order_number) settle.set(String(s.order_number), { fee: Number(s.fee) || 0, cost: Number(s.cost) || 0, amount: Number(s.amount) || 0 });
    const feeOverride = new Map<string, number>();
    for (const r of foRows) if (r.order_number) feeOverride.set(String(r.order_number), Number(r.fee_rate) || 0);

    const { lines } = computeOrderLines(orders, inventory, fees, bom, settle, feeOverride);
    let rev = 0, prof = 0, cnt = 0;
    const groupKeyLabel = { company: '사업자', mall: '몰', product: '상품' }[groupBy];
    const byG = new Map<string, { rev: number; prof: number; cnt: number }>();
    for (const r of lines) {
      if (mallFilter && !String(r.mall || '').toLowerCase().includes(mallFilter)) continue;
      if (productFilter && !(`${r.rep} ${r.brand}`.toLowerCase().includes(productFilter))) continue;
      const key = groupBy === 'company' ? r.company : groupBy === 'mall' ? (r.mall || '(몰 미상)') : r.rep;
      rev += r.rev; cnt++;
      if (r.profitKnown) prof += r.profit;
      const e = byG.get(key) || { rev: 0, prof: 0, cnt: 0 };
      e.rev += r.rev; e.cnt++; if (r.profitKnown) e.prof += r.profit;
      byG.set(key, e);
    }
    const round = (n: number) => Math.round(n);
    const breakdown = [...byG.entries()]
      .map(([k, v]) => ({ [groupKeyLabel]: k, 매출: round(v.rev), 공헌이익: round(v.prof), 주문라인수: v.cnt }))
      .sort((a, b) => (b.매출 as number) - (a.매출 as number))
      .slice(0, 30);
    if (cnt === 0) {
      return JSON.stringify({ 기간: `${start} ~ ${end}`, 사업자필터: companyFilter || '전체', 몰필터: input.mall || '전체', 상품필터: input.product || '전체', 결과: '해당 조건의 매출 데이터가 없습니다(취소 제외).', 총매출_공급가액: 0, 총공헌이익: 0 });
    }
    return JSON.stringify({
      기간: `${start} ~ ${end}`,
      사업자필터: companyFilter || '전체',
      몰필터: input.mall || '전체',
      상품필터: input.product || '전체',
      묶음기준: groupKeyLabel,
      총매출_공급가액: round(rev),
      총공헌이익: round(prof),
      주문라인수: cnt,
      [`${groupKeyLabel}별`]: breakdown,
      비고: 'ERP 매출현황과 동일 계산(부가세 제외 공급가액, 취소·오픈마켓 실정산·몰수수료·원가 반영). 몰·상품은 부분일치. 단위: 원.',
    });
  } catch (e) {
    return '매출 집계 오류: ' + ((e as Error)?.message || e);
  }
}

// 영업이익(월·사업자) 집계 — ERP 매출현황 '영업이익' 탭과 동일: 공헌이익 − 판관비(공급가액).
// 판관비 = 수동(opex+opex_item) + 승인된 지출결의서 태깅(approval_items) + 급여×4대보험(insurance). 과세는 ÷1.1.
// 영업이익 검증 전 — 비활성. 물으면 "안내 어려움 + 공헌이익 대체"로 응답. (ERP 대조 검증 후 true)
const PROFIT_SUMMARY_ENABLED = false;

async function runProfitSummary(input: { year_month?: string; company?: string }, perm: Perm): Promise<string> {
  if (!PROFIT_SUMMARY_ENABLED) {
    return '안내불가(영업이익 준비중): 영업이익은 아직 ERP 실제값과 대조 검증 전이라 정확히 안내드리기 어렵습니다. ' +
      '사용자에게 "영업이익은 아직 안내가 어렵다"고 정중히 알리고, 대신 공헌이익으로 대체해 안내하세요(sales_summary 사용).';
  }
  if (!perm.tools.has('profit_summary')) return `오류: 영업이익은 현재 권한(${perm.label})으로 조회할 수 없습니다. (급여·판관비 포함 민감 지표라 경영 권한 전용)`;
  const ym = String(input.year_month || '').trim() || todayKST().slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(ym)) return '오류: year_month는 YYYY-MM 형식이어야 합니다. 영업이익은 월 단위만 가능(판관비가 월 고정비라 주차/몰/상품별로 나눌 수 없음).';
  const [y, mo] = ym.split('-').map(Number);
  const onlyCo = String(input.company || '').trim();
  try {
    await loadDbMatches(true);
    const cols = 'upload_date,mall_name,product_name,collect_product,collect_option,quantity,amount,canceled,company,order_number,delivery_fee,source,manual_cost,manual_shipping';
    const [orders, inventory, fees, bom, stRows, foRows, opexRows, opexItems, cats, apps, appItems, emps] = await Promise.all([
      supabaseFetchAll<FullOrder>(`/orders?select=${cols}&upload_date=gte.${ym}-01&upload_date=lte.${ym}-31&order=upload_date.asc`),
      supabaseFetchAll<FullInv>('/inventory?select=product_name,company,brand,cost_price'),
      supabaseFetchAll<MallFee>('/mall_fees?select=company,mall,rate'),
      supabaseFetchAll<{ set_name: string; component_name: string; component_qty: number }>('/product_bom?select=set_name,component_name,component_qty').catch(() => []),
      supabaseFetchAll<{ order_number: string; fee: number; cost: number; amount: number }>('/order_settlements?select=order_number,fee,cost,amount').catch(() => []),
      supabaseFetchAll<{ order_number: string; fee_rate: number }>('/order_fee_overrides?select=order_number,fee_rate').catch(() => []),
      supabaseFetchAll<{ company?: string; category?: string; amount?: number }>(`/opex?year=eq.${y}&month=eq.${mo}&select=company,category,amount`).catch(() => []),
      supabaseFetchAll<{ company?: string; category?: string; amount?: number }>(`/opex_item?year=eq.${y}&month=eq.${mo}&select=company,category,amount`).catch(() => []),
      supabaseFetchAll<{ key: string; taxable?: boolean; active?: boolean }>('/opex_category?select=key,taxable,active').catch(() => []),
      supabaseFetchAll<{ id: string; company?: string; spend_date?: string; issue_date?: string }>('/approvals?doc_type=eq.지출결의서&status=eq.approved&select=id,company,spend_date,issue_date').catch(() => []),
      supabaseFetchAll<{ approval_id?: string; amount?: number; opex_category?: string; canceled?: boolean }>('/approval_items?opex_category=not.is.null&select=approval_id,amount,opex_category,canceled').catch(() => []),
      supabaseFetchAll<{ company?: string; salary?: number; status?: string; salary_alloc?: Record<string, number> | null }>('/employees?select=company,salary,status,salary_alloc').catch(() => []),
    ]);
    const settle = new Map<string, { fee: number; cost: number; amount: number }>();
    for (const s of stRows) if (s.order_number) settle.set(String(s.order_number), { fee: Number(s.fee) || 0, cost: Number(s.cost) || 0, amount: Number(s.amount) || 0 });
    const feeOverride = new Map<string, number>();
    for (const r of foRows) if (r.order_number) feeOverride.set(String(r.order_number), Number(r.fee_rate) || 0);

    // 과세여부 맵(DB + 폴백) / 활성 카테고리
    const taxMap: Record<string, boolean> = {};
    for (const c of cats) taxMap[c.key] = c.taxable !== false;
    for (const c of OPEX_CATEGORIES) if (!(c.key in taxMap)) taxMap[c.key] = c.taxable;
    const insuranceActive = cats.length ? cats.some((c) => c.key === 'insurance' && c.active !== false) : true;

    // 공헌이익(월·사업자) — computeOrderLines
    const { lines } = computeOrderLines(orders, inventory, fees, bom, settle, feeOverride);
    const profByCo: Record<string, number> = {};
    for (const l of lines) {
      if (!l.date || l.date.slice(0, 7) !== ym) continue;
      if (!OPEX_COMPANIES.includes(l.company)) continue;
      if (l.profitKnown) profByCo[l.company] = (profByCo[l.company] || 0) + l.profit;
    }

    // 판관비 공급가액(월·사업자) = 수동 + 결재태깅 + 급여4대보험
    const opexSupplyByCo: Record<string, number> = {};
    const add = (co: string, v: number) => { if (co) opexSupplyByCo[co] = (opexSupplyByCo[co] || 0) + v; };
    for (const r of [...opexRows, ...opexItems]) add(String(r.company || ''), toSupply(taxMap[String(r.category)] ?? true, Number(r.amount) || 0));
    // 결재(지출결의서) 태깅: 승인건의 spend_date||issue_date가 해당 월인 것만
    const appYm = new Map<string, { company: string; ym: string }>();
    for (const a of apps) { const d = a.spend_date || a.issue_date || ''; appYm.set(String(a.id), { company: a.company || '', ym: d.slice(0, 7) }); }
    for (const it of appItems) {
      if (it.canceled || !it.opex_category) continue;
      const p = appYm.get(String(it.approval_id));
      if (!p || p.ym !== ym) continue;
      add(p.company, toSupply(taxMap[String(it.opex_category)] ?? true, Number(it.amount) || 0));
    }
    // 급여 → 4대보험(insurance, 면세=그대로). salary_alloc 있으면 사업자별 배분, 없으면 소속 1곳.
    if (insuranceActive) {
      for (const e of emps) {
        if (e.status && e.status !== 'active') continue;
        const alloc = e.salary_alloc && typeof e.salary_alloc === 'object' && Object.keys(e.salary_alloc).length ? e.salary_alloc : null;
        if (alloc) {
          for (const [co, annual] of Object.entries(alloc)) { const mn = (Number(annual) || 0) / 12; if (mn > 0 && OPEX_COMPANIES.includes(co)) add(co, mn * INSURANCE_RATE); }
        } else {
          const mn = (Number(e.salary) || 0) / 12; const co = e.company || '';
          if (mn > 0 && OPEX_COMPANIES.includes(co)) add(co, mn * INSURANCE_RATE);
        }
      }
    }

    const round = (n: number) => Math.round(n);
    const targetCos = onlyCo ? [onlyCo] : OPEX_COMPANIES;
    let tProf = 0, tOpex = 0, tOper = 0;
    const rowsOut = targetCos.map((co) => {
      const cm = profByCo[co] || 0;
      const ox = opexSupplyByCo[co] || 0;
      const op = cm - ox;
      tProf += cm; tOpex += ox; tOper += op;
      return { 사업자: co, 공헌이익: round(cm), 판관비: round(ox), 영업이익: round(op) };
    });
    return JSON.stringify({
      기준월: ym,
      사업자필터: onlyCo || '전체',
      총공헌이익: round(tProf),
      총판관비_공급가액: round(tOpex),
      총영업이익: round(tOper),
      사업자별: rowsOut,
      비고: '영업이익=공헌이익−판관비(공급가액). 판관비=수동입력+승인된 지출결의서 태깅+급여×4대보험(9%). 과세항목 ÷1.1. 월 단위만 산출(주차/몰/상품별 불가). ERP 매출현황 영업이익 탭과 동일.',
    });
  } catch (e) {
    return '영업이익 집계 오류: ' + ((e as Error)?.message || e);
  }
}

// 현재 재고 현황 집계(inventory 전량).
async function runStockSummary(input: { company?: string }, perm: Perm): Promise<string> {
  if (!perm.tools.has('stock_summary')) return `오류: 재고는 현재 권한(${perm.label})으로 조회할 수 없습니다.`;
  const cf = String(input.company || '').trim();
  try {
    let q = '/inventory?select=product_name,company,brand,quantity,cost_price';
    if (cf) q += `&company=eq.${encodeURIComponent(cf)}`;
    const rows = await supabaseFetchAll<{ product_name?: string; company?: string; brand?: string; quantity?: number; cost_price?: number }>(q);
    let totalQty = 0, totalVal = 0;
    const byCo = new Map<string, { qty: number; val: number; items: number }>();
    const negatives: { 상품: string; 사업자: string; 수량: number }[] = [];
    for (const r of rows) {
      const qty = Number(r.quantity) || 0;
      const val = qty * (Number(r.cost_price) || 0);
      totalQty += qty; totalVal += val;
      const co = r.company || '미분류';
      const e = byCo.get(co) || { qty: 0, val: 0, items: 0 };
      e.qty += qty; e.val += val; e.items++; byCo.set(co, e);
      if (qty < 0) negatives.push({ 상품: r.product_name || '(이름없음)', 사업자: co, 수량: qty });
    }
    negatives.sort((a, b) => a.수량 - b.수량);
    const round = (n: number) => Math.round(n);
    return JSON.stringify({
      사업자필터: cf || '전체',
      총재고수량: totalQty,
      재고평가액_원가: round(totalVal),
      품목수: rows.length,
      사업자별: [...byCo.entries()].map(([c, v]) => ({ 사업자: c, 재고수량: v.qty, 평가액: round(v.val), 품목수: v.items })).sort((a, b) => b.평가액 - a.평가액),
      마이너스재고_품목수: negatives.length,
      마이너스재고_상위: negatives.slice(0, 20),
      비고: '현재 재고 스냅샷. 평가액=수량×개당원가. 단위: 원/개.',
    });
  } catch (e) {
    return '재고 집계 오류: ' + ((e as Error)?.message || e);
  }
}

// 기간별 출고 수량 집계(주문 전량 + 대표상품명 매칭). 매출현황 옆 '일자별 출고현황'과 동일 규칙.
async function runOutboundSummary(input: { start_date?: string; end_date?: string; company?: string; exclude_wholesale?: boolean }, perm: Perm): Promise<string> {
  if (!perm.tools.has('outbound_summary')) return `오류: 출고는 현재 권한(${perm.label})으로 조회할 수 없습니다.`;
  const start = String(input.start_date || '').trim();
  const end = String(input.end_date || '').trim() || todayKST();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) return '오류: 날짜는 YYYY-MM-DD 형식이어야 합니다.';
  const cf = String(input.company || '').trim();
  const exW = !!input.exclude_wholesale;
  try {
    await loadDbMatches(true); // 대표상품명 매칭 반영
    let oq = `/orders?select=product_name,collect_product,collect_option,quantity,canceled,company,source&upload_date=gte.${start}&upload_date=lte.${end}`;
    if (cf) oq += `&company=eq.${encodeURIComponent(cf)}`;
    const orders = await supabaseFetchAll<{ product_name?: string; collect_product?: string; collect_option?: string; quantity?: number; canceled?: boolean; company?: string; source?: string }>(oq);
    let totalQty = 0;
    const byCo = new Map<string, number>();
    const byProd = new Map<string, number>();
    let unmatchedQty = 0; const unmatchedSet = new Set<string>();
    for (const r of orders) {
      if (r.canceled) continue;
      const q = Number(r.quantity) || 0;
      if (q < 1) continue;
      if (exW && r.source === '도매') continue;
      const { name, matched } = repNameFor(r.collect_product || r.product_name || '', r.collect_option || '');
      if (matched) {
        totalQty += q;
        const co = r.company || '미지정';
        byCo.set(co, (byCo.get(co) || 0) + q);
        byProd.set(name, (byProd.get(name) || 0) + q);
      } else {
        unmatchedQty += q; unmatchedSet.add(r.collect_product || r.product_name || '(이름없음)');
      }
    }
    const topProd = [...byProd.entries()].map(([p, qv]) => ({ 상품: p, 출고수량: qv })).sort((a, b) => b.출고수량 - a.출고수량).slice(0, 15);
    return JSON.stringify({
      기간: `${start} ~ ${end}`,
      사업자필터: cf || '전체',
      도매제외: exW,
      총출고수량_매칭분: totalQty,
      사업자별: [...byCo.entries()].map(([c, qv]) => ({ 사업자: c, 출고수량: qv })).sort((a, b) => b.출고수량 - a.출고수량),
      상위상품: topProd,
      미매칭_상품종수: unmatchedSet.size,
      미매칭_수량: unmatchedQty,
      비고: '출고=취소제외 주문수량을 대표상품명(옵션반영)으로 매칭 집계. 미매칭분은 매칭데이터 등록이 필요.',
    });
  } catch (e) {
    return '출고 집계 오류: ' + ((e as Error)?.message || e);
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
  · ★매출·공헌이익·사업자별/기간 매출은 orders를 직접 합산하지 말고 반드시 sales_summary 도구로 구한다(정식 계산·전량 반영). orders 직접 합산은 200건 잘림·부가세/실정산 누락으로 틀린다.
  · orders 직접 조회는 개별 주문 확인·건수 등 소량 목적에만. 기간은 upload_date, 취소 제외는 canceled=is.false.
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
- 컬럼이 불확실하면 먼저 /<table>?select=*&limit=1 로 실제 컬럼을 확인한 뒤 질의를 짠다.

■ 공헌이익·이익률 계산 규칙 (중요 — 넘겨짚지 말 것)
- 매출현황의 공헌이익 = (상품금액 + 고객배송비 − 몰수수료 − 원가 − 실운임) ÷ 1.1 로 이미 계산된 값이다.
- 실운임(우리 택배비, 주문당 2,300원)과 몰수수료(mall_fees의 rate)는 공헌이익에 이미 차감돼 있다. 따라서 "배송비/택배비가 반영 안 됐다", "실운임을 빼야 한다"는 식으로 말하지 말 것.
- delivery_fee는 '고객이 낸 배송비'로 매출에 가산되는 값이다. 쿠팡 등 무료배송이면 0이 정상이며, 이것이 이익률을 왜곡하지 않는다.
- 공헌이익률이 유난히 높으면: ① 해당 몰의 수수료율이 mall_fees에 미등록(rate 없음 → 수수료 0으로 과대) 이거나 ② 고마진 상품이 대량 판매된 경우를 먼저 의심한다. mall_fees에 (company, mall) rate가 있는지 먼저 확인하고 판단할 것.`;

function buildSystem(perm: Perm): string {
  const scopeNote = perm.tables === 'all'
    ? '이 사용자/채널은 전체 데이터 조회 권한이다.'
    : `이 사용자/채널의 조회 권한(${perm.label})으로 볼 수 있는 것 — 테이블: ${[...perm.tables].join(', ') || '(없음)'} / 집계도구: ${[...perm.tools].join(', ') || '(없음)'}.\n` +
      '위 목록에 없는 테이블·도구(예: 권한에 없으면 급여·카드·결재·매출 등)는 조회할 수 없다. 권한 밖 내용을 물으면 우회 조회하지 말고 "그 정보는 조회 권한이 없어요"라고 정중히 답한다.';
  return `너는 BNKNET ERP의 사내 데이터 비서다. 사용자의 질문에 ERP 데이터로 정확히 답한다.
오늘은 한국시간 기준 ${todayKST()} 이다. "이번달/오늘/최근"은 이 날짜를 기준으로 계산한다.
- 답은 반드시 도구로 조회한 실제 데이터에 근거한다. 추측하지 말 것.
- ★매출·공헌이익·사업자별/기간 매출은 반드시 sales_summary 도구를 쓴다. query_erp로 orders를 받아 직접 합산하지 말 것(200건 잘림·부가세/실정산 누락으로 반드시 틀린다). "이번달"이면 start_date=그 달 1일, end_date=오늘.
  · 몰별/상품별/주차별 매출도 sales_summary로 한다. 몰=mall, 상품/브랜드=product, 내역 나눔=group_by(company/mall/product), 주차=start_date~end_date(그 주 범위). 예) "7월3주 네이버 덴프스 매출" → start_date=07-14,end_date=07-20,mall=네이버,product=덴프스.
- ★재고 수량/금액은 반드시 stock_summary, 출고/판매수량은 반드시 outbound_summary 도구를 쓴다. query_erp로 inventory·orders를 받아 직접 합산하지 말 것(잘림·매칭누락으로 틀린다).
- 영업이익은 현재 안내가 어렵다(검증 전, 준비중). 영업이익을 물으면 "영업이익은 아직 안내가 어려워요(준비 중)"라고 정중히 말하고, 대신 공헌이익(sales_summary)으로 대체해 안내한다.
- 그 외 데이터는 아래 데이터 지도를 보고 알맞은 테이블·컬럼으로 query_erp 질의한다. 테이블명을 넘겨짚지 말 것.
- query_erp 응답에 "⚠️ …잘림" 경고가 있으면 그 데이터로 합계를 내지 말고, 기간/조건을 좁히거나 전용 도구를 쓴다.
- 한국어 존댓말로, 숫자는 천단위 구분(,)과 '원' 단위로 깔끔하게. 표가 도움되면 간단한 텍스트 표로.
- ★답을 못 하는 경우에도 절대 침묵하지 말 것. 반드시 "왜 불가한지" 사유를 한 줄로 설명한다(예: 권한 없음 / 해당 지표 미지원 / 데이터 없음 / 조건이 너무 넓음). 도구가 "오류:"로 시작하는 결과를 주면 그 사유를 사용자 말로 풀어 전달한다.
- 데이터로 확인 안 되는 건 모른다고 솔직히 말한다. 답변은 결론(핵심 숫자)부터 제시한다.

[조회 권한] ${scopeNote}

${SCHEMA_GUIDE}`;
}

async function handleQuestion(channel: string, question: string, perm: Perm) {
  if (!ANTHROPIC_KEY) { await postSlack(channel, '설정 오류: ANTHROPIC_API_KEY 미설정'); return; }
  const client = new Anthropic({ apiKey: ANTHROPIC_KEY });
  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: question }];
  const startedAt = Date.now();
  const SOFT_LIMIT_MS = 48_000; // maxDuration(60s) 전에 여유를 두고, 넘기 전에 사유를 남기고 종료(무응답 방지)
  try {
    const system = buildSystem(perm);
    for (let i = 0; i < 12; i++) { // 도구 호출 루프 상한
      if (Date.now() - startedAt > SOFT_LIMIT_MS) {
        await postSlack(channel, '질문이 복잡해서 시간 내에 다 처리하지 못했어요. 조금 좁혀서 다시 물어봐 주세요 — 예: 기간을 짧게(한 주씩), 또는 항목을 나눠서(매출 / 영업이익 따로). 몰·상품을 지정하면 더 빨라요.');
        return;
      }
      const resp = await client.messages.create({
        model: 'claude-opus-4-8',
        max_tokens: 8192,
        thinking: { type: 'adaptive' },
        output_config: { effort: 'medium' },
        system,
        tools: [ERP_TOOL, SALES_TOOL, STOCK_TOOL, OUTBOUND_TOOL, PROFIT_TOOL],
        messages,
      });
      if (resp.stop_reason === 'tool_use') {
        messages.push({ role: 'assistant', content: resp.content });
        const results: Anthropic.ToolResultBlockParam[] = [];
        for (const block of resp.content) {
          if (block.type === 'tool_use' && block.name === 'query_erp') {
            const out = await runQueryErp(block.input as { table?: string; query?: string }, perm);
            results.push({ type: 'tool_result', tool_use_id: block.id, content: out });
          } else if (block.type === 'tool_use' && block.name === 'sales_summary') {
            const out = await runSalesSummary(block.input as { start_date?: string; end_date?: string; company?: string }, perm);
            results.push({ type: 'tool_result', tool_use_id: block.id, content: out });
          } else if (block.type === 'tool_use' && block.name === 'stock_summary') {
            const out = await runStockSummary(block.input as { company?: string }, perm);
            results.push({ type: 'tool_result', tool_use_id: block.id, content: out });
          } else if (block.type === 'tool_use' && block.name === 'outbound_summary') {
            const out = await runOutboundSummary(block.input as { start_date?: string; end_date?: string; company?: string; exclude_wholesale?: boolean }, perm);
            results.push({ type: 'tool_result', tool_use_id: block.id, content: out });
          } else if (block.type === 'tool_use' && block.name === 'profit_summary') {
            const out = await runProfitSummary(block.input as { year_month?: string; company?: string }, perm);
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
    const isMention = event.type === 'app_mention'; // 채널에서 @봇 호출
    const isHuman = !event.bot_id && !event.subtype; // 봇 자신·수정메시지 제외
    const userId = String(event.user || '');
    const channel = String(event.channel || '');
    const text = String(event.text || '').trim();

    // 팀 채널: @멘션 → 채널 기준 권한으로 답(사람 권한 무시). 채널이 볼 수 있는 것만.
    if (isMention && isHuman) {
      const q = text.replace(/<@[^>]+>/g, '').trim(); // 멘션 토큰 제거
      if (q) {
        after(async () => {
          const perm = permForProfile(CHANNEL_PROFILE[channel]);
          if (!perm) {
            await postSlack(channel, '이 채널은 ERP 조회 권한이 설정돼 있지 않아요. (관리자: 채널 권한 매핑 필요) DM으로 물어보시면 개인 권한으로 답해드려요.');
            return;
          }
          await handleQuestion(channel, q, perm);
        });
      }
      return NextResponse.json({ ok: true });
    }

    if (isDM && isHuman && text) {
      // 3초 내 200 응답 필수 → 즉시 ack, 권한 판별·처리는 응답 후 비동기로
      after(async () => {
        // 슬랙 계정 → 이메일 → 활성 직원 → 프로필(메뉴 권한) (단계별로 원인 구분)
        const isWhitelisted = ALLOWED.includes(userId);
        const email = await slackUserEmail(userId);
        if (!email) {
          if (isWhitelisted) { await handleQuestion(channel, text, permForProfile('전체')!); return; }
          await postSlack(channel, '권한 확인 실패 ①: 슬랙에서 이메일을 읽지 못했어요. (앱에 users:read.email 권한이 필요) 관리자에게 문의해주세요.');
          return;
        }
        const emp = await employeeByEmail(email);
        if (!emp) {
          if (isWhitelisted) { await handleQuestion(channel, text, permForProfile('전체')!); return; }
          await postSlack(channel, `권한 확인 실패 ②: ERP 직원에서 '${email}' 이메일을 찾지 못했어요. (슬랙 이메일 = ERP employees 이메일 이어야 함) 관리자에게 문의해주세요.`);
          return;
        }
        const perm = permForProfile(EMAIL_PROFILE[email] || ROLE_PROFILE[emp.role]);
        if (!perm) {
          if (isWhitelisted) { await handleQuestion(channel, text, permForProfile('전체')!); return; }
          await postSlack(channel, `권한 확인 실패 ③: 역할 '${emp.role}'은 봇 조회 권한이 설정되지 않았어요. 관리자에게 문의해주세요.`);
          return;
        }
        await handleQuestion(channel, text, perm);
      });
    }
  }

  return NextResponse.json({ ok: true });
}
