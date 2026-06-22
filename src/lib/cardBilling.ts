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

// 구매일 + 카드 결제 주기 → 결제예정일(YYYY-MM-DD)
export function computePaymentDate(purchaseDate: string, billingDay: number, closeDay: number): string {
  const p = new Date(purchaseDate);
  if (isNaN(p.getTime())) return '';
  const close = nextDateWithDay(p, closeDay, false);   // 구매일 이후 첫 마감일
  const pay = nextDateWithDay(close, billingDay, true); // 마감일 이후 첫 결제일
  return toISO(pay);
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
