import { matchProduct } from './orderConvert';

// 매출/원가 정합성 점검용 공용 계산 (매출 현황 + 대시보드 경고 배너 공유)
// 계산은 항상 코드가 정확히 수행하고, 화면은 결과만 표시한다.

export interface MiniOrder {
  upload_date?: string;
  product_name?: string;
  collect_product?: string;
  quantity?: number;
  amount?: number;
  canceled?: boolean;
  company?: string;
}

export interface MiniInv {
  product_name: string;
  company?: string;
  cost_price?: number;
}

export interface CostGapSummary {
  missingEditable: number; // 재고에 등록됐지만 원가 0 → 입력만 하면 됨
  missingUnreg: number;    // 재고에 아예 없음 (이름 불일치/미등록)
  missingCount: number;    // 위 둘 합 (원가 미입력 상품 종류 수)
  missingRevenue: number;  // 원가 미입력 상품의 판매금액 합
  orderCount: number;      // 기간 내 유효 주문 건수
  revenue: number;         // 기간 내 총 매출 (취소 제외)
  anomaly: boolean;        // 주문은 있는데 매출이 0 (이상 징후)
}

// 재고 → (상품명+사업자)별 + 상품명 폴백 맵 (같은 이름이면 원가>0인 것 우선)
type InvVal = { cost: number; company: string };
function buildInvMaps(inventory: MiniInv[]): { byKey: Map<string, InvVal>; byName: Map<string, InvVal> } {
  const byKey = new Map<string, InvVal>();
  const byName = new Map<string, InvVal>();
  for (const it of inventory) {
    const name = it.product_name;
    if (!name) continue;
    const cost = Number(it.cost_price) || 0;
    const co = it.company || '미분류';
    const val: InvVal = { cost, company: co };
    const k = `${name}|${co}`;
    const pk = byKey.get(k);
    if (!pk || (pk.cost === 0 && cost > 0)) byKey.set(k, val);
    const pn = byName.get(name);
    if (!pn || (pn.cost === 0 && cost > 0)) byName.set(name, val);
  }
  return { byKey, byName };
}

/**
 * 기간 [start, end] (YYYY-MM-DD, 포함) 내 주문에서 원가 미입력 현황을 집계.
 * SalesContent의 집계 로직과 동일한 규칙(취소 제외, matchProduct 대표상품명, 재고 원가 매칭).
 */
export function computeCostGap(
  orders: MiniOrder[],
  inventory: MiniInv[],
  start: string,
  end: string,
): CostGapSummary {
  const { byKey, byName } = buildInvMaps(inventory);
  const editable = new Set<string>();
  const unreg = new Set<string>();
  let missingRevenue = 0;
  let revenue = 0;
  let orderCount = 0;

  for (const o of orders) {
    if (o.canceled) continue;
    const qty = Number(o.quantity) || 0;
    const amt = Number(o.amount) || 0;
    if (qty < 1 && amt === 0) continue;
    const date = o.upload_date || '';
    if (date < start || date > end) continue;

    revenue += amt;
    orderCount++;

    const rep = matchProduct(o.collect_product || o.product_name || '').name;
    const inv = (o.company ? byKey.get(`${rep}|${o.company}`) : undefined) || byName.get(rep);
    const hasCost = !!inv && inv.cost > 0;
    if (!hasCost) {
      missingRevenue += amt;
      if (inv) editable.add(rep);
      else unreg.add(rep);
    }
  }

  return {
    missingEditable: editable.size,
    missingUnreg: unreg.size,
    missingCount: editable.size + unreg.size,
    missingRevenue,
    orderCount,
    revenue,
    anomaly: orderCount > 0 && revenue === 0,
  };
}
