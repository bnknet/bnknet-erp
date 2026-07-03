'use client';

import { useEffect, useMemo, useState } from 'react';
import { getUser } from '@/lib/auth';
import { supabaseFetch, supabaseFetchAll } from '@/lib/supabase';
import { matchProduct, loadDbMatches } from '@/lib/orderConvert';
import { buildFeeMap, lookupFee, normalizeMall, type MallFee } from '@/lib/mallFees';

// ── 타입 ─────────────────────────────────────────────
interface OrderRow {
  upload_date: string;
  mall_name?: string;
  product_name?: string;
  collect_product?: string;
  quantity?: number;
  amount?: number;
  canceled?: boolean;
  company?: string;
  order_number?: string;
  delivery_fee?: number;
  source?: string;
  manual_cost?: number;
  manual_shipping?: number;
  shipping_method?: string; // '택배' | '직접수령' | '화물'
  courier_count?: number;   // 택배 출고 건수(직접주문 입력값)
}
interface InvRow {
  product_name: string;
  company: string;
  brand?: string;
  cost_price?: number;
}
interface BrandSaleRow {
  period_date: string;
  brand: string;
  sales?: number;
  margin?: number;
}
type Period = 'day' | 'week' | 'month' | 'all' | 'range';

const COMPANIES = ['전체', 'BNKNET', 'SJ글로벌', '더블아이', 'IX글로벌', '미분류'];

// 공헌이익(정석) 계산 상수
const UNIT_SHIPPING = 2300;  // 건당 택배 운임(과세·세금계산서 수취). 합구매는 주문당 1회만.
const VAT_DIV = 1.1;         // 부가세 제거(공급가액 환산)

// 원가 인라인 수정 권한 (재고에 쓰기 가능한 역할)
const CAN_EDIT_COST = ['ceo', 'admin', 'sales', 'inventory'];

// ── 날짜 헬퍼 ────────────────────────────────────────
const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseYmd = (s: string) => { const [y, m, dd] = s.split('-').map(Number); return new Date(y, m - 1, dd); };
const addDays = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const addMonths = (d: Date, n: number) => { const x = new Date(d); x.setMonth(x.getMonth() + n); return x; };
const startOfWeekMon = (d: Date) => { const x = new Date(d); const day = (x.getDay() + 6) % 7; x.setDate(x.getDate() - day); return x; };
const startOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1);
const endOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth() + 1, 0);

const won = (n: number) => `${Math.round(n).toLocaleString('ko-KR')}원`;
const wonShort = (n: number) => {
  const v = Math.round(n);
  if (Math.abs(v) >= 100000000) return `${(v / 100000000).toFixed(1)}억`;
  if (Math.abs(v) >= 10000) return `${Math.round(v / 10000).toLocaleString('ko-KR')}만`;
  return v.toLocaleString('ko-KR');
};

interface Ranges {
  curStart: string; curEnd: string;
  prevStart: string | null; prevEnd: string | null;
  label: string; prevLabel: string;
}
// anchor = 조회 기준일, realToday = 실제 오늘(미래분 제외용)
function periodRanges(period: Period, anchor: Date, earliest: string, realToday: string, rangeStart?: string, rangeEnd?: string): Ranges {
  const t = ymd(anchor);
  const cap = (d: string) => (d > realToday ? realToday : d); // 미래 날짜는 오늘까지만
  if (period === 'range') {
    const cs = rangeStart || t;
    const ce = cap(rangeEnd || t);
    // 직전 동기간(같은 일수만큼 앞) 비교
    const days = Math.max(1, Math.round((parseYmd(ce).getTime() - parseYmd(cs).getTime()) / 86400000) + 1);
    const ps = ymd(addDays(parseYmd(cs), -days));
    const pe = ymd(addDays(parseYmd(cs), -1));
    return { curStart: cs, curEnd: ce, prevStart: ps, prevEnd: pe, label: `${cs} ~ ${ce}`, prevLabel: '직전 동기간' };
  }
  if (period === 'day') {
    const y = ymd(addDays(anchor, -1));
    return { curStart: t, curEnd: t, prevStart: y, prevEnd: y, label: `${anchor.getMonth() + 1}/${anchor.getDate()}`, prevLabel: '전일' };
  }
  if (period === 'week') {
    const ws = startOfWeekMon(anchor);
    const curEnd = cap(ymd(addDays(ws, 6)));
    return { curStart: ymd(ws), curEnd, prevStart: ymd(addDays(ws, -7)), prevEnd: ymd(addDays(parseYmd(curEnd), -7)), label: '주간', prevLabel: '전주 동기간' };
  }
  if (period === 'month') {
    const ms = startOfMonth(anchor); const me = endOfMonth(anchor);
    const full = ymd(me) <= realToday;            // 지난달이면 그 달 전체
    const curEnd = cap(ymd(me));
    const pm = addMonths(anchor, -1);
    const prevEnd = full ? ymd(endOfMonth(pm)) : ymd(addMonths(parseYmd(curEnd), -1));
    return { curStart: ymd(ms), curEnd, prevStart: ymd(startOfMonth(pm)), prevEnd, label: `${anchor.getFullYear()}년 ${anchor.getMonth() + 1}월`, prevLabel: '전월 동기간' };
  }
  return { curStart: earliest, curEnd: realToday, prevStart: null, prevEnd: null, label: '전체 누적', prevLabel: '' };
}

export default function SalesContent() {
  const user = getUser();
  const canEditCost = CAN_EDIT_COST.includes(user?.role || '');

  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [inventory, setInventory] = useState<InvRow[]>([]);
  const [fees, setFees] = useState<MallFee[]>([]);
  const [brandSales, setBrandSales] = useState<BrandSaleRow[]>([]);
  const [bomRows, setBomRows] = useState<{ set_name: string; component_name: string; component_qty: number }[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [period, setPeriod] = useState<Period>('day');
  const [companyFilter, setCompanyFilter] = useState('전체');
  const [anchor, setAnchor] = useState(() => ymd(new Date())); // 조회 기준일 (지난달 등 과거 기간 조회용)
  const [rangeStart, setRangeStart] = useState(() => ymd(startOfMonth(new Date()))); // 기간조회 시작일
  const [rangeEnd, setRangeEnd] = useState(() => ymd(new Date()));                    // 기간조회 종료일

  function shiftAnchor(dir: number) {
    const d = parseYmd(anchor);
    if (period === 'day') d.setDate(d.getDate() + dir);
    else if (period === 'week') d.setDate(d.getDate() + 7 * dir);
    else if (period === 'month') d.setMonth(d.getMonth() + dir);
    else return; // 누적은 이동 없음
    setAnchor(ymd(d));
  }

  // 원가 미입력 경고 패널
  const [showCostPanel, setShowCostPanel] = useState(false);
  const [costEdits, setCostEdits] = useState<Record<string, string>>({});
  const [savingCost, setSavingCost] = useState<string | null>(null);

  async function loadAll() {
    setLoading(true); setLoadError(null);
    try {
      await loadDbMatches(true); // 담당자 등록 매칭을 집계 전에 반영
      const [ord, inv, fee] = await Promise.all([
        supabaseFetchAll<OrderRow>('/orders?select=upload_date,mall_name,product_name,collect_product,quantity,amount,canceled,company,order_number,delivery_fee,source,manual_cost,manual_shipping,shipping_method,courier_count&order=upload_date.asc'),
        supabaseFetchAll<InvRow>('/inventory?select=product_name,company,brand,cost_price'),
        supabaseFetchAll<MallFee>('/mall_fees?select=company,mall,rate'),
      ]);
      setOrders(ord);
      setInventory(inv);
      setFees(fee);
      // 브랜드별 매출 (없으면 무시 — 테이블 미설정 가능)
      try {
        const bs = await supabaseFetchAll<BrandSaleRow>('/brand_sales?select=period_date,brand,sales,margin');
        setBrandSales(bs);
      } catch { /* brand_sales 미설정 시 건너뜀 */ }
      try {
        const bom = await supabaseFetchAll<{ set_name: string; component_name: string; component_qty: number }>('/product_bom?select=set_name,component_name,component_qty');
        setBomRows(bom);
      } catch { /* product_bom 미설정 시 건너뜀 */ }
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : '데이터를 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { (async () => { await loadAll(); })(); }, []);

  // ── 집계 (모든 계산을 한 곳에서) ──────────────────────
  const data = useMemo(() => {
    const today = parseYmd(anchor); today.setHours(0, 0, 0, 0); // 기준일(과거 기간 조회 시 이동)
    const realToday = new Date(); realToday.setHours(0, 0, 0, 0); // 실제 오늘 (미래분 제외용)

    // 재고 → (상품명+사업자)별 {원가, 사업자, 브랜드} 맵. 같은 상품이라도 사업자 다르면 원가 따로.
    type InvVal = { cost: number; company: string; brand: string };
    const invMap = new Map<string, InvVal>();      // key: `${상품명}|${사업자}` — 사업자별 원가 정확 매칭
    const invByName = new Map<string, InvVal>();    // 폴백: 상품명만 (주문에 사업자 없을 때)
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

    // 세트 구성표 (세트명 → 구성품·수량). 세트원가 = 구성품 원가 합.
    const bomMap = new Map<string, { component_name: string; component_qty: number }[]>();
    for (const b of bomRows) { const a = bomMap.get(b.set_name) || []; a.push({ component_name: b.component_name, component_qty: Number(b.component_qty) || 1 }); bomMap.set(b.set_name, a); }

    // 몰 수수료 맵 (사업자+정규몰명 → %)
    const feeMap = buildFeeMap(fees);

    // 주문번호별 고객결제 배송비(주문당 1회 = 라인별 중복 표기 대비 max)
    const orderDeliveryMax = new Map<string, number>();
    for (const o of orders) {
      if (o.canceled) continue;
      const on = o.order_number || '';
      if (!on) continue;
      const df = Number(o.delivery_fee) || 0;
      orderDeliveryMax.set(on, Math.max(orderDeliveryMax.get(on) || 0, df));
    }

    // 주문 → 매출 인식용 가공 (취소 제외). 공헌이익은 라인별로 미리 계산.
    // · 일반/수기/사방넷: 전 항목 부가세 제외(공급가액 기준)
    //   - 매출 = (상품금액 + 고객배송비) ÷ 1.1  (고객이 낸 배송비도 과세 매출 → 공급가액에 포함)
    //   - 공헌이익 = (상품금액 + 고객배송비 − 몰수수료 − 원가 − 실운임) ÷ 1.1
    //   - 고객배송비·실운임은 합구매(같은 주문번호) 1회만. 배송비는 매출로 흡수, 비용엔 실제 택배비만.
    // · 도매(source='도매'): 입력값으로 확정 = (매출 − 원가(개당×수량) − 배송비)/1.1 (수수료 없음, 모두 부가세 포함 → ÷1.1).
    // amt = 상품 결제금액(부가세 포함, DB 원본). rev = 부가세 제외 매출(공급가액) — 화면 표시·집계용.
    type Flt = { date: string; amt: number; rev: number; qty: number; rep: string; mall: string; company: string;
      profit: number; profitKnown: boolean; fee: number; unim: number;
      missCost: boolean; registered: boolean; feeFound: boolean; invCompany?: string;
      brand: string; isPast: boolean };
    const flt: Flt[] = [];
    const shipAssigned = new Set<string>(); // 고객배송비(매출) 배정 완료한 주문번호
    const unimAssigned = new Set<string>(); // 실운임(비용) 배정 완료한 주문번호
    let earliest = ymd(today);
    for (const o of orders) {
      if (o.canceled) continue;
      const qty = Number(o.quantity) || 0;
      const amt = Number(o.amount) || 0;
      if (qty < 1 && amt === 0) continue;
      const rep = matchProduct(o.collect_product || o.product_name || '').name;
      // 원가·브랜드는 (상품명+사업자)로 매칭. 주문에 사업자 있으면 그 사업자 재고, 없으면 상품명만으로 폴백.
      const inv = (o.company ? invMap.get(`${rep}|${o.company}`) : undefined) || invByName.get(rep);
      const date = o.upload_date || '';
      if (date && date < earliest) earliest = date;
      const company = o.company || (inv ? inv.company : '미분류');
      const mall = o.mall_name || '(몰 미상)';

      if (o.source === '과거') {
        // 과거 실적: 엑셀의 매출·마진을 그대로 확정 (manual_cost = 매출 − 마진 → 공헌이익 = 마진)
        flt.push({
          date, amt, rev: amt / VAT_DIV, qty, rep, mall, company,
          profit: amt - (Number(o.manual_cost) || 0), profitKnown: true,
          fee: 0, unim: 0, missCost: false, registered: true, feeFound: true,
          invCompany: inv?.company, brand: '', isPast: true,
        });
        continue;
      }

      if (o.source === '도매') {
        // 도매: 등록 시 입력값으로 마진 확정 (재계산 안 함)
        const wcost = (Number(o.manual_cost) || 0) * qty;
        const wship = Number(o.manual_shipping) || 0;
        flt.push({
          date, amt, rev: amt / VAT_DIV, qty, rep, mall, company,
          profit: (amt - wcost - wship) / VAT_DIV, profitKnown: true,
          fee: 0, unim: 0, missCost: false, registered: true, feeFound: true,
          invCompany: inv?.company, brand: inv?.brand || '', isPast: false,
        });
        continue;
      }

      // 일반/수기/사방넷
      // 재고에 등록된 상품이면 원가 유효(0원=무상/서비스 품목도 정상 원가로 인정). 재고 미등록만 원가 미확인.
      // 세트상품(BOM): 재고에 세트명은 없고 구성품만 있으므로 구성품 원가 합으로 계산.
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
      const key = on || `__noorder_${flt.length}`; // 주문번호 없으면 라인 단위로 취급
      // 고객 배송비: 주문당 1회만 매출·이익에 반영 (합구매 중복 방지). 원가 미확인 라인이어도 매출엔 포함.
      let ship = 0;
      if (!shipAssigned.has(key)) {
        shipAssigned.add(key);
        ship = on ? (orderDeliveryMax.get(on) || 0) : (Number(o.delivery_fee) || 0);
      }
      // 실운임(택배 매입, 과세): 원가 확인된 라인에서 주문당 1회만 비용 처리.
      let unim = 0;
      if (hasCost && !unimAssigned.has(key)) {
        unimAssigned.add(key);
        unim = UNIT_SHIPPING;
      }
      // 매출(공급가액) = (상품금액 + 고객배송비) ÷ 1.1 — 배송비도 부가세 제외.
      const rev = (amt + ship) / VAT_DIV;
      // 공헌이익 = (상품금액 + 배송비 − 몰수수료 − 원가 − 실운임) ÷ 1.1 (전 항목 부가세 제외 통일).
      const profit = hasCost ? ((amt + ship - ff.fee) - cost - unim) / VAT_DIV : 0;
      flt.push({
        date, amt, rev, qty, rep, mall, company,
        profit, profitKnown: hasCost, fee: ff.fee, unim,
        missCost: !hasCost, registered, feeFound: ff.found,
        invCompany: invCompanyVal, brand: brandVal, isPast: false,
      });
    }

    const ranges = periodRanges(period, today, earliest, ymd(realToday), rangeStart, rangeEnd);
    const cf = (company: string) => companyFilter === '전체' || company === companyFilter;

    // 기간 합계만 (이전 기간/추이용)
    const sumRange = (start: string, end: string) => {
      let rev = 0, prof = 0, mrev = 0, cnt = 0;
      for (const r of flt) {
        if (!cf(r.company)) continue;
        if (r.date < start || r.date > end) continue;
        rev += r.rev; cnt++;
        if (r.profitKnown) { prof += r.profit; mrev += r.rev; }
      }
      return { rev, prof, mrev, cnt };
    };

    // 현재 기간 상세 (품목/몰/원가미입력)
    const mallMap = new Map<string, { rev: number; cnt: number; prof: number; mrev: number }>();
    const companyMap = new Map<string, { rev: number; cnt: number; prof: number; mrev: number }>();
    const missEdit = new Map<string, { qty: number; cnt: number; rev: number; company: string }>();
    const missUnreg = new Map<string, { qty: number; cnt: number; rev: number }>();
    const missFee = new Map<string, { company: string; mall: string; rev: number; cnt: number }>();
    let curRev = 0, curProf = 0, curMrev = 0, curCnt = 0, curQty = 0, curFee = 0, curUnim = 0;
    for (const r of flt) {
      if (!cf(r.company)) continue;
      if (r.date < ranges.curStart || r.date > ranges.curEnd) continue;
      curRev += r.rev; curCnt++; curQty += r.qty;
      if (r.profitKnown) { curProf += r.profit; curMrev += r.rev; curFee += r.fee; curUnim += r.unim; }

      const m = mallMap.get(r.mall) || { rev: 0, cnt: 0, prof: 0, mrev: 0 };
      m.rev += r.rev; m.cnt++; if (r.profitKnown) { m.prof += r.profit; m.mrev += r.rev; }
      mallMap.set(r.mall, m);

      const co = companyMap.get(r.company) || { rev: 0, cnt: 0, prof: 0, mrev: 0 };
      co.rev += r.rev; co.cnt++; if (r.profitKnown) { co.prof += r.profit; co.mrev += r.rev; }
      companyMap.set(r.company, co);

      // 수수료 미설정 몰 추적 (매출은 있는데 요율 없음 → 경고)
      if (!r.feeFound && r.amt > 0) {
        const fk = `${r.company}|${normalizeMall(r.mall)}`;
        const fe = missFee.get(fk) || { company: r.company, mall: r.mall, rev: 0, cnt: 0 };
        fe.rev += r.rev; fe.cnt++; missFee.set(fk, fe);
      }

      if (r.missCost) {
        if (r.registered) {
          const e = missEdit.get(r.rep) || { qty: 0, cnt: 0, rev: 0, company: r.invCompany || '미분류' };
          e.qty += r.qty; e.cnt++; e.rev += r.rev; missEdit.set(r.rep, e);
        } else {
          const u = missUnreg.get(r.rep) || { qty: 0, cnt: 0, rev: 0 };
          u.qty += r.qty; u.cnt++; u.rev += r.rev; missUnreg.set(r.rep, u);
        }
      }
    }

    const prev = ranges.prevStart ? sumRange(ranges.prevStart, ranges.prevEnd!) : null;

    // 추이 그래프 버킷
    const sumBucket = (start: string, end: string) => {
      let s = 0;
      for (const r of flt) { if (!cf(r.company)) continue; if (r.date < start || r.date > end) continue; s += r.rev; }
      return s;
    };
    const trend: { label: string; rev: number; isCurrent: boolean }[] = [];
    if (period === 'day') {
      for (let i = 13; i >= 0; i--) { const d = addDays(today, -i); const s = ymd(d); trend.push({ label: `${d.getMonth() + 1}/${d.getDate()}`, rev: sumBucket(s, s), isCurrent: i === 0 }); }
    } else if (period === 'week') {
      const ws0 = startOfWeekMon(today);
      for (let i = 7; i >= 0; i--) { const ws = addDays(ws0, -7 * i); const we = addDays(ws, 6); trend.push({ label: `${ws.getMonth() + 1}/${ws.getDate()}`, rev: sumBucket(ymd(ws), ymd(we)), isCurrent: i === 0 }); }
    } else if (period === 'month') {
      // 월초(1일)로 직접 생성 — 30·31일 기준일이 짧은 달에서 다음 달로 밀리는 버그 방지
      for (let i = 5; i >= 0; i--) { const ms = new Date(today.getFullYear(), today.getMonth() - i, 1); trend.push({ label: `${ms.getMonth() + 1}월`, rev: sumBucket(ymd(ms), ymd(endOfMonth(ms))), isCurrent: i === 0 }); }
    } else if (period === 'range') {
      const cs = parseYmd(ranges.curStart); const ce = parseYmd(ranges.curEnd);
      const days = Math.round((ce.getTime() - cs.getTime()) / 86400000) + 1;
      if (days <= 31) {
        for (let i = 0; i < days; i++) { const d = addDays(cs, i); const s = ymd(d); trend.push({ label: `${d.getMonth() + 1}/${d.getDate()}`, rev: sumBucket(s, s), isCurrent: false }); }
      } else {
        let ms = new Date(cs.getFullYear(), cs.getMonth(), 1);
        while (ms <= ce) {
          const bs = ymd(ms) < ranges.curStart ? ranges.curStart : ymd(ms);
          const be = ymd(endOfMonth(ms)) > ranges.curEnd ? ranges.curEnd : ymd(endOfMonth(ms));
          trend.push({ label: `${ms.getMonth() + 1}월`, rev: sumBucket(bs, be), isCurrent: false });
          ms = new Date(ms.getFullYear(), ms.getMonth() + 1, 1);
        }
        if (trend.length > 12) trend.splice(0, trend.length - 12);
      }
    } else {
      let ms = startOfMonth(parseYmd(earliest)); const end = startOfMonth(realToday);
      while (ms <= end) { trend.push({ label: `${String(ms.getFullYear()).slice(2)}.${pad(ms.getMonth() + 1)}`, rev: sumBucket(ymd(ms), ymd(endOfMonth(ms))), isCurrent: ms.getTime() === end.getTime() }); ms = addMonths(ms, 1); }
      if (trend.length > 12) trend.splice(0, trend.length - 12);
    }

    const byMall = Array.from(mallMap.entries()).map(([name, v]) => ({ name, ...v })).sort((a, b) => b.rev - a.rev);
    const byCompany = Array.from(companyMap.entries()).map(([name, v]) => ({ name, ...v })).sort((a, b) => b.rev - a.rev);
    const missingEditable = Array.from(missEdit.entries()).map(([name, v]) => ({ name, ...v })).sort((a, b) => b.rev - a.rev);
    const missingUnreg = Array.from(missUnreg.entries()).map(([name, v]) => ({ name, ...v })).sort((a, b) => b.rev - a.rev);
    const missingFee = Array.from(missFee.values()).sort((a, b) => b.rev - a.rev);

    // 브랜드별 매출 — 사업자 필터 반영. 현재=주문×재고 브랜드(사업자별 정확), 과거=brand_sales(사업자 구분 없음)
    const brandMap = new Map<string, { sales: number; margin: number }>();
    for (const r of flt) {
      if (r.isPast || !r.brand) continue;
      if (r.date < ranges.curStart || r.date > ranges.curEnd) continue;
      if (!cf(r.company)) continue; // 선택 사업자만
      const e = brandMap.get(r.brand) || { sales: 0, margin: 0 };
      e.sales += r.rev; e.margin += r.profit; brandMap.set(r.brand, e);
    }
    // 과거 브랜드 실적은 사업자 구분이 없어, 특정 사업자 선택 시엔 제외(전체일 때만 합산)
    if (companyFilter === '전체') {
      for (const b of brandSales) {
        const d = b.period_date || '';
        if (d < ranges.curStart || d > ranges.curEnd) continue;
        const e = brandMap.get(b.brand) || { sales: 0, margin: 0 };
        // 과거 브랜드 매출은 부가세 포함 → ÷1.1. 마진은 파일 값(이미 부가세 제외) 그대로.
        e.sales += (Number(b.sales) || 0) / VAT_DIV; e.margin += Number(b.margin) || 0; brandMap.set(b.brand, e);
      }
    }
    const byBrand = Array.from(brandMap.entries()).map(([name, v]) => ({ name, ...v })).sort((a, b) => b.sales - a.sales);

    // 택배 출고 건수 (현재 기간·사업자 필터). 직접수령·화물·과거·도매 제외.
    //  주문번호 단위로 집계(합구매·다품목 1주문=1택배 중복 방지):
    //   · courier_count 입력값 있으면 그 값(직접주문), 없으면 주문번호당 1건
    const orderParcels = new Map<string, number>();
    let noKeyCourier = 0;
    for (const o of orders) {
      if (o.canceled) continue;
      const d = o.upload_date || '';
      if (d < ranges.curStart || d > ranges.curEnd) continue;
      if (!cf(o.company || '미분류')) continue;
      if (o.source === '과거' || o.source === '도매') continue;
      if ((o.shipping_method || '택배') !== '택배') continue; // 직접수령·화물 제외
      const explicit = o.courier_count != null ? Number(o.courier_count) || 0 : null;
      const key = o.order_number ? `${o.company || ''}|${o.order_number}` : '';
      if (!key) { noKeyCourier += explicit != null ? explicit : 1; continue; }
      if (explicit != null) orderParcels.set(key, explicit);      // 명시값 우선
      else if (!orderParcels.has(key)) orderParcels.set(key, 1);  // 기본 주문당 1택배
    }
    let curCourier = noKeyCourier;
    for (const v of orderParcels.values()) curCourier += v;

    return {
      ranges,
      cur: { rev: curRev, prof: curProf, mrev: curMrev, cnt: curCnt, qty: curQty, fee: curFee, unim: curUnim, courier: curCourier },
      prev,
      trend, byMall, byCompany, byBrand, missingEditable, missingUnreg, missingFee,
      missingCount: missingEditable.length + missingUnreg.length,
    };
  }, [orders, inventory, fees, brandSales, bomRows, period, companyFilter, anchor, rangeStart, rangeEnd]);

  const { ranges, cur, prev, trend, byMall, byCompany, byBrand, missingEditable, missingUnreg, missingFee, missingCount } = data;
  const marginPct = cur.mrev > 0 ? Math.round((cur.prof / cur.mrev) * 100) : null;
  const trendMax = Math.max(1, ...trend.map((t) => t.rev));

  const deltaPct = (c: number, p: number | undefined) => (p && p > 0 ? Math.round(((c - p) / p) * 100) : null);
  const revDelta = prev ? deltaPct(cur.rev, prev.rev) : null;
  const profDelta = prev ? deltaPct(cur.prof, prev.prof) : null;

  // 이상 징후: 기간 내 주문은 있는데 매출이 0
  const anomaly = !loading && cur.cnt > 0 && cur.rev === 0;

  // 원가 인라인 저장 → 재고에 반영
  async function saveCost(productName: string, company: string) {
    const raw = costEdits[productName];
    const value = Number(String(raw).replace(/[^0-9.-]/g, ''));
    if (!raw || !(value > 0)) { alert('원가(0보다 큰 숫자)를 입력하세요.'); return; }
    setSavingCost(productName);
    try {
      const res = await supabaseFetch(
        `/inventory?product_name=eq.${encodeURIComponent(productName)}&company=eq.${encodeURIComponent(company)}`,
        { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ cost_price: value, updated_at: new Date().toISOString() }) },
      );
      const updated = await res.json();
      if (!res.ok) throw new Error('저장 실패');
      if (!Array.isArray(updated) || updated.length === 0) {
        alert('재고에서 해당 상품을 찾지 못했습니다. 재고 관리에서 상품명/사업자를 확인해주세요.');
        return;
      }
      // 재고만 다시 불러와 즉시 재계산
      const inv = await supabaseFetchAll<InvRow>('/inventory?select=product_name,company,brand,cost_price');
      setInventory(inv);
      setCostEdits((prev) => { const n = { ...prev }; delete n[productName]; return n; });
    } catch {
      alert('저장 중 오류가 발생했습니다. 다시 시도해주세요.');
    } finally {
      setSavingCost(null);
    }
  }

  const periodBtns: { key: Period; label: string }[] = [
    { key: 'day', label: '당일' }, { key: 'week', label: '주간' }, { key: 'month', label: '월간' }, { key: 'all', label: '누적' }, { key: 'range', label: '기간' },
  ];

  return (
    <div className="space-y-6">
      {/* 상단: 기간/사업자 필터 */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
          {periodBtns.map((b) => (
            <button key={b.key} onClick={() => setPeriod(b.key)}
              className={`px-3 py-1.5 rounded-md text-base font-medium transition-colors ${period === b.key ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
              {b.label}
            </button>
          ))}
        </div>
        {/* 사업자별 필터 버튼 — 누르면 그 사업자 매출만 분리 조회 */}
        <div className="flex flex-wrap gap-1 bg-gray-100 rounded-lg p-1">
          {COMPANIES.map((c) => (
            <button key={c} onClick={() => setCompanyFilter(c)}
              className={`px-3 py-1.5 rounded-md text-base font-medium transition-colors ${companyFilter === c ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
              {c}
            </button>
          ))}
        </div>

        {/* 기간 이동 (지난달·특정일 조회) — 누적·기간조회는 제외 */}
        {period !== 'all' && period !== 'range' && (
          <div className="flex items-center gap-1">
            <button onClick={() => shiftAnchor(-1)} title="이전"
              className="px-2 py-2 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50">◀</button>
            <input type="date" value={anchor} onChange={(e) => e.target.value && setAnchor(e.target.value)}
              className="px-2 py-2 rounded-lg border border-gray-200 text-base bg-white" />
            <button onClick={() => shiftAnchor(1)} title="다음"
              className="px-2 py-2 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50">▶</button>
            <button onClick={() => setAnchor(ymd(new Date()))}
              className="px-2.5 py-2 rounded-lg border border-gray-200 text-sm text-gray-500 hover:bg-gray-50">오늘</button>
          </div>
        )}

        {/* 기간 조회 (시작일 ~ 종료일 직접 선택) */}
        {period === 'range' && (
          <div className="flex items-center gap-1">
            <input type="date" value={rangeStart} max={rangeEnd}
              onChange={(e) => e.target.value && setRangeStart(e.target.value)}
              className="px-2 py-2 rounded-lg border border-gray-200 text-base bg-white" />
            <span className="text-gray-400">~</span>
            <input type="date" value={rangeEnd} min={rangeStart}
              onChange={(e) => e.target.value && setRangeEnd(e.target.value)}
              className="px-2 py-2 rounded-lg border border-gray-200 text-base bg-white" />
          </div>
        )}

        <span className="text-sm text-gray-400">{ranges.label} · {ranges.curStart}{ranges.curStart !== ranges.curEnd ? ` ~ ${ranges.curEnd}` : ''}</span>
        <button onClick={loadAll} disabled={loading}
          className="ml-auto px-3 py-2 rounded-lg border border-gray-200 text-base text-gray-600 hover:bg-gray-50 disabled:opacity-50">
          {loading ? '불러오는 중…' : '새로고침'}
        </button>
      </div>

      {loadError && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-5 py-4 text-base text-red-600">
          ⚠️ 데이터를 불러오지 못했습니다 — 숫자가 실제보다 적게 나올 수 있습니다. ({loadError})
          <button onClick={loadAll} className="ml-3 underline">다시 시도</button>
        </div>
      )}

      {/* 이상 징후 경고 */}
      {anomaly && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-5 py-4 text-base text-amber-700">
          ⚠️ 이 기간에 주문은 {cur.cnt}건 있는데 매출이 0원으로 집계됩니다 — 데이터 점검이 필요합니다.
        </div>
      )}

      {/* 원가 미입력 경고 배너 (필수) */}
      {!loading && missingCount > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-xl overflow-hidden">
          <button onClick={() => setShowCostPanel((v) => !v)} className="w-full flex items-center justify-between px-5 py-4 hover:bg-red-100/60 transition-colors text-left">
            <div>
              <div className="text-base font-semibold text-red-600">⚠️ 원가 미입력 상품 {missingCount}건 — 공헌이익에 반영되지 않았습니다</div>
              <div className="text-sm text-red-400 mt-0.5">팔렸지만 재고에 원가가 없거나 등록 안 된 상품입니다. {showCostPanel ? '접기' : '눌러서 확인·입력하기'}</div>
            </div>
            <span className="text-red-400 text-lg">{showCostPanel ? '▲' : '▼'}</span>
          </button>

          {showCostPanel && (
            <div className="border-t border-red-200 bg-white px-5 py-4 space-y-5">
              {/* (A) 재고에 등록됐지만 원가 0 → 그 자리 입력 */}
              {missingEditable.length > 0 && (
                <div>
                  <div className="text-base font-semibold text-gray-700 mb-2">원가만 입력하면 되는 상품 ({missingEditable.length})</div>
                  <div className="text-sm text-gray-400 mb-2">아래에 개당원가를 입력·저장하면 재고에 반영되고 매출이 즉시 다시 계산됩니다.</div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-base">
                      <thead>
                        <tr className="text-left text-sm text-gray-400 border-b">
                          <th className="py-2 pr-3">상품명</th><th className="py-2 pr-3">사업자</th>
                          <th className="py-2 pr-3 text-right">판매건수</th><th className="py-2 pr-3 text-right">판매수량</th>
                          <th className="py-2 pr-3 text-right">판매금액</th><th className="py-2 pr-3">개당원가 입력</th>
                        </tr>
                      </thead>
                      <tbody>
                        {missingEditable.map((m) => (
                          <tr key={m.name} className="border-b border-gray-50">
                            <td className="py-2 pr-3 font-medium text-gray-700">{m.name}</td>
                            <td className="py-2 pr-3 text-gray-500">{m.company}</td>
                            <td className="py-2 pr-3 text-right text-gray-500">{m.cnt}</td>
                            <td className="py-2 pr-3 text-right text-gray-500">{m.qty}</td>
                            <td className="py-2 pr-3 text-right text-gray-700">{won(m.rev)}</td>
                            <td className="py-2 pr-3">
                              {canEditCost ? (
                                <div className="flex items-center gap-1.5">
                                  <input type="text" inputMode="numeric" placeholder="0"
                                    value={costEdits[m.name] ?? ''}
                                    onChange={(e) => setCostEdits((p) => ({ ...p, [m.name]: e.target.value }))}
                                    className="w-24 px-2 py-1 border border-gray-200 rounded text-right" />
                                  <button onClick={() => saveCost(m.name, m.company)} disabled={savingCost === m.name}
                                    className="px-2.5 py-1 rounded bg-blue-600 text-white text-sm hover:bg-blue-700 disabled:opacity-50">
                                    {savingCost === m.name ? '저장…' : '저장'}
                                  </button>
                                </div>
                              ) : <span className="text-sm text-gray-400">입력 권한 없음</span>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* (B) 재고에 아예 없는 상품 → 등록 안내 */}
              {missingUnreg.length > 0 && (
                <div>
                  <div className="text-base font-semibold text-gray-700 mb-2">재고에 등록되지 않은 상품 ({missingUnreg.length})</div>
                  <div className="text-sm text-gray-400 mb-2">상품명이 재고와 매칭되지 않습니다. <a href="/inventory" className="text-blue-600 underline">재고 관리</a>에서 등록하거나 상품명을 맞춰주세요.</div>
                  <div className="flex flex-wrap gap-2">
                    {missingUnreg.map((m) => (
                      <span key={m.name} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-gray-100 text-sm text-gray-600">
                        {m.name} <span className="text-gray-400">· {m.cnt}건 · {won(m.rev)}</span>
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* 수수료 미설정 몰 경고 (공헌이익에 수수료 미반영) */}
      {!loading && missingFee.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-5 py-4">
          <div className="text-base font-semibold text-amber-700">⚠️ 수수료율이 설정 안 된 판매몰 {missingFee.length}건 — 이 몰 매출엔 수수료가 빠져 공헌이익이 실제보다 높게 잡힙니다</div>
          <div className="text-sm text-amber-600 mt-0.5 mb-2">아래 (사업자·몰) 요율을 알려주시면 반영하겠습니다. (또는 Supabase <span className="font-mono">mall_fees</span> 표에 추가)</div>
          <div className="flex flex-wrap gap-2">
            {missingFee.map((m, i) => (
              <span key={i} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white border border-amber-200 text-sm text-gray-700">
                {m.company} · {m.mall} <span className="text-amber-500">· {won(m.rev)}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* KPI 카드 */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard title={`매출 (${ranges.label})`} value={won(cur.rev)} delta={revDelta} prevLabel={ranges.prevLabel} accent="blue" loading={loading} />
        <KpiCard title="공헌이익" value={won(cur.prof)} delta={profDelta} prevLabel={ranges.prevLabel} accent="green" loading={loading}
          sub={['부가세 제외', cur.fee > 0 ? `수수료 ${won(cur.fee)}` : '', cur.unim > 0 ? `운임 ${won(cur.unim)}` : '', missingCount > 0 ? '원가 미입력分 제외' : ''].filter(Boolean).map((s) => `※ ${s}`).join(' · ') || undefined} />
        <KpiCard title="공헌이익률" value={marginPct === null ? '-' : `${marginPct}%`} accent="violet" loading={loading}
          sub={cur.mrev > 0 && cur.mrev < cur.rev ? '※ 원가 확인된 매출 기준' : undefined} />
        {/* 주문 건수 + 택배 출고 건수 (한 칸을 둘로 분할) */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 flex items-stretch">
          {loading ? (
            <div className="w-full h-14 animate-pulse bg-gray-100 rounded" />
          ) : (
            <>
              <div className="flex-1 min-w-0">
                <div className="text-sm text-gray-400">주문 건수</div>
                <div className="text-2xl font-bold text-gray-700 mt-0.5">{cur.cnt.toLocaleString('ko-KR')}건</div>
                <div className="text-[11px] text-gray-400 mt-0.5">판매수량 {cur.qty.toLocaleString('ko-KR')}개</div>
              </div>
              <div className="w-px bg-gray-100 mx-3" />
              <div className="flex-1 min-w-0">
                <div className="text-sm text-gray-400">택배 출고</div>
                <div className="text-2xl font-bold text-teal-600 mt-0.5">{cur.courier.toLocaleString('ko-KR')}건</div>
                <div className="text-[11px] text-gray-400 mt-0.5">직접수령·화물 제외</div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* 추이 그래프 */}
      <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-gray-700">매출 추이</h3>
          <span className="text-sm text-gray-400">{companyFilter} · {period === 'day' ? '최근 14일' : period === 'week' ? '최근 8주' : period === 'month' ? '최근 6개월' : period === 'range' ? '선택 기간' : '월별'}</span>
        </div>
        {trend.length === 0 || trendMax <= 1 ? (
          <div className="text-base text-gray-400 text-center py-12">표시할 데이터가 없습니다</div>
        ) : (
          <div className={`flex items-stretch gap-1 h-52 ${trend.length > 16 ? 'overflow-x-auto' : ''}`}>
            {trend.map((t, i) => (
              <div key={i} className="flex-1 min-w-[28px] flex flex-col items-center group">
                {/* 막대 영역 (값 라벨 + 막대) */}
                <div className="flex-1 w-full flex flex-col items-center justify-end gap-1.5 min-h-0">
                  <div className={`text-[11px] whitespace-nowrap ${t.isCurrent ? 'text-blue-600 font-semibold' : 'text-gray-400'}`}>{t.rev > 0 ? wonShort(t.rev) : ''}</div>
                  <div className={`w-7 rounded-t-md transition-all ${t.isCurrent ? 'bg-blue-500' : 'bg-blue-200'} group-hover:bg-blue-400`}
                    style={{ height: `${Math.max(t.rev > 0 ? 3 : 0, (t.rev / trendMax) * 100)}%` }} title={`${t.label} · ${won(t.rev)}`} />
                </div>
                <div className={`mt-2 text-xs whitespace-nowrap ${t.isCurrent ? 'text-blue-600 font-medium' : 'text-gray-400'}`}>{t.label}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 사업자별 / 몰별 분석 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
          <h3 className="font-semibold text-gray-700 mb-4">사업자별 매출</h3>
          {byCompany.length === 0 ? <Empty /> : (
            <div className="overflow-x-auto">
              <table className="w-full text-base">
                <thead>
                  <tr className="text-left text-sm text-gray-400 border-b">
                    <th className="py-2 pr-3">사업자</th><th className="py-2 pr-3 text-right">매출</th>
                    <th className="py-2 pr-3 text-right">공헌이익</th><th className="py-2 pr-3 text-right">공헌이익률</th>
                  </tr>
                </thead>
                <tbody>
                  {byCompany.map((c) => (
                    <tr key={c.name} className="border-b border-gray-50">
                      <td className="py-2 pr-3 font-medium text-gray-700">{c.name}</td>
                      <td className="py-2 pr-3 text-right text-gray-700">{won(c.rev)}</td>
                      <td className="py-2 pr-3 text-right text-gray-500">{c.mrev > 0 ? won(c.prof) : '-'}</td>
                      <td className="py-2 pr-3 text-right text-gray-500">{c.mrev > 0 ? `${Math.round((c.prof / c.mrev) * 100)}%` : '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
          <h3 className="font-semibold text-gray-700 mb-4">판매몰별 매출</h3>
          {byMall.length === 0 ? <Empty /> : (
            <div className="overflow-x-auto">
              <table className="w-full text-base">
                <thead>
                  <tr className="text-left text-sm text-gray-400 border-b">
                    <th className="py-2 pr-3">판매몰</th><th className="py-2 pr-3 text-right">매출</th>
                    <th className="py-2 pr-3 text-right">공헌이익</th><th className="py-2 pr-3 text-right">공헌이익률</th>
                  </tr>
                </thead>
                <tbody>
                  {byMall.map((m) => (
                    <tr key={m.name} className="border-b border-gray-50">
                      <td className="py-2 pr-3 font-medium text-gray-700">{m.name}</td>
                      <td className="py-2 pr-3 text-right text-gray-700">{won(m.rev)}</td>
                      <td className="py-2 pr-3 text-right text-gray-500">{m.mrev > 0 ? won(m.prof) : '-'}</td>
                      <td className="py-2 pr-3 text-right text-gray-500">{m.mrev > 0 ? `${Math.round((m.prof / m.mrev) * 100)}%` : '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* 브랜드별 매출 (사업자 필터 반영) */}
      <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-gray-700">브랜드별 매출</h3>
          <span className="text-sm text-gray-400">
            {companyFilter === '전체' ? '전 사업자 합산' : `${companyFilter} · 현재분만(과거 브랜드실적 제외)`} · {ranges.label}
          </span>
        </div>
        {byBrand.length === 0 ? <Empty /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-base">
              <thead>
                <tr className="text-left text-sm text-gray-400 border-b">
                  <th className="py-2 pr-3">브랜드</th><th className="py-2 pr-3 text-right">매출</th>
                  <th className="py-2 pr-3 text-right">공헌이익</th><th className="py-2 pr-3 text-right">공헌이익률</th>
                </tr>
              </thead>
              <tbody>
                {byBrand.slice(0, 30).map((b) => (
                  <tr key={b.name} className="border-b border-gray-50">
                    <td className="py-2 pr-3 font-medium text-gray-700">{b.name}</td>
                    <td className="py-2 pr-3 text-right text-gray-700">{won(b.sales)}</td>
                    <td className="py-2 pr-3 text-right text-gray-500">{won(b.margin)}</td>
                    <td className="py-2 pr-3 text-right text-gray-500">{b.sales > 0 ? `${Math.round((b.margin / b.sales) * 100)}%` : '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {byBrand.length > 30 && <p className="text-sm text-gray-400 text-center mt-3">상위 30개 표시 (전체 {byBrand.length}개)</p>}
          </div>
        )}
      </div>

      <p className="text-sm text-gray-400">
        ※ 매출은 주문 변환·저장된 데이터(취소 제외)를 실시간 집계합니다. 모든 금액은 부가세 제외(공급가액) 기준입니다.
        매출 = (상품금액 + 고객배송비) ÷ 1.1. 공헌이익 = (상품금액 + 고객배송비 − 몰수수료 − 원가 − 실운임) ÷ 1.1.
        고객배송비·실운임은 합구매(같은 주문번호) 주문당 1회만 반영. 실운임 건당 {UNIT_SHIPPING.toLocaleString('ko-KR')}원. 수수료율은 사업자·판매몰별이며 mall_fees에서 수정 가능. 공헌이익률 = 공헌이익 ÷ 매출.
      </p>
    </div>
  );
}

function KpiCard({ title, value, delta, prevLabel, sub, accent, loading }: {
  title: string; value: string; delta?: number | null; prevLabel?: string; sub?: string;
  accent: 'blue' | 'green' | 'violet' | 'gray'; loading?: boolean;
}) {
  const accentMap = { blue: 'text-blue-600', green: 'text-green-600', violet: 'text-violet-600', gray: 'text-gray-700' };
  return (
    <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
      <div className="text-sm text-gray-400 mb-1">{title}</div>
      <div className={`text-2xl font-bold ${accentMap[accent]}`}>{loading ? '…' : value}</div>
      {delta !== undefined && delta !== null && (
        <div className={`text-sm mt-1 ${delta >= 0 ? 'text-green-500' : 'text-red-500'}`}>
          {delta >= 0 ? '▲' : '▼'} {Math.abs(delta)}% <span className="text-gray-400">({prevLabel} 대비)</span>
        </div>
      )}
      {delta === null && prevLabel && <div className="text-sm mt-1 text-gray-300">{prevLabel} 대비 -</div>}
      {sub && <div className="text-xs text-gray-400 mt-1">{sub}</div>}
    </div>
  );
}

function Empty() {
  return <div className="text-base text-gray-400 text-center py-8">표시할 데이터가 없습니다</div>;
}
