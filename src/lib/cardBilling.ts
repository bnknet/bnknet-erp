// 카드 결제예정일 자동 계산 유틸
// 한국 신용카드: "사용 마감일(close_day)" 까지의 사용분을 그 이후 "결제일(billing_day)"에 결제

export interface Card {
  id: string;
  card_name: string;
  card_type: string;          // 법인 / 개인 / 대표
  holder_name?: string;
  card_company?: string;
  last4?: string;
  limit_amount: number;
  billing_day: number;        // 결제일 (1~31)
  close_day: number;          // 사용 마감일 (31 = 말일)
  benefit_memo?: string;
  is_active: boolean;
  sort_order?: number;
  created_at?: string;
}

export const CARD_TYPES = ['법인', '개인', '대표'] as const;

export const CARD_TYPE_COLORS: Record<string, string> = {
  '법인': 'bg-blue-100 text-blue-700',
  '개인': 'bg-purple-100 text-purple-700',
  '대표': 'bg-amber-100 text-amber-700',
};

// 카드·매입 변경 로그 기록 (감사용)
export async function logCardChange(action: string, target: string, detail: string, actor: string) {
  try {
    const { supabaseFetch } = await import('./supabase');
    await supabaseFetch('/card_logs', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ action, target, detail, actor }),
    });
  } catch { /* 로그 실패는 무시 */ }
}

function lastDayOfMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

// from 날짜로부터 day-of-month 가 targetDay(31=말일)인 가장 가까운 날
// strictlyAfter=true 면 from 보다 "이후", false 면 from "이상"
function nextDateWithDay(from: Date, targetDay: number, strictlyAfter: boolean): Date {
  let y = from.getFullYear();
  let m = from.getMonth();

  const dayInMonth = (yy: number, mm: number) => {
    const last = lastDayOfMonth(yy, mm);
    return targetDay >= 31 ? last : Math.min(targetDay, last);
  };

  let candidate = new Date(y, m, dayInMonth(y, m));
  const tooEarly = strictlyAfter ? candidate <= from : candidate < from;
  if (tooEarly) {
    m += 1;
    if (m > 11) { m = 0; y += 1; }
    candidate = new Date(y, m, dayInMonth(y, m));
  }
  return candidate;
}

// 한국 공휴일 (주말 외 빨간날, 대체공휴일 포함)
// ※ 설날·추석·부처님오신날은 음력 기준이라 매년 달라짐 → 연 1회 갱신 필요
export const KR_HOLIDAYS = new Set<string>([
  // 2026
  '2026-01-01',                                            // 신정
  '2026-02-16', '2026-02-17', '2026-02-18',               // 설날
  '2026-03-01', '2026-03-02',                             // 삼일절 + 대체
  '2026-05-05',                                            // 어린이날
  '2026-05-24', '2026-05-25',                             // 부처님오신날 + 대체
  '2026-06-06',                                            // 현충일
  '2026-08-15', '2026-08-17',                             // 광복절 + 대체
  '2026-09-24', '2026-09-25', '2026-09-26', '2026-09-28', // 추석 + 대체
  '2026-10-03', '2026-10-05',                             // 개천절 + 대체
  '2026-10-09',                                            // 한글날
  '2026-12-25',                                            // 성탄절
  // 2027
  '2027-01-01',
  '2027-02-06', '2027-02-07', '2027-02-08', '2027-02-09', // 설날 + 대체
  '2027-03-01',
  '2027-05-05',
  '2027-05-13',                                            // 부처님오신날
  '2027-06-06', '2027-06-07',                             // 현충일 + 대체
  '2027-08-15', '2027-08-16',                             // 광복절 + 대체
  '2027-09-14', '2027-09-15', '2027-09-16',               // 추석
  '2027-10-03', '2027-10-04',                             // 개천절 + 대체
  '2027-10-09', '2027-10-11',                             // 한글날 + 대체
  '2027-12-25', '2027-12-27',                             // 성탄절 + 대체
]);

function isWeekend(d: Date): boolean {
  const g = d.getDay();
  return g === 0 || g === 6;
}

// 주말/공휴일이면 다음 영업일로 순연
export function adjustToBusinessDay(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  while (isWeekend(d) || KR_HOLIDAYS.has(toISO(d))) {
    d.setDate(d.getDate() + 1);
  }
  return toISO(d);
}

// 구매일 + 카드 결제 주기 → 결제예정일(YYYY-MM-DD)
// 결제일이 주말/공휴일이면 다음 영업일로 자동 순연
export function computePaymentDate(purchaseDate: string, billingDay: number, closeDay: number): string {
  const p = new Date(purchaseDate);
  if (isNaN(p.getTime())) return '';
  const close = nextDateWithDay(p, closeDay, false);   // 구매일 이후 첫 마감일
  const pay = nextDateWithDay(close, billingDay, true); // 마감일 이후 첫 결제일
  return adjustToBusinessDay(toISO(pay));
}

export function toISO(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function formatBillingCycle(card: Card): string {
  const close = card.close_day >= 31 ? '말일' : `${card.close_day}일`;
  return `매월 ${close} 마감 · ${card.billing_day}일 결제`;
}
