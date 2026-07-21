import { repNameFor } from './orderConvert';
import { buildFeeMap, lookupFee, type MallFee } from './mallFees';

// 매출/원가 정합성 점검용 공용 계산 (매출 현황 + 대시보드 경고 배너 공유)
// 계산은 항상 코드가 정확히 수행하고, 화면은 결과만 표시한다.

// ── 공헌이익(정석) 라인별 계산 — 매출현황·주문조회가 '같은 함수'를 공유 ──────────
// 숫자가 화면마다 달라지지 않도록, 라인별 매출/공헌이익 계산은 여기 한 곳에서만 한다.
const UNIT_SHIPPING = 2300; // 건당 택배 운임(과세). 합구매는 주문당 1회만.
const VAT_DIV = 1.1;        // 부가세 제거(공급가액 환산)

export interface FullOrder {
  upload_date?: string;
  mall_name?: string;
  product_name?: string;
  collect_product?: string;
  collect_option?: string;
  quantity?: number;
  amount?: number;
  canceled?: boolean;
  company?: string;
  order_number?: string;
  delivery_fee?: number;
  source?: string;
  manual_cost?: number;
  manual_shipping?: number;
}
export interface FullInv {
  product_name: string;
  company?: string;
  brand?: string;
  cost_price?: number;
}
export interface OrderLine {
  date: string; amt: number; rev: number; qty: number; rep: string; mall: string; company: string;
  option: string;
  profit: number; profitKnown: boolean; fee: number; unim: number;
  missCost: boolean; registered: boolean; feeFound: boolean; invCompany?: string;
  brand: string; isPast: boolean;
}

/**
 * 취소 제외 주문을 라인별 매출(공급가액)·공헌이익으로 환산. 매출현황과 동일 규칙.
 * - 일반/수기/사방넷: 매출=(상품금액+고객배송비)/1.1, 공헌이익=(상품금액+배송비−몰수수료−원가−실운임)/1.1
 * - 도매: (매출−원가−배송비)/1.1, 과거실적: 매출−manual_cost(=마진 확정)
 * 고객배송비·실운임은 같은 주문번호에서 1회만 배정(합구매 중복 방지).
 * minDate = 유효 주문의 최소 업로드일(기간 범위 산정용).
 */
export function computeOrderLines(
  orders: FullOrder[],
  inventory: FullInv[],
  fees: MallFee[] = [],
  bom: { set_name: string; component_name: string; component_qty?: number }[] = [],
): { lines: OrderLine[]; minDate: string } {
  type InvVal = { cost: number; company: string; brand: string };
  const invMap = new Map<string, InvVal>();   // `${상품명}|${사업자}`
  const invByName = new Map<string, InvVal>(); // 폴백: 상품명만
  for (const it of inventory) {
    const name = it.product_name;
    if (!name) continue;
    const cost = Number(it.cost_price) || 0;
    const co = it.company || '미분류';
    const val: InvVal = { cost, company: co, brand: it.brand || '' };
    const key = `${name}|${co}`;
    const prev = invMap.get(key);
    if (!prev || (prev.cost === 0 && cost > 0)) invMap.set(key, val);
    const pn = invByName.get(name);
    if (!pn || (pn.cost === 0 && cost > 0)) invByName.set(name, val);
  }

  const bomMap = new Map<string, { component_name: string; component_qty: number }[]>();
  for (const b of bom) { const a = bomMap.get(b.set_name) || []; a.push({ component_name: b.component_name, component_qty: Number(b.component_qty) || 1 }); bomMap.set(b.set_name, a); }

  const feeMap = buildFeeMap(fees);

  // 주문번호별 고객결제 배송비(주문당 1회 = 라인 중복 대비 max)
  const orderDeliveryMax = new Map<string, number>();
  for (const o of orders) {
    if (o.canceled) continue;
    const on = o.order_number || '';
    if (!on) continue;
    orderDeliveryMax.set(on, Math.max(orderDeliveryMax.get(on) || 0, Number(o.delivery_fee) || 0));
  }

  const lines: OrderLine[] = [];
  const shipAssigned = new Set<string>();
  const unimAssigned = new Set<string>();
  let minDate = '';
  for (const o of orders) {
    if (o.canceled) continue;
    const qty = Number(o.quantity) || 0;
    const amt = Number(o.amount) || 0;
    if (qty < 1 && amt === 0) continue;
    // 재고/색상 매칭은 반드시 수집옵션(자연갈색/흑색 등)을 함께 넘겨 색을 가른다.
    const rep = repNameFor(o.collect_product || o.product_name || '', String(o.collect_option || '')).name;
    const inv = (o.company ? invMap.get(`${rep}|${o.company}`) : undefined) || invByName.get(rep);
    const date = o.upload_date || '';
    if (date && (!minDate || date < minDate)) minDate = date;
    const company = o.company || (inv ? inv.company : '미분류');
    const mall = o.mall_name || '(몰 미상)';
    const option = String(o.collect_option || '').trim();

    if (o.source === '과거') {
      lines.push({
        date, amt, rev: amt / VAT_DIV, qty, rep, mall, company, option,
        profit: amt - (Number(o.manual_cost) || 0), profitKnown: true,
        fee: 0, unim: 0, missCost: false, registered: true, feeFound: true,
        invCompany: inv?.company, brand: '', isPast: true,
      });
      continue;
    }
    if (o.source === '도매') {
      const wcost = (Number(o.manual_cost) || 0) * qty;
      const wship = Number(o.manual_shipping) || 0;
      lines.push({
        date, amt, rev: amt / VAT_DIV, qty, rep, mall, company, option,
        profit: (amt - wcost - wship) / VAT_DIV, profitKnown: true,
        fee: 0, unim: 0, missCost: false, registered: true, feeFound: true,
        invCompany: inv?.company, brand: inv?.brand || '', isPast: false,
      });
      continue;
    }

    // 일반/수기/사방넷
    const setDef = bomMap.get(rep);
    let hasCost: boolean;
    let cost: number;
    let invCompanyVal = inv?.company;
    let brandVal = inv?.brand || '';
    if (setDef) {
      let sum = 0; let allFound = true;
      for (const b of setDef) {
        const ci = (o.company ? invMap.get(`${b.component_name}|${o.company}`) : undefined) || invByName.get(b.component_name);
        if (!ci) { allFound = false; break; }
        sum += (ci.cost || 0) * b.component_qty;
        if (!invCompanyVal) invCompanyVal = ci.company;
        if (!brandVal) brandVal = ci.brand || '';
      }
      hasCost = allFound;
      cost = allFound ? sum * qty : 0;
    } else {
      hasCost = !!inv;
      cost = hasCost ? (inv!.cost || 0) * qty : 0;
    }
    const registered = setDef ? hasCost : !!inv;
    const ff = lookupFee(feeMap, company, mall, amt);
    const on = o.order_number || '';
    const key = on || `__noorder_${lines.length}`;
    let ship = 0;
    if (!shipAssigned.has(key)) {
      shipAssigned.add(key);
      ship = on ? (orderDeliveryMax.get(on) || 0) : (Number(o.delivery_fee) || 0);
    }
    let unim = 0;
    if (hasCost && !unimAssigned.has(key)) {
      unimAssigned.add(key);
      unim = UNIT_SHIPPING;
    }
    const rev = (amt + ship) / VAT_DIV;
    const profit = hasCost ? ((amt + ship - ff.fee) - cost - unim) / VAT_DIV : 0;
    lines.push({
      date, amt, rev, qty, rep, mall, company, option,
      profit, profitKnown: hasCost, fee: ff.fee, unim,
      missCost: !hasCost, registered, feeFound: ff.found,
      invCompany: invCompanyVal, brand: brandVal, isPast: false,
    });
  }

  return { lines, minDate };
}

export interface MiniOrder {
  upload_date?: string;
  product_name?: string;
  collect_product?: string;
  collect_option?: string;
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
  bom: { set_name: string; component_name: string }[] = [],
): CostGapSummary {
  const { byKey, byName } = buildInvMaps(inventory);
  // 세트 구성표: 세트명 → 구성품명들 (구성품이 모두 재고에 있으면 원가 확인된 것으로 간주)
  const bomMap = new Map<string, string[]>();
  for (const b of bom) { const a = bomMap.get(b.set_name) || []; a.push(b.component_name); bomMap.set(b.set_name, a); }
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

    const rep = repNameFor(o.collect_product || o.product_name || '', String(o.collect_option || '')).name;
    // 세트상품: 구성품이 모두 재고에 있으면 원가 확인된 것으로 간주 (세트명 자체는 재고에 없음)
    const setComps = bomMap.get(rep);
    const inv = (o.company ? byKey.get(`${rep}|${o.company}`) : undefined) || byName.get(rep);
    const hasCost = setComps
      ? setComps.every(cn => (o.company ? byKey.get(`${cn}|${o.company}`) : undefined) || byName.get(cn))
      : !!inv;
    // 재고에 등록돼 있으면 원가 확인된 것(0원=무상 품목도 정상). 재고 미등록만 원가 미확인으로 경고.
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
