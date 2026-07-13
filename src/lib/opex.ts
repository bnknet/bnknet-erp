// 판관비(SG&A) 카테고리 정의 — 매출현황 '영업이익' 탭에서 사용.
// 영업이익 = 공헌이익 − 판관비(공급가액 기준). 과세 항목은 매입세액 공제로 ÷1.1, 면세(인건비)는 그대로.

export interface OpexCategory {
  key: string;
  label: string;
  nature: '고정' | '변동' | '준변동' | '혼합';
  taxable: boolean; // 과세(부가세 포함 지급 → ÷1.1) / 면세(그대로)
  hint: string;
}

export const OPEX_CATEGORIES: OpexCategory[] = [
  { key: 'labor',     label: '인건비',        nature: '고정',   taxable: false, hint: '급여·상여·4대보험·퇴직 (총액)' },
  { key: 'rent',      label: '임차료·관리비',  nature: '고정',   taxable: true,  hint: '사무실·창고 임대, 공과금' },
  { key: 'ad',        label: '광고선전비',     nature: '준변동', taxable: true,  hint: '마케팅·광고·체험단' },
  { key: 'fee',       label: '지급수수료',     nature: '변동',   taxable: true,  hint: 'PG·카드수수료·세무·플랫폼 이용료' },
  { key: 'logistics', label: '물류·보관비',    nature: '고정',   taxable: true,  hint: '고정 창고비·3PL 보관료 (※ 건당 택배비 제외 — 이미 공헌이익에서 차감됨)' },
  { key: 'supplies',  label: '소모품·포장재',  nature: '변동',   taxable: true,  hint: '박스·완충재·부자재·비품' },
  { key: 'etc',       label: '기타 운영비',    nature: '혼합',   taxable: true,  hint: '여비·통신·보험·잡비' },
];

export const OPEX_CAT_MAP: Record<string, OpexCategory> = Object.fromEntries(
  OPEX_CATEGORIES.map((c) => [c.key, c]),
);

// DB(opex_category)에서 불러오는 동적 카테고리. 화면은 이 형태로 다룬다.
export interface OpexCatDef {
  key: string;
  label: string;
  nature: string;
  taxable: boolean;
  sort?: number;
  active?: boolean;
}

// 지급액 → 공급가액 환산 (과세 여부를 직접 받아 동적 카테고리에도 적용)
export function toSupply(taxable: boolean, paidAmount: number): number {
  return taxable ? paidAmount / VAT_DIV : paidAmount;
}

// 판관비 입력 대상 사업자 (실제 매출 사업자). 공통비 배분(전사→사업자)은 다음 단계.
export const OPEX_COMPANIES = ['BNKNET', 'SJ글로벌', '더블아이', 'IX글로벌'];

const VAT_DIV = 1.1;

// 지급액 → 공급가액(부가세 제외) 환산. 공헌이익과 같은 기준으로 맞추기 위함.
export function opexSupplyAmount(categoryKey: string, paidAmount: number): number {
  const c = OPEX_CAT_MAP[categoryKey];
  if (!c) return paidAmount;
  return c.taxable ? paidAmount / VAT_DIV : paidAmount;
}

export interface OpexRow {
  id?: string;
  company: string;
  year: number;
  month: number;
  category: string;
  amount: number; // 지급액(과세는 부가세 포함)
  memo?: string;
}
