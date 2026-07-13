'use client';

import { useState, useRef, useEffect } from 'react';
import { convertOrders, buildSupabaseRows, matchProduct, loadDbMatches, type ConvertedOrderRow, type RawOrderRow } from '@/lib/orderConvert';
import { supabaseFetch, supabaseFetchAll, supabaseUpload, safeStorageKey } from '@/lib/supabase';
import { getUser } from '@/lib/auth';

type Tab = 'convert' | 'history' | 'manage' | 'register' | 'log';
type ChangeLogRow = {
  id: string; order_id: string; action: string; detail?: string; changed_by?: string; created_at: string;
  _order?: { product_name?: string; order_number?: string; company?: string; mall_name?: string };
};
type Status = { type: 'info' | 'success' | 'error'; msg: string } | null;

// 사업자 선택 (값은 재고 테이블의 company 표기와 정확히 일치해야 함)
const COMPANY_OPTIONS = [
  { value: 'BNKNET', label: '비앤케이넷 (BNKNET)' },
  { value: '더블아이', label: '더블아이' },
  { value: 'SJ글로벌', label: 'SJ글로벌' },
  { value: 'IX글로벌', label: 'IX글로벌' },
];

// 직접 등록 시 판매몰 선택지 (정규 몰명 — 수수료표와 일치)
const MALL_OPTIONS = ['스마트스토어', 'G마켓', '옥션', '11번가', '쿠팡', '토스', '쿠팡로켓그로스', 'SSG', 'Hmall', '롯데온', '인터파크', '카카오스토어', '자사몰Npay', '자사몰직접결제'];

// 수량 치환이 시스템이 못 잡는 표기(개입/매/병/팩/1+1 등)를 감지 → 담당자 검수용.
// 현재 인식 단위는 개/박스/포/세트뿐. 아래 표기는 수량이 과소/과대될 수 있어 눈으로 확인 필요.
const QTY_RISK_UNIT = /[0-9]\s*(개입|매|병|팩|셋트|묶음|입)/;
const QTY_RISK_PLUS = /[0-9]\s*\+\s*[0-9]/; // 1+1, 2+1 등 증정
function qtyRiskReason(row: Record<string, unknown>): string {
  const s = `${String(row['★수집상품명'] ?? row['수집상품명'] ?? '')} ${String(row['★수집옵션'] ?? row['수집옵션'] ?? '')}`;
  if (QTY_RISK_PLUS.test(s)) return '1+1 등 증정 표기 — 수량 확인';
  if (QTY_RISK_UNIT.test(s)) return '개입/매/병/팩 등 미인식 단위 — 수량 확인';
  return '';
}

interface InvItem { id: string; product_name: string; company: string; cost_price?: number; quantity?: number }
interface ManualLine { key: number; invId: string; productName: string; qty: number; amount: number; cost: number; shipping: number }
const todayStr = () => new Date().toISOString().slice(0, 10);

// 재고 자동출고 결과 경고
interface ShipWarn {
  unmatched: { name: string; cnt: number; qty: number }[]; // 재고 매칭 실패 (자동출고 안 됨)
  negative: { product_name: string; company: string; after: number }[]; // 출고 후 재고 마이너스
  shipped: number;
}

interface OrderRow {
  id: string;
  upload_date: string;
  order_number: string;
  recipient_name?: string;
  mall_name?: string;
  product_name?: string;
  quantity?: number;
  amount?: number;
  tracking_number?: string;
  canceled?: boolean;
  source?: string;
  company?: string;
  manual_cost?: number;
  manual_shipping?: number;
}

interface UploadHistory {
  id: string;
  uploaded_at: string;
  uploader?: string;
  file_name?: string;
  file_url?: string;
  row_count?: number;
  saved_count?: number;
  ref_order_number?: string; // 직접등록 배치의 주문번호 (클릭 시 상세 조회용)
}

interface ChangeLog { id: string; action: string; detail?: string; changed_by?: string; created_at: string }

export default function OrdersContent() {
  const me = getUser();
  const canDelete = me?.role === 'ceo' || me?.role === 'admin';
  const canViewHistory = me?.role === 'ceo' || me?.role === 'admin'; // 주문 변경 이력은 대표·실장만

  const [tab, setTab] = useState<Tab>('convert');
  const [changeLogs, setChangeLogs] = useState<ChangeLogRow[]>([]); // 주문 변경 로그(대표·실장 전용)
  const [logLoading, setLogLoading] = useState(false);
  const [status, setStatus] = useState<Status>(null);
  const [resultData, setResultData] = useState<ConvertedOrderRow[]>([]);
  const [headerOrder, setHeaderOrder] = useState<string[]>([]);
  const [fileName, setFileName] = useState('');
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [history, setHistory] = useState<UploadHistory[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  // 업로드 이력 상세 (직접등록·수정 내용 조회)
  const [detailUpload, setDetailUpload] = useState<UploadHistory | null>(null);
  const [detailOrders, setDetailOrders] = useState<OrderRow[]>([]);
  const [detailLogs, setDetailLogs] = useState<ChangeLog[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 사업자 선택 + 재고 자동출고 경고
  const [company, setCompany] = useState('');
  const [saving, setSaving] = useState(false);
  const [shipWarn, setShipWarn] = useState<ShipWarn | null>(null);

  // 직접 주문 등록
  const canRegister = me?.role === 'ceo' || me?.role === 'admin' || me?.role === 'inventory';
  const [mType, setMType] = useState<'normal' | 'wholesale'>('normal');
  const [mCompany, setMCompany] = useState('');
  const [mDate, setMDate] = useState(todayStr());
  const [mMall, setMMall] = useState('');
  const [mPartner, setMPartner] = useState('');
  const [mShipMethod, setMShipMethod] = useState<'택배' | '직접수령' | '화물'>('택배'); // 출고방식
  const [mCourierCount, setMCourierCount] = useState<number>(1); // 택배 출고 건수
  const [mLines, setMLines] = useState<ManualLine[]>([{ key: 1, invId: '', productName: '', qty: 1, amount: 0, cost: 0, shipping: 0 }]);
  const [inv, setInv] = useState<InvItem[]>([]);
  const [invLoaded, setInvLoaded] = useState(false);
  const [mStatus, setMStatus] = useState<Status>(null);

  async function loadInventory() {
    try {
      const data = await supabaseFetchAll<InvItem>('/inventory?select=id,product_name,company,cost_price,quantity');
      setInv(data); setInvLoaded(true);
    } catch { setInvLoaded(true); }
  }

  const invForCompany = mCompany ? inv.filter((i) => i.company === mCompany) : [];

  function setLine(key: number, patch: Partial<ManualLine>) {
    setMLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }
  function pickProduct(key: number, invId: string) {
    const it = inv.find((i) => i.id === invId);
    setLine(key, { invId, productName: it?.product_name || '', cost: mType === 'wholesale' ? (Number(it?.cost_price) || 0) : 0 });
  }
  function addLine() { setMLines((ls) => [...ls, { key: Math.max(0, ...ls.map((l) => l.key)) + 1, invId: '', productName: '', qty: 1, amount: 0, cost: 0, shipping: 0 }]); }
  function removeLine(key: number) { setMLines((ls) => (ls.length > 1 ? ls.filter((l) => l.key !== key) : ls)); }

  // 도매 예상 공헌이익 = (매출 − 원가(개당×수량) − 배송비) ÷ 1.1  (모두 부가세 포함 입력)
  //   공헌이익률 = 공헌이익 ÷ 매출 (부가세 제외 기준, ÷1.1 상쇄되어 net÷매출과 동일)
  const mWhole = mLines.reduce((a, l) => { a.amt += l.amount; a.net += (l.amount - l.cost * l.qty - l.shipping); return a; }, { amt: 0, net: 0 });
  const mWholesaleMargin = Math.round(mWhole.net / 1.1);
  const mWholesaleRate = mWhole.amt > 0 ? Math.round((mWhole.net / mWhole.amt) * 100) : null;

  async function handleManualSave() {
    if (!canRegister) { alert('주문 등록 권한이 없습니다 (재고·주문담당/대표/실장).'); return; }
    if (!mCompany) { alert('사업자를 선택하세요.'); return; }
    const mall = mType === 'wholesale' ? (mMall || '도매') : mMall;
    if (!mall) { alert(mType === 'wholesale' ? '채널(도매/직거래)을 선택하세요.' : '판매몰을 선택하세요.'); return; }
    const valid = mLines.filter((l) => l.invId && l.qty > 0 && l.amount > 0);
    if (!valid.length) { alert('상품·수량·매출금액을 입력한 품목이 1개 이상 필요합니다.'); return; }

    setSaving(true); setMStatus({ type: 'info', msg: '⏳ 등록 중...' }); setShipWarn(null);
    try {
      const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
      const orderNo = `M-${mDate.replace(/-/g, '')}-${rand}`;
      const isW = mType === 'wholesale';
      const rows = valid.map((l) => ({
        upload_date: mDate, company: mCompany, order_number: orderNo, recipient_name: mPartner,
        mall_name: mall, product_name: l.productName, collect_product: l.productName,
        quantity: l.qty, amount: l.amount, is_bundle: valid.length > 1,
        source: isW ? '도매' : '수기',
        manual_cost: isW ? l.cost : null, manual_shipping: isW ? l.shipping : null,
        shipping_method: mShipMethod,
        // 택배 출고 건수: 택배일 때만 기록(주문 전체 기준 동일값 → 매출현황에서 주문당 1회 집계)
        courier_count: mShipMethod === '택배' ? (Number(mCourierCount) || 1) : null,
      }));

      const res = await supabaseFetch('/orders', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify(rows) });
      if (!res.ok) throw new Error('save');
      const saved: { id: string; product_name?: string; quantity?: number }[] = await res.json();

      await supabaseFetch('/order_uploads', {
        method: 'POST', headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ uploader: me?.name || '', file_name: `[직접등록${isW ? '·도매' : ''}] ${mall} ${valid.length}건`, file_url: null, row_count: valid.length, saved_count: valid.length, ref_order_number: orderNo }),
      });

      // 변경 이력: 등록 로그 (도매/직접) — 어떤 제품이 어떻게 등록됐는지 기록
      try {
        const logs = saved.map((o, i) => ({
          order_id: o.id, action: '등록', changed_by: me?.name || '',
          detail: `상품: ${o.product_name} · 수량: ${valid[i]?.qty} · 매출: ${(valid[i]?.amount || 0).toLocaleString()}` +
            (isW ? ` · 원가(개당): ${(valid[i]?.cost || 0).toLocaleString()} · 배송비: ${(valid[i]?.shipping || 0).toLocaleString()}` : ''),
        }));
        if (logs.length) await supabaseFetch('/order_change_logs', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(logs) });
      } catch { /* 로그 실패는 등록에 영향 없음 */ }

      // 재고 자동출고 (선택한 상품 = 재고와 일치하므로 매칭 보장)
      const invMap = new Map<string, string>();
      for (const it of inv) { if (it.product_name) invMap.set(`${it.product_name}|${it.company}`, it.id); }
      const moves = saved.map((o) => {
        const invId = invMap.get(`${o.product_name}|${mCompany}`);
        return invId ? { order_id: o.id, inventory_id: invId, quantity: Number(o.quantity) || 0, product_name: o.product_name, company: mCompany, created_by: me?.name || '' } : null;
      }).filter(Boolean);
      let shipped = 0; const negative: ShipWarn['negative'] = [];
      if (moves.length) {
        const shipRes = await supabaseFetch('/rpc/ship_orders', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ p_moves: moves }) });
        if (shipRes.ok) { const r = await shipRes.json(); shipped = r?.shipped ?? 0; if (Array.isArray(r?.negative)) negative.push(...r.negative); }
      }
      if (negative.length) setShipWarn({ unmatched: [], negative, shipped });

      setMStatus({ type: 'success', msg: `✅ ${isW ? '도매' : '직접'} 주문 ${valid.length}건 등록 완료 · 재고 차감 ${shipped}건 (주문번호 ${orderNo})` });
      setMLines([{ key: 1, invId: '', productName: '', qty: 1, amount: 0, cost: 0, shipping: 0 }]);
      setMPartner('');
    } catch {
      setMStatus({ type: 'error', msg: '❌ 등록 중 오류가 발생했습니다. (설정 db/manual_orders.sql 적용 여부 확인)' });
    } finally { setSaving(false); }
  }

  // 주문 조회/취소
  const [sOrderNo, setSOrderNo] = useState('');
  const [sProduct, setSProduct] = useState('');
  const [sMall, setSMall] = useState('');
  const [sCompany, setSCompany] = useState('전체'); // 조회·취소 탭 사업자 필터
  const [sFrom, setSFrom] = useState('');
  const [sTo, setSTo] = useState('');
  const [orderList, setOrderList] = useState<OrderRow[]>([]);
  const [orderChecked, setOrderChecked] = useState<Set<string>>(new Set());
  const [orderLoading, setOrderLoading] = useState(false);
  const [undeductedCount, setUndeductedCount] = useState<number | null>(null); // 재고 미차감 실주문 건수(상시 감시)
  const [undeductedList, setUndeductedList] = useState<{ id: string; product: string; company: string; qty: number; matched: boolean }[]>([]);
  const [showUndeducted, setShowUndeducted] = useState(false); // 배너 클릭 시 상세 표시
  // 도매 주문 수정
  const [editOrder, setEditOrder] = useState<OrderRow | null>(null);
  const [editForm, setEditForm] = useState({ invId: '', qty: 1, amount: 0, cost: 0, shipping: 0 });
  const [editLogs, setEditLogs] = useState<{ id: string; action: string; detail?: string; changed_by?: string; created_at: string }[]>([]);
  const [editSaving, setEditSaving] = useState(false);

  async function searchOrders(opts?: { from?: string; to?: string; company?: string }) {
    const from = opts?.from !== undefined ? opts.from : sFrom;
    const to = opts?.to !== undefined ? opts.to : sTo;
    const comp = opts?.company !== undefined ? opts.company : sCompany;
    setOrderLoading(true);
    setOrderChecked(new Set());
    try {
      let q = '/orders?select=id,upload_date,order_number,recipient_name,mall_name,product_name,quantity,amount,tracking_number,canceled,source,company,manual_cost,manual_shipping&order=upload_date.desc';
      if (sOrderNo.trim()) q += `&order_number=ilike.*${encodeURIComponent(sOrderNo.trim())}*`;
      if (sProduct.trim()) q += `&product_name=ilike.*${encodeURIComponent(sProduct.trim())}*`;
      if (sMall.trim()) q += `&mall_name=ilike.*${encodeURIComponent(sMall.trim())}*`;
      if (comp !== '전체') q += `&company=eq.${encodeURIComponent(comp)}`;
      if (from) q += `&upload_date=gte.${from}`;
      if (to) q += `&upload_date=lte.${to}`;
      // 조건(날짜/검색어)이 있으면 해당 범위 "전부" 조회(1000건 초과도 페이지네이션). 조건 없으면 최근 1000건만.
      const hasFilter = !!(from || to || sOrderNo.trim() || sProduct.trim() || sMall.trim() || comp !== '전체');
      let data: OrderRow[];
      if (hasFilter) {
        data = await supabaseFetchAll<OrderRow>(q);
      } else {
        const res = await supabaseFetch(q + '&limit=1000');
        const j = await res.json();
        data = Array.isArray(j) ? j : [];
      }
      setOrderList(data);
    } catch { setOrderList([]); }
    finally { setOrderLoading(false); }
  }

  async function cancelSelectedOrders() {
    if (orderChecked.size === 0) { alert('취소할 주문을 선택하세요.'); return; }
    if (!confirm(`선택한 ${orderChecked.size}건을 취소 처리하시겠습니까?\n(매출·공헌이익에서 제외 + 차감했던 재고는 자동 복구됩니다)`)) return;
    const reason = (prompt('취소 사유를 입력하세요 (선택)', '고객 취소') || '주문 취소').trim();
    const ids = Array.from(orderChecked);
    try {
      // 취소 + 재고 복구를 한 트랜잭션(RPC)으로 처리 — 반쪽 반영 방지
      const res = await supabaseFetch('/rpc/cancel_orders', {
        method: 'POST', headers: { Prefer: 'return=representation' },
        body: JSON.stringify({ p_order_ids: ids, p_reason: reason, p_by: me?.name || '' }),
      });
      if (!res.ok) throw new Error(String(res.status));
      const r = await res.json();
      // 변경 로그 기록 (건별)
      await supabaseFetch('/order_change_logs', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(ids.map(oid => ({ order_id: oid, action: '취소', detail: reason, changed_by: me?.name || '' }))) }).catch(() => {});
      alert(`✅ ${r?.canceled ?? ids.length}건 취소 처리 완료 (재고 복구 ${r?.restored ?? 0}건)`);
    } catch {
      alert('❌ 취소 처리 중 오류가 발생했습니다. (재고 정합성 보호를 위해 변경이 모두 취소되었습니다)\n설정(db/order_inventory_sync.sql)이 적용됐는지 확인해주세요.');
    }
    await searchOrders();
  }

  async function uncancelSelectedOrders() {
    if (orderChecked.size === 0) return;
    if (!confirm(`선택한 ${orderChecked.size}건의 취소를 해제하시겠습니까?\n(매출에 다시 포함 + 복구했던 재고는 다시 차감됩니다)`)) return;
    const ids = Array.from(orderChecked);
    try {
      const res = await supabaseFetch('/rpc/uncancel_orders', {
        method: 'POST', headers: { Prefer: 'return=representation' },
        body: JSON.stringify({ p_order_ids: ids, p_by: me?.name || '' }),
      });
      if (!res.ok) throw new Error(String(res.status));
      const r = await res.json();
      await supabaseFetch('/order_change_logs', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(ids.map(oid => ({ order_id: oid, action: '취소해제', detail: '취소 해제(매출 재포함·재고 재차감)', changed_by: me?.name || '' }))) }).catch(() => {});
      alert(`✅ ${r?.uncanceled ?? ids.length}건 취소 해제 완료 (재고 재차감 ${r?.rededucted ?? 0}건)`);
    } catch {
      alert('❌ 취소 해제 중 오류가 발생했습니다. (변경이 모두 취소되었습니다)');
    }
    await searchOrders();
  }

  async function partialCancelOrder() {
    if (orderChecked.size !== 1) { alert('부분취소/반품은 한 번에 1건만 선택하세요.'); return; }
    const id = Array.from(orderChecked)[0];
    const order = orderList.find(o => o.id === id);
    const maxQty = Number(order?.quantity) || 0;
    if (order?.canceled) { alert('이미 취소된 주문입니다.'); return; }
    if (maxQty < 1) { alert('수량 정보가 없는 주문입니다.'); return; }
    const isReturn = confirm('유형을 선택하세요.\n\n[확인] = 반품\n[취소] = 단순취소');
    const type = isReturn ? '반품' : '취소';
    const qtyStr = prompt(`${type}할 수량을 입력하세요 (현재 수량 ${maxQty}개)\n※ 전체 수량을 입력하면 주문 전체가 ${type} 처리됩니다.`, '1');
    if (qtyStr === null) return;
    const qty = parseInt(qtyStr, 10);
    if (!qty || qty < 1) { alert('수량을 올바르게 입력하세요.'); return; }
    if (qty > maxQty) { alert(`현재 수량(${maxQty}개)보다 많이 취소할 수 없습니다.`); return; }
    const reason = (prompt(`${type} 사유 (선택)`, type) || type).trim();
    try {
      const res = await supabaseFetch('/rpc/partial_cancel_order', {
        method: 'POST', headers: { Prefer: 'return=representation' },
        body: JSON.stringify({ p_order_id: id, p_cancel_qty: qty, p_reason: reason, p_type: type, p_by: me?.name || '' }),
      });
      if (!res.ok) throw new Error(String(res.status));
      const r = await res.json();
      if (r?.error) { alert(`❌ ${r.error}`); return; }
      const detail = r?.full_canceled ? `${qty}개 ${type} → 전체 취소 · 사유: ${reason}` : `${qty}개 ${type}(남은 ${r?.new_qty}개) · 사유: ${reason}`;
      await supabaseFetch('/order_change_logs', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ order_id: id, action: `부분${type}`, detail, changed_by: me?.name || '' }) }).catch(() => {});
      if (r?.full_canceled) alert(`✅ 전체 수량 ${type} → 주문 전체가 취소 처리되었습니다 (재고 복구됨).`);
      else alert(`✅ ${qty}개 ${type} 처리 완료 (남은 수량 ${r?.new_qty}개, 금액·재고 자동 반영).`);
      setOrderChecked(new Set());
    } catch {
      alert('❌ 부분취소 처리 중 오류. (db/partial_cancel.sql 적용 여부 확인)');
    }
    await searchOrders();
  }

  // 미차감 주문 재고 재출고 — 자동출고 실패분 일괄 복구 (재변환 없이)
  // 재고 미차감 실주문 집계 (과거·도매 제외) — 상시 경고 + 상세 목록
  async function refreshUndeductedCount() {
    try {
      await loadDbMatches(true); // 최신 매칭 반영해 매칭여부 판정
      const rows = await supabaseFetchAll<{ id: string; collect_product?: string; product_name?: string; company?: string; quantity?: number; source?: string }>(
        '/orders?stock_deducted=eq.false&canceled=eq.false&select=id,collect_product,product_name,company,quantity,source',
      );
      const targets = rows.filter(o => o.source !== '과거' && o.source !== '도매');
      setUndeductedCount(targets.length);
      setUndeductedList(targets.map(o => {
        const m = matchProduct(o.collect_product || o.product_name || '');
        return { id: o.id, product: m.name, company: o.company || '', qty: Number(o.quantity) || 0, matched: m.matched };
      }));
    } catch { setUndeductedCount(null); setUndeductedList([]); }
  }

  // 마운트 시 미차감 건수 로드 (변환 탭이 기본이라 배너/버튼 노출용)
  useEffect(() => { if (canRegister) refreshUndeductedCount(); }, [canRegister]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { loadDbMatches(); }, []); // 담당자 등록 매칭을 미리 로드(변환·재고매칭에 반영)

  // 도매 주문 수정 모달 열기 (+ 변경 이력 로드)
  async function openEditOrder(o: OrderRow) {
    if (!canRegister) return;
    if (!invLoaded) await loadInventory();
    const cur = inv.find(i => i.product_name === o.product_name && i.company === (o.company || ''));
    setEditForm({ invId: cur?.id || '', qty: Number(o.quantity) || 0, amount: Number(o.amount) || 0, cost: Number(o.manual_cost) || 0, shipping: Number(o.manual_shipping) || 0 });
    try {
      const logs = await supabaseFetchAll<{ id: string; action: string; detail?: string; changed_by?: string; created_at: string }>(`/order_change_logs?order_id=eq.${o.id}&select=id,action,detail,changed_by,created_at&order=created_at.desc`);
      setEditLogs(Array.isArray(logs) ? logs : []);
    } catch { setEditLogs([]); }
    setEditOrder(o);
  }

  async function saveEditOrder() {
    if (!editOrder) return;
    const it = inv.find(i => i.id === editForm.invId);
    if (!it) { alert('상품을 선택하세요.'); return; }
    if ((Number(editForm.qty) || 0) < 1 || (Number(editForm.amount) || 0) <= 0) { alert('수량·매출금액을 확인하세요.'); return; }
    setEditSaving(true);
    try {
      const res = await supabaseFetch('/rpc/update_manual_order', {
        method: 'POST', headers: { Prefer: 'return=representation' },
        body: JSON.stringify({
          p_order_id: editOrder.id, p_inventory_id: editForm.invId, p_product_name: it.product_name,
          p_qty: Number(editForm.qty) || 0, p_amount: Number(editForm.amount) || 0,
          p_cost: Number(editForm.cost) || 0, p_shipping: Number(editForm.shipping) || 0, p_by: me?.name || '',
        }),
      });
      const txt = await res.text();
      if (!res.ok) { alert(`수정 실패 (HTTP ${res.status})\n${txt}`); return; }
      const won = (n: number) => Number(n || 0).toLocaleString();
      const detail = `상품: ${editOrder.product_name} → ${it.product_name} · 수량: ${editOrder.quantity} → ${editForm.qty} · 매출: ${won(editOrder.amount || 0)} → ${won(editForm.amount)} · 원가(개당): ${won(editOrder.manual_cost || 0)} → ${won(editForm.cost)} · 배송비: ${won(editOrder.manual_shipping || 0)} → ${won(editForm.shipping)}`;
      await supabaseFetch('/order_change_logs', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ order_id: editOrder.id, action: '수정', detail, changed_by: me?.name || '' }) }).catch(() => {});
      setEditOrder(null);
      await searchOrders();
      await refreshUndeductedCount();
    } catch (e) { alert('수정 중 오류: ' + ((e as Error)?.message || e)); }
    finally { setEditSaving(false); }
  }

  async function reshipUndeducted() {
    if (!canRegister) { alert('권한이 없습니다.'); return; }
    if (!confirm('재고 자동출고가 안 된 주문들을 다시 출고 처리합니다.\n(이미 차감된 건은 건너뜁니다) 진행할까요?')) return;
    try {
      await loadDbMatches(true); // 방금 추가한 매칭까지 반영해 재출고
      const undeducted = await supabaseFetchAll<{ id: string; collect_product?: string; product_name?: string; quantity?: number; company?: string; source?: string }>(
        '/orders?stock_deducted=eq.false&canceled=eq.false&select=id,collect_product,product_name,quantity,company,source',
      );
      const targets = undeducted.filter(o => o.source !== '과거' && o.source !== '도매'); // 사방넷/일반/수기만
      if (!targets.length) { alert('재출고할 미차감 주문이 없습니다.'); return; }
      const inv = await supabaseFetchAll<{ id: string; product_name: string; company: string }>('/inventory?select=id,product_name,company');
      // 대표명↔재고 매칭: 정확 일치 → 실패 시 띄어쓰기·쉼표 무시(정규화) 폴백. (등록했는데 한 칸 차이로 못 찾던 문제 해결)
      const nk = (s: string) => s.replace(/\s+/g, '').replace(/,/g, '');
      const invMap = new Map<string, string>();
      const invMapNorm = new Map<string, string>();
      for (const it of inv) {
        if (!it.product_name) continue;
        const co = it.company || '';
        const k = `${it.product_name}|${co}`; if (!invMap.has(k)) invMap.set(k, it.id);
        const nkey = `${nk(it.product_name)}|${co}`; if (!invMapNorm.has(nkey)) invMapNorm.set(nkey, it.id);
      }
      const findInv = (name: string, company: string) => invMap.get(`${name}|${company}`) ?? invMapNorm.get(`${nk(name)}|${company}`);
      // 세트 구성표 (세트명 → 구성품·수량)
      const bom = await supabaseFetchAll<{ set_name: string; component_name: string; component_qty: number }>('/product_bom?select=set_name,component_name,component_qty');
      const bomMap = new Map<string, { component_name: string; component_qty: number }[]>();
      for (const b of bom) { const a = bomMap.get(b.set_name) || []; a.push({ component_name: b.component_name, component_qty: Number(b.component_qty) || 1 }); bomMap.set(b.set_name, a); }
      const moves: Record<string, unknown>[] = [];
      let unmatchedCnt = 0;
      const unmatchedNames = new Set<string>();
      for (const o of targets) {
        const rep = matchProduct(o.collect_product || o.product_name || '').name;
        const qty = Number(o.quantity) || 0;
        const set = bomMap.get(rep);
        if (set) {
          // 세트: 구성품 각각 (주문수량 × 구성수량) 차감. 구성품 재고 하나라도 없으면 미차감(안전)
          const comps: Record<string, unknown>[] = [];
          let allFound = true;
          for (const b of set) {
            const cid = findInv(b.component_name, o.company || '');
            if (!cid) { allFound = false; break; }
            comps.push({ inventory_id: cid, product_name: b.component_name, quantity: qty * b.component_qty });
          }
          if (allFound) moves.push({ order_id: o.id, company: o.company || '', created_by: me?.name || '', components: comps });
          else { unmatchedCnt++; unmatchedNames.add(`${rep} (${o.company || '사업자미상'})`); }
          continue;
        }
        const invId = findInv(rep, o.company || '');
        if (invId) moves.push({ order_id: o.id, inventory_id: invId, quantity: qty, product_name: rep, company: o.company || '', created_by: me?.name || '' });
        else { unmatchedCnt++; unmatchedNames.add(`${rep} (${o.company || '사업자미상'})`); }
      }
      const unmatchedDetail = unmatchedNames.size ? `\n\n미매칭 상세:\n· ${Array.from(unmatchedNames).slice(0, 15).join('\n· ')}\n\n→ 해당 사업자 재고에 이 상품명이 등록돼 있는지 확인하세요. (매칭은 됐어도 그 사업자 재고에 없으면 차감 불가)` : '';
      if (!moves.length) { alert(`재출고할 게 없습니다. 매칭되는 재고가 없어요. (미매칭 ${unmatchedCnt}건)${unmatchedDetail}`); return; }
      const res = await supabaseFetch('/rpc/ship_orders', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ p_moves: moves }) });
      const txt = await res.text();
      if (!res.ok) { alert(`❌ 재출고 실패 (HTTP ${res.status})\n\n원인: ${txt}`); return; }
      const r = JSON.parse(txt);
      alert(`✅ 재출고 완료\n· 재고 차감: ${r.shipped ?? 0}건\n· 건너뜀(이미 차감): ${r.skipped ?? 0}건\n· 매칭 안 됨: ${unmatchedCnt}건${Array.isArray(r.negative) && r.negative.length ? `\n· ⚠️ 재고 마이너스: ${r.negative.length}건` : ''}${unmatchedCnt ? '\n\n⚠️ 매칭 안 된 건은 매칭데이터/재고 등록 후 다시 눌러야 재고가 차감됩니다.' : ''}`);
      await searchOrders();
      await refreshUndeductedCount();
    } catch (e) { alert('❌ 재출고 중 오류: ' + ((e as Error)?.message || e)); }
  }

  // 주문 삭제(재고 복구 포함): 삭제 전 cancel_orders로 차감했던 재고를 원자적으로 복구한 뒤 행 삭제.
  // (cancel_orders는 이미 취소된 건은 건너뛰므로 이중복구 없음) 매출은 행이 사라지면서 자동 제외.
  async function deleteOrdersWithRestore(ids: string[], context = ''): Promise<boolean> {
    // 삭제 전에 로그용 정보 확보(삭제 후엔 못 읽음). URL 길이 회피 위해 200개씩.
    const infos: { id: string; product_name?: string; order_number?: string; quantity?: number; company?: string; mall_name?: string }[] = [];
    for (let i = 0; i < ids.length; i += 200) {
      try {
        const r = await supabaseFetch(`/orders?id=in.(${ids.slice(i, i + 200).join(',')})&select=id,product_name,order_number,quantity,company,mall_name`);
        const d = await r.json();
        if (Array.isArray(d)) infos.push(...d);
      } catch { /* 무시 */ }
    }
    try {
      const res = await supabaseFetch('/rpc/cancel_orders', {
        method: 'POST', headers: { Prefer: 'return=representation' },
        body: JSON.stringify({ p_order_ids: ids, p_reason: '주문 삭제(재고 복구)', p_by: me?.name || '' }),
      });
      if (!res.ok) { alert(`❌ 재고 복구에 실패해 삭제를 중단했습니다 (HTTP ${res.status}). 재고 정합성 보호를 위해 아무 것도 변경하지 않았습니다.`); return false; }
    } catch { alert('❌ 재고 복구 중 오류로 삭제를 중단했습니다.'); return false; }
    const del = await supabaseFetch(`/orders?id=in.(${ids.join(',')})`, { method: 'DELETE' });
    if (!del.ok) { alert(`❌ 주문 삭제 실패 (HTTP ${del.status}). 재고는 이미 복구되었으니, 필요 시 취소 해제 후 다시 시도하세요.`); return false; }
    // 변경 로그에 '삭제' 기록 (order_change_logs는 FK 없어 주문 삭제돼도 남음)
    try {
      const rows = infos.map(o => ({
        order_id: o.id, action: '삭제',
        detail: `${o.mall_name ? o.mall_name + ' · ' : ''}${o.product_name || ''}${o.quantity ? ' ' + o.quantity + '개' : ''}${o.order_number ? ' · ' + o.order_number : ''}${o.company ? ' · ' + o.company : ''}${context ? ' · ' + context : ''} (재고 복구)`,
        changed_by: me?.name || '',
      }));
      if (rows.length) await supabaseFetch('/order_change_logs', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(rows) });
    } catch { /* 로그 실패는 삭제에 영향 없음 */ }
    return true;
  }

  async function deleteSelectedOrders() {
    if (orderChecked.size === 0) { alert('삭제할 주문을 선택하세요.'); return; }
    if (!confirm(`선택한 ${orderChecked.size}건을 완전히 삭제하시겠습니까?\n· 차감했던 재고는 자동 복구됩니다\n· 매출·공헌이익에서도 제외됩니다\n(삭제된 주문은 복구 불가)`)) return;
    const ids = Array.from(orderChecked);
    if (await deleteOrdersWithRestore(ids, '주문 개별삭제')) {
      setOrderChecked(new Set());
      await searchOrders();
      await refreshUndeductedCount();
    }
  }

  async function handleFile(file: File) {
    if (!file || !file.name.endsWith('.xlsx')) {
      setStatus({ type: 'error', msg: '❌ .xlsx 파일만 업로드 가능합니다' });
      return;
    }
    setFileName(file.name);
    setUploadedFile(file);
    setStatus({ type: 'info', msg: '⏳ 파일 처리 중...' });
    setResultData([]);

    try {
      const XLSX = await import('xlsx');
      const buffer = await file.arrayBuffer();
      const wb = XLSX.read(buffer, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const raw: RawOrderRow[] = XLSX.utils.sheet_to_json(ws, { defval: '' });

      if (!raw.length) {
        setStatus({ type: 'error', msg: '❌ 데이터가 없습니다' });
        return;
      }

      // 원본 파일의 열 순서·열 구성을 그대로 보존 (다운로드 시 사용)
      const headerRow = (XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' })[0] as unknown[]) || [];
      setHeaderOrder(headerRow.map((h) => String(h)).filter((h) => h !== ''));

      await loadDbMatches(true); // 담당자가 추가한 최신 매칭 반영 후 변환
      const converted = convertOrders(raw);
      setResultData(converted);
      const bundleCount = converted.filter((r) => r._is_bundle).length;
      const productCount = new Set(converted.map((r) => r['상품명']).filter(Boolean)).size;
      const qtyWarnCount = converted.filter((r) => qtyRiskReason(r as Record<string, unknown>)).length;
      setStatus({
        type: qtyWarnCount ? 'error' : 'success',
        msg: `✅ 변환 완료 — 총 ${converted.length}건 / 합구매 ${bundleCount}건 / 상품 ${productCount}종`
          + (qtyWarnCount ? ` · ⚠️ 수량 확인 필요 ${qtyWarnCount}건 (아래 노란 행 확인 후 송장 출력)` : ''),
      });
    } catch {
      setStatus({ type: 'error', msg: '❌ 파일 처리 중 오류가 발생했습니다' });
    }
  }

  async function handleDownload() {
    if (!resultData.length) return;
    const XLSX = await import('xlsx');

    // 원본 파일의 열 순서·열 구성을 그대로 유지하고, 변환값(상품명·수량)만 덮어쓴다.
    // 원본 헤더를 못 잡은 경우에만 변환 결과의 키를 사용 (_로 시작하는 내부 필드는 제외).
    const headers = headerOrder.length
      ? [...headerOrder]
      : Object.keys(resultData[0]).filter((k) => !k.startsWith('_'));
    if (!headers.includes('합구매여부')) headers.push('합구매여부');

    const exportRows = resultData.map((r) => {
      const obj: Record<string, string | number> = {};
      headers.forEach((h) => {
        if (h === '합구매여부') {
          obj[h] = r['_is_bundle'] ? '합구매' : '';
        } else {
          const v = r[h];
          obj[h] = v === undefined || v === null ? '' : (v as string | number);
        }
      });
      return obj;
    });

    const ws = XLSX.utils.json_to_sheet(exportRows, { header: headers });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '변환결과');
    const today = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(wb, `주문변환_${today}.xlsx`);
  }

  interface SavedOrder { id: string; product_name?: string; collect_product?: string; quantity?: number; company?: string }

  async function handleSaveToDB() {
    if (!resultData.length) return;
    if (!company) { alert('먼저 사업자를 선택하세요. (어느 사업자 재고에서 차감할지 구분이 필요합니다)'); return; }
    const companyLabel = COMPANY_OPTIONS.find((c) => c.value === company)?.label || company;
    if (!confirm(`이 주문 파일을 [${companyLabel}] 주문으로 저장하고, 해당 사업자 재고에서 자동 출고합니다.\n사업자가 맞습니까?`)) return;

    setSaving(true);
    setShipWarn(null);
    setStatus({ type: 'info', msg: '⏳ DB 저장 중...' });

    try {
      const rows = buildSupabaseRows(resultData, company);
      const orderNums = rows.map((r) => r.order_number).filter(Boolean);

      // 중복 체크 — 주문번호를 200개씩 나눠 조회 (긴 URL·1000건 제한 회피, 누락 방지)
      const existingSet = new Set<string>();
      for (let i = 0; i < orderNums.length; i += 200) {
        const batch = orderNums.slice(i, i + 200);
        const checkRes = await supabaseFetch(
          `/orders?select=order_number&order_number=in.(${batch.map((n) => `"${n}"`).join(',')})`,
        );
        if (!checkRes.ok) throw new Error('중복 확인 실패 (' + checkRes.status + ')');
        const existing: { order_number: string }[] = await checkRes.json();
        existing.forEach((r) => existingSet.add(r.order_number));
      }
      const newRows = rows.filter((r) => !existingSet.has(r.order_number));

      if (!newRows.length) {
        setStatus({ type: 'info', msg: '⚠️ 모든 주문이 이미 저장되어 있습니다' });
        return;
      }

      // 저장 (저장된 행을 돌려받아 재고 자동출고에 사용)
      const res = await supabaseFetch('/orders', {
        method: 'POST',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify(newRows),
      });
      if (!res.ok) throw new Error('저장 실패');
      const saved: SavedOrder[] = await res.json();

      // 업로드 이력 + 원본 파일 첨부
      let fileUrl = '';
      try {
        if (uploadedFile) fileUrl = await supabaseUpload('orders', safeStorageKey(uploadedFile.name), uploadedFile);
      } catch { /* 파일 업로드 실패해도 저장은 진행 */ }
      const upRes = await supabaseFetch('/order_uploads', {
        method: 'POST', headers: { Prefer: 'return=representation' },
        body: JSON.stringify({
          uploader: me?.name || '', file_name: fileName || uploadedFile?.name || '',
          file_url: fileUrl || null, row_count: rows.length, saved_count: newRows.length,
        }),
      });
      // 이 업로드로 저장된 주문에 upload_id 연결 → 업로드 이력 삭제 시 주문·재고·매출 원복 가능
      try {
        const up = await upRes.json();
        const uploadId = Array.isArray(up) ? up[0]?.id : up?.id;
        const savedIds = saved.map((o) => o.id).filter(Boolean);
        if (uploadId && savedIds.length) {
          await supabaseFetch(`/orders?id=in.(${savedIds.join(',')})`, {
            method: 'PATCH', headers: { Prefer: 'return=minimal' },
            body: JSON.stringify({ upload_id: uploadId }),
          });
        }
      } catch { /* upload_id 컬럼 미적용 시 무시(연결만 생략) */ }

      // ── 재고 자동출고 ────────────────────────────────────────
      // 상품명(대표명) + 사업자로 재고 매칭 → 못 찾으면 경고(자동출고 안 함, 안전장치)
      let warn: ShipWarn = { unmatched: [], negative: [], shipped: 0 };
      let unknownProducts: { name: string; cnt: number; qty: number }[] = [];
      let shipErrMsg = '';
      try {
        const inv = await supabaseFetchAll<{ id: string; product_name: string; company: string; quantity: number }>(
          '/inventory?select=id,product_name,company,quantity',
        );
        // 대표명↔재고: 정확 일치 → 실패 시 띄어쓰기·쉼표 무시 폴백
        const nk = (s: string) => s.replace(/\s+/g, '').replace(/,/g, '');
        const invMap = new Map<string, string>();     // `${상품명}|${사업자}` → id
        const invMapNorm = new Map<string, string>(); // 정규화 키 → id
        for (const it of inv) {
          if (!it.product_name) continue;
          const co = it.company || '';
          const key = `${it.product_name}|${co}`; if (!invMap.has(key)) invMap.set(key, it.id);
          const nkey = `${nk(it.product_name)}|${co}`; if (!invMapNorm.has(nkey)) invMapNorm.set(nkey, it.id);
        }
        const findInv = (name: string) => invMap.get(`${name}|${company}`) ?? invMapNorm.get(`${nk(name)}|${company}`);
        // 세트 구성표
        const bom = await supabaseFetchAll<{ set_name: string; component_name: string; component_qty: number }>('/product_bom?select=set_name,component_name,component_qty');
        const bomMap = new Map<string, { component_name: string; component_qty: number }[]>();
        for (const b of bom) { const a = bomMap.get(b.set_name) || []; a.push({ component_name: b.component_name, component_qty: Number(b.component_qty) || 1 }); bomMap.set(b.set_name, a); }

        const moves: Record<string, unknown>[] = [];
        const missMap = new Map<string, { cnt: number; qty: number }>();
        const unknownMap = new Map<string, { cnt: number; qty: number }>(); // 매칭데이터(PRODUCT_MAP)에 없는 = 인식 못한 상품명
        for (const o of saved) {
          const matched = matchProduct(o.collect_product || o.product_name || '');
          const rep = matched.name;
          const qty = Number(o.quantity) || 0;
          if (!matched.matched) {
            const raw = (o.collect_product || o.product_name || '(상품명 없음)').trim();
            const u = unknownMap.get(raw) || { cnt: 0, qty: 0 };
            u.cnt++; u.qty += qty; unknownMap.set(raw, u);
          }
          const set = bomMap.get(rep);
          if (set) {
            // 세트: 구성품 각각 (주문수량 × 구성수량) 차감
            const comps: Record<string, unknown>[] = [];
            let allFound = true;
            for (const b of set) {
              const cid = findInv(b.component_name);
              if (!cid) { allFound = false; break; }
              comps.push({ inventory_id: cid, product_name: b.component_name, quantity: qty * b.component_qty });
            }
            if (allFound) moves.push({ order_id: o.id, company, created_by: me?.name || '', components: comps });
            else { const m = missMap.get(rep) || { cnt: 0, qty: 0 }; m.cnt++; m.qty += qty; missMap.set(rep, m); }
            continue;
          }
          const invId = findInv(rep);
          if (invId) {
            moves.push({ order_id: o.id, inventory_id: invId, quantity: qty, product_name: rep, company, created_by: me?.name || '' });
          } else {
            const m = missMap.get(rep) || { cnt: 0, qty: 0 };
            m.cnt++; m.qty += qty; missMap.set(rep, m);
          }
        }
        unknownProducts = Array.from(unknownMap.entries()).map(([name, v]) => ({ name, ...v })).sort((a, b) => b.qty - a.qty);

        if (moves.length) {
          const shipRes = await supabaseFetch('/rpc/ship_orders', {
            method: 'POST', headers: { Prefer: 'return=representation' },
            body: JSON.stringify({ p_moves: moves }),
          });
          if (!shipRes.ok) { shipErrMsg = (shipRes.status + ' ' + (await shipRes.text())).slice(0, 400); throw new Error('ship'); }
          const shipResult = await shipRes.json();
          warn.shipped = shipResult?.shipped ?? 0;
          warn.negative = Array.isArray(shipResult?.negative) ? shipResult.negative : [];
        }
        warn.unmatched = Array.from(missMap.entries()).map(([name, v]) => ({ name, ...v })).sort((a, b) => b.qty - a.qty);
      } catch {
        // 자동출고 실패 — 주문 저장 자체는 성공. 데이터 유실 없음. 경고로 알림.
        warn = { unmatched: [], negative: [], shipped: -1 };
      }
      setShipWarn(warn);

      // ── 안전장치: 자동출고 문제 발생 시 DB 알림 기록 → 대시보드 경고로 노출 ──
      try {
        const alerts: Record<string, string | number>[] = [];
        if (unknownProducts.length) {
          const d = unknownProducts.slice(0, 30).map(u => `${u.name}(${u.qty}개)`).join(', ');
          alerts.push({ company, kind: 'unknown_product', detail: `매칭데이터에 없는(인식 못한) 상품 ${unknownProducts.length}종: ${d} — 상품 매칭/재고 등록 필요`, order_count: unknownProducts.reduce((s, u) => s + u.cnt, 0), created_by: me?.name || '' });
        }
        if (warn.shipped === -1) {
          alerts.push({ company, kind: 'rpc_fail', detail: `재고 자동출고 실패 — 주문 ${newRows.length}건 저장됨(재고 수동 조정 필요)${shipErrMsg ? ` [원인: ${shipErrMsg}]` : ''}`, order_count: newRows.length, created_by: me?.name || '' });
        }
        if (warn.unmatched.length) {
          const d = warn.unmatched.slice(0, 20).map(u => `${u.name}(${u.qty}개)`).join(', ');
          alerts.push({ company, kind: 'unmatched', detail: `재고 미매칭 ${warn.unmatched.length}종: ${d}`, order_count: warn.unmatched.reduce((s, u) => s + u.cnt, 0), created_by: me?.name || '' });
        }
        if (warn.negative.length) {
          const d = warn.negative.slice(0, 20).map(n => (typeof n === 'string' ? n : JSON.stringify(n))).join(', ');
          alerts.push({ company, kind: 'negative', detail: `재고 부족(마이너스) ${warn.negative.length}건: ${d}`, order_count: warn.negative.length, created_by: me?.name || '' });
        }
        // 수량표기 확인 필요(개입/매/병/팩/1+1 등 미인식 단위) — 송장 수량 오출고 방지 안전망
        const qtyRiskRows = resultData.filter((r) => qtyRiskReason(r as Record<string, unknown>));
        if (qtyRiskRows.length) {
          const seen = new Map<string, number>();
          for (const r of qtyRiskRows) {
            const nm = String((r as Record<string, unknown>)['상품명'] || '(상품명 없음)');
            seen.set(nm, (seen.get(nm) || 0) + 1);
          }
          const d = Array.from(seen.entries()).slice(0, 20).map(([n, c]) => `${n}(${c}건)`).join(', ');
          alerts.push({ company, kind: 'qty_check', detail: `수량표기 확인 필요 ${qtyRiskRows.length}건 — 개입/매/병/팩/1+1 등 미인식 단위. 송장 수량이 실제 포장수량과 맞는지 확인: ${d}`, order_count: qtyRiskRows.length, created_by: me?.name || '' });
        }
        if (alerts.length) {
          await supabaseFetch('/ship_alerts', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(alerts) });
        }
      } catch { /* 알림 기록 실패는 주문 저장 흐름에 영향 주지 않음 */ }

      const dupMsg = rows.length - newRows.length > 0 ? ` (중복 ${rows.length - newRows.length}건 제외)` : '';
      if (warn.shipped === -1) {
        setStatus({ type: 'error', msg: `⚠️ 주문 ${newRows.length}건은 저장됐으나 재고 자동출고에 실패했습니다 — 설정(db/order_inventory_sync.sql) 적용 여부 확인 필요. 재고는 수동 조정하세요.` });
      } else {
        setStatus({
          type: 'success',
          msg: `✅ [${companyLabel}] ${newRows.length}건 저장${dupMsg} · 재고 자동출고 ${warn.shipped}건` +
            (warn.unmatched.length ? ` · ⚠️ 미매칭 ${warn.unmatched.length}종(아래 확인)` : ''),
        });
      }
    } catch {
      setStatus({ type: 'error', msg: '❌ DB 저장 중 오류가 발생했습니다' });
    } finally {
      setSaving(false);
    }
  }

  async function loadHistory() {
    setHistoryLoading(true);
    try {
      const res = await supabaseFetch('/order_uploads?order=uploaded_at.desc&limit=300');
      const data = await res.json();
      setHistory(Array.isArray(data) ? data : []);
    } catch {
      setHistory([]);
    } finally {
      setHistoryLoading(false);
    }
  }

  // 업로드 이력의 직접등록 건 클릭 → 등록된 주문 상세 + 변경 이력(등록·수정) 조회
  async function openUploadDetail(h: UploadHistory) {
    if (!h.ref_order_number) return;
    setDetailUpload(h); setDetailLoading(true); setDetailOrders([]); setDetailLogs([]);
    try {
      const ords = await supabaseFetchAll<OrderRow>(
        `/orders?order_number=eq.${encodeURIComponent(h.ref_order_number)}` +
        '&select=id,upload_date,order_number,recipient_name,mall_name,product_name,quantity,amount,canceled,source,company,manual_cost,manual_shipping&order=id.asc',
      );
      setDetailOrders(Array.isArray(ords) ? ords : []);
      const ids = (ords || []).map(o => o.id);
      if (ids.length) {
        const logs = await supabaseFetchAll<ChangeLog>(
          `/order_change_logs?order_id=in.(${ids.join(',')})&select=id,action,detail,changed_by,created_at&order=created_at.desc`,
        );
        setDetailLogs(Array.isArray(logs) ? logs : []);
      }
    } catch { /* 조회 실패 시 빈 상세 */ }
    finally { setDetailLoading(false); }
  }

  async function deleteUpload(h: UploadHistory) {
    // 이 업로드로 저장된 주문 찾기 (파일업로드=upload_id / 직접등록=order_number)
    const idset = new Set<string>();
    if (h.ref_order_number) {
      try {
        const r = await supabaseFetchAll<{ id: string }>(`/orders?select=id&order_number=eq.${encodeURIComponent(h.ref_order_number)}`);
        (r || []).forEach((o) => idset.add(o.id));
      } catch { /* 무시 */ }
    }
    try {
      const r = await supabaseFetchAll<{ id: string }>(`/orders?select=id&upload_id=eq.${h.id}`);
      (r || []).forEach((o) => idset.add(o.id));
    } catch { /* upload_id 컬럼 미적용/미연결 시 무시 */ }
    const linkedIds = Array.from(idset);

    if (linkedIds.length) {
      if (!confirm(`이 업로드로 저장된 주문 ${linkedIds.length}건을 함께 삭제하고 원상복구할까요?\n· 차감했던 재고 자동 복구\n· 매출·공헌이익에서 제외\n(삭제된 주문은 복구 불가)`)) return;
      if (!(await deleteOrdersWithRestore(linkedIds, '업로드 일괄삭제'))) return; // 실패 시 이력도 보존
    } else {
      if (!confirm('이 업로드 이력을 삭제하시겠습니까?\n(연결된 주문을 찾지 못해 이력만 삭제됩니다 — 주문 데이터는 유지)')) return;
    }
    await supabaseFetch(`/order_uploads?id=eq.${h.id}`, { method: 'DELETE' });
    await loadHistory();
    await refreshUndeductedCount();
  }

  // 주문 변경 로그(등록·수정·취소·부분취소 등) 최근 300건 + 주문 정보 보강
  async function loadChangeLogs() {
    setLogLoading(true);
    try {
      const res = await supabaseFetch('/order_change_logs?select=id,order_id,action,detail,changed_by,created_at&order=created_at.desc&limit=300');
      const logs: ChangeLogRow[] = await res.json();
      const ids = [...new Set((Array.isArray(logs) ? logs : []).map(l => l.order_id).filter(Boolean))];
      const orderMap: Record<string, ChangeLogRow['_order']> = {};
      if (ids.length) {
        const orders = await supabaseFetchAll<{ id: string; product_name?: string; order_number?: string; company?: string; mall_name?: string }>(`/orders?id=in.(${ids.join(',')})&select=id,product_name,order_number,company,mall_name`);
        for (const o of orders) orderMap[String(o.id)] = o;
      }
      setChangeLogs((Array.isArray(logs) ? logs : []).map(l => ({ ...l, _order: orderMap[String(l.order_id)] })));
    } catch { setChangeLogs([]); }
    finally { setLogLoading(false); }
  }

  function handleTabChange(t: Tab) {
    setTab(t);
    if (t === 'history') loadHistory();
    if (t === 'log') loadChangeLogs();
    if (t === 'register' && !invLoaded) loadInventory();
    if (t === 'manage') {
      // 조회·취소 탭 열면 오늘 주문 자동 조회 (해당일 전부)
      const d = new Date();
      const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      setSFrom(iso); setSTo(iso); setSOrderNo(''); setSProduct(''); setSMall(''); setSCompany('전체');
      searchOrders({ from: iso, to: iso });
      refreshUndeductedCount();
    }
  }

  function logBadge(action: string): string {
    if (action === '등록') return 'bg-green-50 text-green-600';
    if (action === '수정') return 'bg-amber-50 text-amber-600';
    if (action === '삭제') return 'bg-red-50 text-red-600';
    if (action.includes('취소해제')) return 'bg-slate-100 text-slate-600';
    if (action.includes('취소') || action.includes('반품')) return 'bg-orange-50 text-orange-600';
    return 'bg-gray-100 text-gray-600';
  }

  const statusColors = {
    info: 'bg-blue-50 border-blue-200 text-blue-700',
    success: 'bg-green-50 border-green-200 text-green-700',
    error: 'bg-red-50 border-red-200 text-red-700',
  };

  return (
    <div className="space-y-4">
      {/* 탭 */}
      <div className="flex gap-2">
        <button
          onClick={() => handleTabChange('convert')}
          className={`px-5 py-2.5 rounded-xl font-medium text-base transition-all ${
            tab === 'convert'
              ? 'bg-blue-600 text-white shadow-md shadow-blue-500/20'
              : 'bg-white text-gray-600 hover:bg-gray-50 border border-gray-200'
          }`}
        >
          📤 파일 변환
        </button>
        <button
          onClick={() => handleTabChange('history')}
          className={`px-5 py-2.5 rounded-xl font-medium text-base transition-all ${
            tab === 'history'
              ? 'bg-blue-600 text-white shadow-md shadow-blue-500/20'
              : 'bg-white text-gray-600 hover:bg-gray-50 border border-gray-200'
          }`}
        >
          📋 업로드 이력
        </button>
        <button
          onClick={() => handleTabChange('manage')}
          className={`px-5 py-2.5 rounded-xl font-medium text-base transition-all ${
            tab === 'manage'
              ? 'bg-blue-600 text-white shadow-md shadow-blue-500/20'
              : 'bg-white text-gray-600 hover:bg-gray-50 border border-gray-200'
          }`}
        >
          🔍 주문 조회·취소
        </button>
        <button
          onClick={() => handleTabChange('register')}
          className={`px-5 py-2.5 rounded-xl font-medium text-base transition-all ${
            tab === 'register'
              ? 'bg-blue-600 text-white shadow-md shadow-blue-500/20'
              : 'bg-white text-gray-600 hover:bg-gray-50 border border-gray-200'
          }`}
        >
          ✍️ 직접 주문 등록
        </button>
        {canViewHistory && (
          <button
            onClick={() => handleTabChange('log')}
            className={`px-5 py-2.5 rounded-xl font-medium text-base transition-all ${
              tab === 'log'
                ? 'bg-blue-600 text-white shadow-md shadow-blue-500/20'
                : 'bg-white text-gray-600 hover:bg-gray-50 border border-gray-200'
            }`}
          >
            🔒 변경 로그
          </button>
        )}
      </div>

      {/* 변경 로그 탭 — 대표·실장 전용 */}
      {tab === 'log' && canViewHistory && (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
          <div className="flex items-center justify-between mb-1">
            <h2 className="text-lg font-bold text-gray-800">🔒 주문 변경 로그 <span className="text-sm font-normal text-gray-400">(대표·실장 전용)</span></h2>
            <button onClick={loadChangeLogs} className="text-sm text-blue-600 hover:underline">새로고침</button>
          </div>
          <p className="text-sm text-gray-400 mb-4">주문 등록·수정·취소·부분취소/반품 등 모든 변경 내역(최근 300건). 누가 언제 무엇을 바꿨는지 기록됩니다.</p>
          {logLoading ? (
            <div className="text-center py-12 text-gray-400">불러오는 중...</div>
          ) : changeLogs.length === 0 ? (
            <div className="text-center py-12 text-gray-400">변경 내역이 없습니다</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-gray-400 border-b border-gray-100">
                    <th className="py-2 px-2 text-left font-medium whitespace-nowrap">일시</th>
                    <th className="py-2 px-2 text-left font-medium">구분</th>
                    <th className="py-2 px-2 text-left font-medium">주문 (상품·몰·주문번호)</th>
                    <th className="py-2 px-2 text-left font-medium">내용</th>
                    <th className="py-2 px-2 text-left font-medium">처리자</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {changeLogs.map(l => (
                    <tr key={l.id} className="hover:bg-gray-50/60 align-top">
                      <td className="py-2 px-2 text-gray-500 whitespace-nowrap">{l.created_at?.slice(0, 16).replace('T', ' ')}</td>
                      <td className="py-2 px-2 whitespace-nowrap"><span className={`px-1.5 py-0.5 rounded text-xs font-medium ${logBadge(l.action)}`}>{l.action}</span></td>
                      <td className="py-2 px-2 text-gray-600">
                        {l._order
                          ? <span>{l._order.mall_name ? l._order.mall_name + ' · ' : ''}{l._order.product_name || '-'}{l._order.order_number ? ` (${l._order.order_number})` : ''}{l._order.company ? ` · ${l._order.company}` : ''}</span>
                          : <span className="text-gray-300">주문 #{l.order_id}</span>}
                      </td>
                      <td className="py-2 px-2 text-gray-600 break-words max-w-[320px]">{l.detail || '-'}</td>
                      <td className="py-2 px-2 text-gray-500 whitespace-nowrap">{l.changed_by || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* 파일 변환 탭 */}
      {tab === 'convert' && (
        <div className="space-y-4">
          {/* 미차감 재고 알림 + 재출고 (변환 탭에서 바로 처리) */}
          {canRegister && !!undeductedCount && (
            <div className="bg-red-50 border border-red-200 rounded-2xl px-5 py-4">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <button onClick={() => setShowUndeducted(v => !v)} className="text-base text-red-700 text-left hover:underline">
                  🚨 재고 미차감 주문 <b>{undeductedCount}건</b> — 재고에 아직 반영 안 됨 (매출은 정상 집계) <span className="text-sm text-red-400">· {showUndeducted ? '접기 ▲' : '어떤 건지 보기 ▼'}</span>
                </button>
                <button onClick={reshipUndeducted}
                  className="px-4 py-2 bg-red-600 hover:bg-red-500 text-white rounded-lg text-sm font-bold whitespace-nowrap">🔄 미차감분 재고 재출고</button>
              </div>
              {showUndeducted && (
                <div className="mt-3 border-t border-red-200 pt-3 space-y-1.5">
                  {undeductedList.map(u => (
                    <div key={u.id} className="flex items-center justify-between gap-2 text-sm">
                      <span className="text-gray-700">{u.product} <span className="text-gray-400">· {u.company || '사업자미상'} · {u.qty}개</span></span>
                      {u.matched
                        ? <span className="text-amber-600 whitespace-nowrap">매칭됨 · 재고 등록/재출고 필요</span>
                        : <span className="text-red-500 whitespace-nowrap">⚠️ 상품 매칭 필요</span>}
                    </div>
                  ))}
                  <p className="text-xs text-gray-400 pt-1">매칭·재고 등록 후 위 <b>재출고</b> 버튼을 누르면 재고가 차감됩니다.</p>
                </div>
              )}
            </div>
          )}
          <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
            <h2 className="text-lg font-bold text-gray-800 mb-1">사방넷 주문 파일 변환</h2>
            <p className="text-base text-gray-400 mb-5">사방넷에서 다운받은 엑셀 파일을 올리면 자동으로 가공 완료 파일을 만들어드립니다</p>

            {/* 업로드 존 */}
            <div
              className="border-2 border-dashed border-gray-200 rounded-xl p-12 text-center cursor-pointer hover:border-blue-400 hover:bg-blue-50/50 transition-all"
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const f = e.dataTransfer.files[0];
                if (f) handleFile(f);
              }}
            >
              <div className="text-4xl mb-3">📂</div>
              <p className="text-gray-500 font-medium">
                {fileName || '클릭하거나 파일을 여기에 끌어다 놓으세요'}
              </p>
              <p className="text-gray-400 text-base mt-1">.xlsx 파일만 지원됩니다</p>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx"
              className="hidden"
              onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
            />

            {/* 상태 메시지 */}
            {status && (
              <div className={`mt-4 px-4 py-3 rounded-xl border text-base ${statusColors[status.type]}`}>
                {status.msg}
              </div>
            )}

            {/* 사업자 선택 (저장·자동출고 전 필수) */}
            {resultData.length > 0 && (
              <div className="mt-4 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
                <div className="text-base font-semibold text-amber-800 mb-1">📌 이 주문 파일의 사업자를 선택하세요 (필수)</div>
                <div className="text-sm text-amber-600 mb-2">선택한 사업자 재고에서 자동으로 출고 차감됩니다. 사방넷은 사업자별로 따로 받으므로 한 파일 = 한 사업자입니다.</div>
                <div className="flex flex-wrap gap-2">
                  {COMPANY_OPTIONS.map((c) => (
                    <button key={c.value} onClick={() => setCompany(c.value)}
                      className={`px-4 py-2 rounded-lg text-base font-medium border transition-colors ${
                        company === c.value ? 'bg-blue-600 text-white border-blue-600 shadow-sm' : 'bg-white text-gray-600 border-gray-200 hover:border-blue-300'
                      }`}>
                      {c.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* 결과 액션 버튼 */}
            {resultData.length > 0 && (
              <div className="flex gap-3 mt-4 flex-wrap">
                <button
                  onClick={handleDownload}
                  className="px-5 py-2.5 bg-green-600 hover:bg-green-700 text-white rounded-xl font-medium text-base transition-colors shadow-sm"
                >
                  ⬇️ 엑셀 다운로드
                </button>
                <button
                  onClick={handleSaveToDB}
                  disabled={saving || !company}
                  className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-medium text-base transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
                  title={!company ? '먼저 사업자를 선택하세요' : ''}
                >
                  {saving ? '⏳ 저장 중...' : '💾 DB에 저장 + 재고 차감'}
                </button>
                <button
                  onClick={() => { setResultData([]); setHeaderOrder([]); setFileName(''); setUploadedFile(null); setStatus(null); setCompany(''); setShipWarn(null); }}
                  className="px-5 py-2.5 bg-white hover:bg-gray-50 text-gray-600 rounded-xl font-medium text-base border border-gray-200 transition-colors"
                >
                  🔄 초기화
                </button>
              </div>
            )}

            {/* 재고 자동출고 경고 (미매칭 / 마이너스) — 안전장치 */}
            {shipWarn && (shipWarn.unmatched.length > 0 || shipWarn.negative.length > 0) && (
              <div className="mt-4 bg-red-50 border border-red-200 rounded-xl px-5 py-4 space-y-3">
                {shipWarn.unmatched.length > 0 && (
                  <div>
                    <div className="text-base font-semibold text-red-600">⚠️ 재고 자동출고 안 된 상품 {shipWarn.unmatched.length}종 — 담당자 확인 필요</div>
                    <div className="text-sm text-red-400 mt-0.5 mb-2">
                      선택한 사업자 재고에서 이 상품들을 못 찾았습니다(미등록/이름 불일치). 주문·매출은 저장됐지만 <b>재고는 차감 안 됨</b> →
                      <a href="/inventory" className="underline ml-1">재고 관리</a>에서 등록·이름 확인 후 수동 출고하세요.
                      신상품 매칭이 없으면 <a href="/product-matches" className="underline text-blue-600 ml-1">🔗 상품 매칭</a>에서 추가하세요. 해결 후 실장님께 보고.
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {shipWarn.unmatched.map((m) => (
                        <span key={m.name} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white border border-red-200 text-sm text-gray-700">
                          {m.name} <span className="text-red-400">· {m.cnt}건 / {m.qty}개</span>
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                {shipWarn.negative.length > 0 && (
                  <div>
                    <div className="text-base font-semibold text-orange-600">⚠️ 출고 후 재고가 마이너스인 상품 {shipWarn.negative.length}종</div>
                    <div className="text-sm text-orange-400 mt-0.5 mb-2">재고보다 많이 팔렸습니다(재고 입력 누락 가능). 재고 관리에서 실사·보정하세요.</div>
                    <div className="flex flex-wrap gap-2">
                      {shipWarn.negative.map((m, i) => (
                        <span key={i} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white border border-orange-200 text-sm text-gray-700">
                          {m.product_name} <span className="text-orange-500">· 재고 {m.after}</span>
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* 결과 미리보기 */}
          {resultData.length > 0 && (
            <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
              <h3 className="font-semibold text-gray-700 mb-4">변환 결과 미리보기</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-base">
                  <thead>
                    <tr className="border-b border-gray-100">
                      <th className="text-left py-2 px-3 text-sm font-semibold text-gray-400 whitespace-nowrap">몰명</th>
                      <th className="text-left py-2 px-3 text-sm font-semibold text-gray-400 whitespace-nowrap">상품명</th>
                      <th className="text-center py-2 px-3 text-sm font-semibold text-gray-400">수량</th>
                      <th className="text-right py-2 px-3 text-sm font-semibold text-gray-400">금액</th>
                      <th className="text-center py-2 px-3 text-sm font-semibold text-gray-400">구분</th>
                    </tr>
                  </thead>
                  <tbody>
                    {resultData.slice(0, 50).map((row, i) => {
                      const risk = qtyRiskReason(row as Record<string, unknown>);
                      return (
                      <tr key={i} className={`border-b border-gray-50 ${risk ? 'bg-yellow-50 hover:bg-yellow-100' : 'hover:bg-gray-50'}`}>
                        <td className="py-2 px-3 whitespace-nowrap">
                          <span className="bg-blue-100 text-blue-700 text-sm px-2 py-0.5 rounded-md">
                            {String(row['몰명'] || '-')}
                          </span>
                        </td>
                        <td className="py-2 px-3 text-gray-700">
                          {row['상품명']}
                          {risk && (
                            <span className="block text-xs text-yellow-700 mt-0.5" title={risk}>⚠️ {risk}</span>
                          )}
                        </td>
                        <td className={`py-2 px-3 text-center ${risk ? 'text-yellow-800 font-bold' : 'text-gray-600'}`}>
                          {risk && <span className="mr-1">⚠️</span>}{row['수량(주문수량*EA)']}
                        </td>
                        <td className="py-2 px-3 text-right text-gray-700 font-medium">
                          ₩{(Number(row['금액']) || 0).toLocaleString()}
                        </td>
                        <td className="py-2 px-3 text-center">
                          {row['_is_bundle'] ? (
                            <span className="bg-cyan-100 text-cyan-700 text-sm px-2 py-0.5 rounded-md font-semibold">합구매</span>
                          ) : (
                            <span className="bg-green-100 text-green-700 text-sm px-2 py-0.5 rounded-md">일반</span>
                          )}
                        </td>
                      </tr>
                      );
                    })}
                  </tbody>
                </table>
                {resultData.length > 50 && (
                  <p className="text-sm text-gray-400 text-center mt-3">
                    상위 50건만 표시 중 (전체 {resultData.length}건)
                  </p>
                )}
              </div>
            </div>
          )}

          {/* 사용 방법 */}
          <div className="bg-blue-50 rounded-2xl p-5 border border-blue-100">
            <h3 className="font-semibold text-blue-700 text-base mb-2">📌 사용 방법</h3>
            <ol className="text-base text-blue-600 space-y-1 list-decimal list-inside">
              <li>사방넷 → 주문관리 → 엑셀 다운로드 (사업자별로 따로)</li>
              <li>위 영역에 파일 업로드 → 자동 변환</li>
              <li><b>사업자 선택</b> (어느 사업자 재고에서 차감할지)</li>
              <li>&quot;DB에 저장 + 재고 차감&quot; 클릭 → 매출 집계 + 재고 자동 출고</li>
              <li>미매칭 경고가 뜨면 담당자가 재고 확인 후 보고</li>
            </ol>
          </div>
        </div>
      )}

      {/* 업로드 이력 탭 */}
      {tab === 'history' && (
        <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold text-gray-800">업로드 이력</h2>
            <button
              onClick={loadHistory}
              className="text-base text-blue-600 hover:text-blue-700 font-medium"
            >
              🔄 새로고침
            </button>
          </div>

          {historyLoading ? (
            <div className="text-center py-12 text-gray-400">불러오는 중...</div>
          ) : history.length === 0 ? (
            <div className="text-center py-12 text-gray-400">아직 업로드 이력이 없습니다</div>
          ) : (
            <>
              {/* 데스크탑: 표 */}
              <div className="overflow-x-auto rounded-xl border border-gray-100 hidden sm:block">
                <table className="w-full text-base">
                  <thead>
                    <tr className="bg-gray-50">
                      <th className="text-left py-2.5 px-3 text-sm font-semibold text-gray-400">업로드 일시</th>
                      <th className="text-left py-2.5 px-3 text-sm font-semibold text-gray-400">담당자</th>
                      <th className="text-left py-2.5 px-3 text-sm font-semibold text-gray-400">파일</th>
                      <th className="text-center py-2.5 px-3 text-sm font-semibold text-gray-400">변환/저장</th>
                      {canDelete && <th className="py-2.5 px-3" />}
                    </tr>
                  </thead>
                  <tbody>
                    {history.map((h) => (
                      <tr key={h.id} className="border-t border-gray-50 hover:bg-gray-50">
                        <td className="py-2.5 px-3 text-gray-600 whitespace-nowrap">{new Date(h.uploaded_at).toLocaleString('ko-KR', { year: '2-digit', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</td>
                        <td className="py-2.5 px-3 text-gray-700 font-medium">{h.uploader || '-'}</td>
                        <td className="py-2.5 px-3">
                          {h.file_url ? (
                            <a href={h.file_url} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">📎 {h.file_name || '파일'}</a>
                          ) : h.ref_order_number ? (
                            <button onClick={() => openUploadDetail(h)} className="text-blue-600 hover:underline text-left">📋 {h.file_name || '직접등록'} <span className="text-xs text-gray-400">· 상세보기</span></button>
                          ) : <span className="text-gray-400">{h.file_name || '-'}</span>}
                        </td>
                        <td className="py-2.5 px-3 text-center text-gray-500 text-sm">{h.saved_count}건 저장 / {h.row_count}건</td>
                        {canDelete && (
                          <td className="py-2.5 px-3 text-right">
                            <button onClick={() => deleteUpload(h)} className="text-sm text-gray-400 hover:text-red-500">삭제</button>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* 모바일: 카드형 */}
              <div className="sm:hidden divide-y divide-gray-100">
                {history.map((h) => (
                  <div key={h.id} className="py-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-bold text-gray-800 text-[15px]">{h.uploader || '-'}</span>
                      <span className="text-xs text-gray-400">{new Date(h.uploaded_at).toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
                    </div>
                    <div className="mt-1">
                      {h.file_url ? (
                        <a href={h.file_url} target="_blank" rel="noopener noreferrer" className="text-sm text-blue-600 hover:underline">📎 {h.file_name || '파일'}</a>
                      ) : h.ref_order_number ? (
                        <button onClick={() => openUploadDetail(h)} className="text-sm text-blue-600 hover:underline text-left">📋 {h.file_name || '직접등록'} · 상세보기</button>
                      ) : <span className="text-sm text-gray-400">{h.file_name || '-'}</span>}
                    </div>
                    <div className="flex items-center justify-between mt-1">
                      <span className="text-xs text-gray-500">{h.saved_count}건 저장 / {h.row_count}건</span>
                      {canDelete && <button onClick={() => deleteUpload(h)} className="text-xs text-red-500">삭제</button>}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* 주문 조회·취소 탭 */}
      {tab === 'manage' && (
        <div className="space-y-4">
          <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
            <div className="flex items-start justify-between gap-2 flex-wrap mb-1">
              <h2 className="text-lg font-bold text-gray-800">주문 조회 · 취소</h2>
              {canRegister && (
                <button onClick={reshipUndeducted}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium text-white ${undeductedCount ? 'bg-red-600 hover:bg-red-500' : 'bg-emerald-600 hover:bg-emerald-500'}`}>
                  🔄 미차감분 재고 재출고{undeductedCount ? ` (${undeductedCount})` : ''}
                </button>
              )}
            </div>
            {canRegister && !!undeductedCount && (
              <div className="mb-3 bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-sm text-red-600">
                🚨 재고에 아직 반영 안 된 주문 <b>{undeductedCount}건</b>이 있습니다 (매출은 정상 집계). 위 <b>재출고</b> 버튼으로 처리하세요. 매칭이 안 되는 건은 매칭데이터/재고 등록이 필요합니다.
              </div>
            )}
            <p className="text-base text-gray-400 mb-4">고객 취소 등으로 주문을 취소/삭제합니다. 취소된 주문은 매출·공헌이익 집계에서 제외됩니다. · <b>자동출고 실패분</b>은 우측 &apos;재고 재출고&apos;로 일괄 차감.</p>
            {/* 사업자 필터 */}
            <div className="flex gap-2 flex-wrap items-center mb-3">
              <span className="text-sm text-gray-400">사업자</span>
              {['전체', ...COMPANY_OPTIONS.map(c => c.value)].map(c => (
                <button key={c} onClick={() => { setSCompany(c); searchOrders({ company: c }); }}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${sCompany === c ? 'bg-slate-700 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
                  {c}
                </button>
              ))}
            </div>
            <div className="flex gap-2 flex-wrap items-center">
              <div className="flex items-center gap-1">
                <input type="date" value={sFrom} max={sTo || undefined} onChange={e => setSFrom(e.target.value)}
                  className="px-2 py-2 border border-gray-200 rounded-lg text-base focus:outline-none focus:ring-2 focus:ring-blue-400" />
                <span className="text-gray-400">~</span>
                <input type="date" value={sTo} min={sFrom || undefined} onChange={e => setSTo(e.target.value)}
                  className="px-2 py-2 border border-gray-200 rounded-lg text-base focus:outline-none focus:ring-2 focus:ring-blue-400" />
              </div>
              <input value={sOrderNo} onChange={e => setSOrderNo(e.target.value)} onKeyDown={e => e.key === 'Enter' && searchOrders()}
                placeholder="주문번호" className="px-3 py-2 border border-gray-200 rounded-lg text-base focus:outline-none focus:ring-2 focus:ring-blue-400 w-36" />
              <input value={sProduct} onChange={e => setSProduct(e.target.value)} onKeyDown={e => e.key === 'Enter' && searchOrders()}
                placeholder="상품명" className="px-3 py-2 border border-gray-200 rounded-lg text-base focus:outline-none focus:ring-2 focus:ring-blue-400 flex-1 min-w-[120px]" />
              <input value={sMall} onChange={e => setSMall(e.target.value)} onKeyDown={e => e.key === 'Enter' && searchOrders()}
                placeholder="몰명" className="px-3 py-2 border border-gray-200 rounded-lg text-base focus:outline-none focus:ring-2 focus:ring-blue-400 w-28" />
              <button onClick={() => searchOrders()} className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-base font-medium">검색</button>
              <button onClick={() => { setSFrom(''); setSTo(''); setSOrderNo(''); setSProduct(''); setSMall(''); setSCompany('전체'); }}
                className="px-3 py-2 border border-gray-200 rounded-lg text-sm text-gray-500 hover:bg-gray-50">초기화</button>
            </div>
            <p className="text-xs text-gray-400 mt-2">📅 탭 열면 <b>오늘 주문 자동 조회</b> · 업로드일(주문 변환일) 기준 · 날짜·검색어를 걸면 <b>해당 범위 전부</b> 조회(건수 제한 없음). (조회 {orderList.length.toLocaleString()}건)</p>
            {orderList.length > 0 && (() => {
              const live = orderList.filter(o => !o.canceled);
              const qty = live.reduce((a, o) => a + (Number(o.quantity) || 0), 0);
              const amt = live.reduce((a, o) => a + (Number(o.amount) || 0), 0);
              const cancQty = orderList.filter(o => o.canceled).reduce((a, o) => a + (Number(o.quantity) || 0), 0);
              return (
                <p className="text-sm text-gray-600 mt-1 font-medium">
                  📦 유효 수량 합계 <b className="text-slate-800">{qty.toLocaleString()}개</b>
                  <span className="mx-1 text-gray-300">·</span>
                  매출 합계 <b className="text-slate-800">₩{amt.toLocaleString()}</b>
                  {cancQty > 0 && <span className="text-gray-400"> (취소 {cancQty.toLocaleString()}개 제외)</span>}
                </p>
              );
            })()}
          </div>

          {orderChecked.size > 0 && (
            <div className="flex items-center gap-2 bg-slate-700 text-white rounded-xl px-4 py-3 flex-wrap">
              <span className="text-base font-medium">{orderChecked.size}건 선택</span>
              <div className="flex gap-2 ml-auto flex-wrap">
                <button onClick={cancelSelectedOrders} className="px-3 py-1.5 bg-orange-500 hover:bg-orange-400 rounded-lg text-sm font-medium">취소 처리</button>
                {orderChecked.size === 1 && <button onClick={partialCancelOrder} className="px-3 py-1.5 bg-amber-600 hover:bg-amber-500 rounded-lg text-sm font-medium">부분취소/반품</button>}
                <button onClick={uncancelSelectedOrders} className="px-3 py-1.5 bg-slate-500 hover:bg-slate-400 rounded-lg text-sm font-medium">취소 해제</button>
                {canDelete && <button onClick={deleteSelectedOrders} className="px-3 py-1.5 bg-red-500 hover:bg-red-400 rounded-lg text-sm font-medium">완전 삭제</button>}
              </div>
            </div>
          )}

          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
            {orderLoading ? (
              <div className="text-center py-12 text-gray-400">불러오는 중...</div>
            ) : orderList.length === 0 ? (
              <div className="text-center py-12 text-gray-400">검색 결과가 없습니다 (조건 입력 후 검색)</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-base">
                  <thead className="bg-gray-50 border-b border-gray-100">
                    <tr>
                      <th className="px-3 py-3">
                        <input type="checkbox"
                          checked={orderList.length > 0 && orderChecked.size === orderList.length}
                          onChange={() => setOrderChecked(orderChecked.size === orderList.length ? new Set() : new Set(orderList.map(o => o.id)))}
                          className="w-4 h-4 rounded border-gray-300 text-blue-600 cursor-pointer" />
                      </th>
                      {['주문번호', '몰명', '상품명', '수량', '금액', '수취인', '상태', ''].map((h, i) => (
                        <th key={i} className="px-3 py-3 text-left text-sm font-medium text-gray-500 whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {orderList.map(o => (
                      <tr key={o.id} className={`hover:bg-blue-50/40 ${o.canceled ? 'bg-red-50/40' : ''}`}>
                        <td className="px-3 py-2.5">
                          <input type="checkbox" checked={orderChecked.has(o.id)}
                            onChange={() => setOrderChecked(prev => { const n = new Set(prev); n.has(o.id) ? n.delete(o.id) : n.add(o.id); return n; })}
                            className="w-4 h-4 rounded border-gray-300 text-blue-600 cursor-pointer" />
                        </td>
                        <td className="px-3 py-2.5 text-gray-600 text-sm whitespace-nowrap">{o.order_number}</td>
                        <td className="px-3 py-2.5"><span className="bg-blue-100 text-blue-700 text-xs px-2 py-0.5 rounded-md whitespace-nowrap">{o.mall_name}</span></td>
                        <td className={`px-3 py-2.5 text-sm ${o.canceled ? 'line-through text-red-400' : 'text-gray-700'}`}>{o.product_name}</td>
                        <td className="px-3 py-2.5 text-center text-gray-600">{o.quantity}</td>
                        <td className="px-3 py-2.5 text-right text-gray-700">₩{(o.amount || 0).toLocaleString()}</td>
                        <td className="px-3 py-2.5 text-gray-500 text-sm whitespace-nowrap">{o.recipient_name || '-'}</td>
                        <td className="px-3 py-2.5">
                          {o.canceled
                            ? <span className="text-xs px-2 py-0.5 rounded-md bg-red-100 text-red-600 font-medium">취소됨</span>
                            : <span className="text-xs px-2 py-0.5 rounded-md bg-green-100 text-green-700">정상</span>}
                        </td>
                        <td className="px-3 py-2.5 whitespace-nowrap">
                          {canRegister && o.source === '도매' && !o.canceled && (
                            <button onClick={() => openEditOrder(o)} className="text-sm text-blue-500 hover:text-blue-700 hover:underline">수정</button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          <p className="text-xs text-gray-400">💡 취소 처리 시 차감했던 재고가 자동으로 복구되고, 취소 해제 시 다시 차감됩니다(이력에 기록). 매출·공헌이익에서도 자동 제외/포함됩니다. 도매 주문은 <b>수정</b> 버튼으로 상품·수량·금액을 고칠 수 있고 재고·매출에 자동 반영됩니다.</p>
        </div>
      )}

      {/* 도매 주문 수정 모달 */}
      {editOrder && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-6 my-8">
            <h3 className="text-lg font-bold text-gray-800 mb-1">도매 주문 수정</h3>
            <p className="text-sm text-gray-500 mb-4">{editOrder.order_number} · {editOrder.mall_name} · {editOrder.company}</p>
            <div className="space-y-3">
              <div>
                <label className="block text-sm text-gray-500 mb-1">상품 (해당 사업자 재고)</label>
                <select value={editForm.invId} onChange={e => setEditForm(f => ({ ...f, invId: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-base">
                  <option value="">상품 선택</option>
                  {inv.filter(i => i.company === (editOrder.company || '')).map(i => (
                    <option key={i.id} value={i.id}>{i.product_name} (재고 {i.quantity ?? 0})</option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="block text-sm text-gray-500 mb-1">수량</label>
                  <input type="number" min={1} value={editForm.qty || ''} onChange={e => setEditForm(f => ({ ...f, qty: Number(e.target.value) || 0 }))}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-base text-right" /></div>
                <div><label className="block text-sm text-gray-500 mb-1">매출금액</label>
                  <input type="number" value={editForm.amount || ''} onChange={e => setEditForm(f => ({ ...f, amount: Number(e.target.value) || 0 }))}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-base text-right" /></div>
                <div><label className="block text-sm text-gray-500 mb-1">원가(개당)</label>
                  <input type="number" value={editForm.cost || ''} onChange={e => setEditForm(f => ({ ...f, cost: Number(e.target.value) || 0 }))}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-base text-right" /></div>
                <div><label className="block text-sm text-gray-500 mb-1">배송비</label>
                  <input type="number" value={editForm.shipping || ''} onChange={e => setEditForm(f => ({ ...f, shipping: Number(e.target.value) || 0 }))}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-base text-right" /></div>
              </div>
              <div className="text-sm text-gray-500 bg-gray-50 rounded-lg px-3 py-2">
                예상 공헌이익 = (매출 − 원가×수량 − 배송비) ÷ 1.1 = <b>{Math.round((editForm.amount - editForm.cost * editForm.qty - editForm.shipping) / 1.1).toLocaleString()}원</b>
              </div>
            </div>

            {/* 변경 이력 — 대표·실장만 */}
            {canViewHistory && (
            <div className="mt-4">
              <div className="text-sm font-medium text-gray-600 mb-1.5">🔒 변경 이력 <span className="text-xs text-gray-400 font-normal">(대표·실장 전용)</span></div>
              {editLogs.length === 0 ? (
                <div className="text-sm text-gray-400">이력 없음</div>
              ) : (
                <div className="max-h-40 overflow-y-auto space-y-1.5 border border-gray-100 rounded-lg p-2">
                  {editLogs.map(l => (
                    <div key={l.id} className="text-xs">
                      <span className={`px-1.5 py-0.5 rounded font-medium ${l.action === '수정' ? 'bg-amber-50 text-amber-600' : 'bg-green-50 text-green-600'}`}>{l.action}</span>
                      <span className="text-gray-400 ml-1">{l.changed_by} · {l.created_at?.slice(0, 16).replace('T', ' ')}</span>
                      {l.detail && <div className="text-gray-600 mt-0.5 break-words">{l.detail}</div>}
                    </div>
                  ))}
                </div>
              )}
            </div>
            )}

            <div className="flex gap-3 mt-5">
              <button onClick={saveEditOrder} disabled={editSaving}
                className="flex-1 px-5 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white rounded-xl text-base font-medium">{editSaving ? '저장 중...' : '저장 (재고·매출 자동 반영)'}</button>
              <button onClick={() => setEditOrder(null)}
                className="px-5 py-2.5 border border-gray-200 text-gray-600 rounded-xl text-base hover:bg-gray-50">닫기</button>
            </div>
            {canDelete && (
              <button onClick={async () => {
                if (!editOrder) return;
                if (!confirm(`이 주문을 완전히 삭제할까요?\n${editOrder.product_name} · ${Number(editOrder.amount || 0).toLocaleString()}원\n· 차감했던 재고는 자동 복구되고 매출에서도 제외됩니다 (복구 불가)`)) return;
                setEditSaving(true);
                try {
                  if (await deleteOrdersWithRestore([editOrder.id])) {
                    setEditOrder(null);
                    await searchOrders();
                    await refreshUndeductedCount();
                  }
                } finally { setEditSaving(false); }
              }}
                className="w-full mt-2 px-5 py-2.5 border border-red-200 text-red-600 rounded-xl text-base font-medium hover:bg-red-50">
                🗑️ 이 주문 삭제 (재고 복구 + 매출 제외)
              </button>
            )}
          </div>
        </div>
      )}

      {/* 업로드 이력 상세 모달 (직접등록 건 클릭) */}
      {detailUpload && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4 overflow-y-auto" onClick={() => setDetailUpload(null)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-6 my-8" onClick={e => e.stopPropagation()}>
            <div className="flex items-start justify-between mb-1">
              <h3 className="text-lg font-bold text-gray-800">직접등록 상세</h3>
              <button onClick={() => setDetailUpload(null)} className="text-gray-400 text-lg">✕</button>
            </div>
            <p className="text-sm text-gray-500 mb-4">
              {detailUpload.file_name} · 주문번호 {detailUpload.ref_order_number}
              <span className="text-gray-400"> · 등록 {new Date(detailUpload.uploaded_at).toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })} · {detailUpload.uploader}</span>
            </p>

            {detailLoading ? (
              <div className="text-center py-8 text-gray-400">불러오는 중...</div>
            ) : detailOrders.length === 0 ? (
              <div className="text-center py-8 text-gray-400">이 주문은 삭제되었거나 조회할 수 없습니다.</div>
            ) : (
              <>
                {/* 등록된 품목(현재 상태) */}
                <div className="text-sm font-medium text-gray-600 mb-1.5">등록 품목 <span className="text-gray-400">(현재 상태)</span></div>
                <div className="border border-gray-100 rounded-lg divide-y divide-gray-50 mb-4">
                  {detailOrders.map(o => {
                    const isW = o.source === '도매';
                    return (
                      <div key={o.id} className="px-3 py-2 text-sm">
                        <div className="flex items-center justify-between gap-2">
                          <span className={`font-medium ${o.canceled ? 'line-through text-gray-400' : 'text-gray-800'}`}>{o.product_name}</span>
                          <span className="text-gray-500 whitespace-nowrap">{o.quantity}개 · {(o.amount || 0).toLocaleString()}원</span>
                        </div>
                        <div className="text-xs text-gray-400 mt-0.5">
                          {o.mall_name}{o.recipient_name ? ` · ${o.recipient_name}` : ''}
                          {isW ? ` · 원가(개당) ${(o.manual_cost || 0).toLocaleString()} · 배송비 ${(o.manual_shipping || 0).toLocaleString()}` : ''}
                          {o.canceled ? ' · ⚠️ 취소됨' : ''}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* 변경 이력 (등록·수정) — 대표·실장만 */}
                {canViewHistory && (<>
                <div className="text-sm font-medium text-gray-600 mb-1.5">🔒 변경 이력 (등록·수정) <span className="text-xs text-gray-400 font-normal">(대표·실장 전용)</span></div>
                {detailLogs.length === 0 ? (
                  <div className="text-sm text-gray-400">이력 없음</div>
                ) : (
                  <div className="max-h-52 overflow-y-auto space-y-1.5 border border-gray-100 rounded-lg p-2">
                    {detailLogs.map(l => (
                      <div key={l.id} className="text-xs">
                        <span className={`px-1.5 py-0.5 rounded font-medium ${l.action === '수정' ? 'bg-amber-50 text-amber-600' : l.action === '삭제' ? 'bg-red-50 text-red-600' : 'bg-green-50 text-green-600'}`}>{l.action}</span>
                        <span className="text-gray-400 ml-1">{l.changed_by} · {l.created_at?.slice(0, 16).replace('T', ' ')}</span>
                        {l.detail && <div className="text-gray-600 mt-0.5 break-words">{l.detail}</div>}
                      </div>
                    ))}
                  </div>
                )}
                </>)}
              </>
            )}

            <div className="flex justify-end mt-5">
              <button onClick={() => setDetailUpload(null)}
                className="px-5 py-2.5 border border-gray-200 text-gray-600 rounded-xl text-base hover:bg-gray-50">닫기</button>
            </div>
          </div>
        </div>
      )}

      {/* 직접 주문 등록 탭 */}
      {tab === 'register' && (
        <div className="space-y-4">
          <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100 space-y-4">
            <div>
              <h2 className="text-lg font-bold text-gray-800 mb-1">직접 주문 등록</h2>
              <p className="text-base text-gray-400">사방넷 없이 발생한 주문(도매·직거래·기타)을 직접 등록합니다. 저장 시 매출 집계 + 재고 자동 차감.</p>
            </div>

            {!canRegister && <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-base text-amber-700">⚠️ 등록 권한이 없습니다. (대표·실장·재고/주문담당만 등록 가능)</div>}

            {/* 유형 */}
            <div className="flex gap-2">
              {([{ v: 'normal', l: '일반(몰) 주문' }, { v: 'wholesale', l: '도매·직거래' }] as const).map((t) => (
                <button key={t.v} onClick={() => { setMType(t.v); setMMall(''); }}
                  className={`px-4 py-2 rounded-lg text-base font-medium border ${mType === t.v ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-200'}`}>{t.l}</button>
              ))}
            </div>

            {/* 기본 정보 */}
            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-sm text-gray-500 mb-1">사업자 *</label>
                <select value={mCompany} onChange={(e) => setMCompany(e.target.value)} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-base">
                  <option value="">선택</option>
                  {COMPANY_OPTIONS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm text-gray-500 mb-1">날짜 *</label>
                <input type="date" value={mDate} onChange={(e) => setMDate(e.target.value)} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-base" />
              </div>
              <div>
                <label className="block text-sm text-gray-500 mb-1">{mType === 'wholesale' ? '채널' : '판매몰'} *</label>
                {mType === 'wholesale' ? (
                  <select value={mMall} onChange={(e) => setMMall(e.target.value)} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-base">
                    <option value="">선택</option><option value="도매">도매</option><option value="직거래">직거래</option>
                  </select>
                ) : (
                  <select value={mMall} onChange={(e) => setMMall(e.target.value)} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-base">
                    <option value="">선택</option>{MALL_OPTIONS.map((m) => <option key={m} value={m}>{m}</option>)}
                  </select>
                )}
              </div>
              <div>
                <label className="block text-sm text-gray-500 mb-1">거래처/수취인 (선택)</label>
                <input value={mPartner} onChange={(e) => setMPartner(e.target.value)} placeholder="예: ○○상사" className="w-full px-3 py-2 border border-gray-200 rounded-lg text-base" />
              </div>
              <div>
                <label className="block text-sm text-gray-500 mb-1">출고방식 *</label>
                <select value={mShipMethod} onChange={(e) => setMShipMethod(e.target.value as '택배' | '직접수령' | '화물')}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-base">
                  <option value="택배">택배</option>
                  <option value="직접수령">직접수령</option>
                  <option value="화물">화물(용차)</option>
                </select>
              </div>
              {mShipMethod === '택배' && (
                <div>
                  <label className="block text-sm text-gray-500 mb-1">택배 출고 건수</label>
                  <input type="number" min={1} value={mCourierCount || ''} onChange={(e) => setMCourierCount(Number(e.target.value) || 0)}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-base text-right" />
                  <p className="text-xs text-gray-400 mt-1">이 주문으로 나간 택배 상자 수 → 매출현황 택배건수에 자동 반영</p>
                </div>
              )}
            </div>

            {!mCompany && <div className="text-sm text-gray-400">※ 사업자를 먼저 선택하면 해당 사업자 재고에서 상품을 고를 수 있습니다.</div>}

            {/* 품목 */}
            <div className="space-y-2">
              <div className="text-base font-semibold text-gray-700">품목</div>
              {mLines.map((l) => (
                <div key={l.key} className="flex flex-wrap items-end gap-2 p-3 bg-gray-50 rounded-xl">
                  <div className="flex-1 min-w-[200px]">
                    <label className="block text-xs text-gray-400 mb-1">상품 (재고에서 선택)</label>
                    <select value={l.invId} onChange={(e) => pickProduct(l.key, e.target.value)} disabled={!mCompany}
                      className="w-full px-2 py-1.5 border border-gray-200 rounded-lg text-base bg-white disabled:bg-gray-100">
                      <option value="">{mCompany ? (invForCompany.length ? '상품 선택' : '재고 없음') : '사업자 먼저'}</option>
                      {invForCompany.map((i) => <option key={i.id} value={i.id}>{i.product_name} (재고 {i.quantity ?? 0})</option>)}
                    </select>
                  </div>
                  <div className="w-20"><label className="block text-xs text-gray-400 mb-1">수량</label>
                    <input type="number" value={l.qty || ''} onChange={(e) => setLine(l.key, { qty: Number(e.target.value) || 0 })} className="w-full px-2 py-1.5 border border-gray-200 rounded-lg text-base text-right" /></div>
                  <div className="w-28"><label className="block text-xs text-gray-400 mb-1">매출금액</label>
                    <input type="number" value={l.amount || ''} onChange={(e) => setLine(l.key, { amount: Number(e.target.value) || 0 })} className="w-full px-2 py-1.5 border border-gray-200 rounded-lg text-base text-right" /></div>
                  {mType === 'wholesale' && <>
                    <div className="w-24"><label className="block text-xs text-gray-400 mb-1">개당원가</label>
                      <input type="number" value={l.cost || ''} onChange={(e) => setLine(l.key, { cost: Number(e.target.value) || 0 })} className="w-full px-2 py-1.5 border border-gray-200 rounded-lg text-base text-right" /></div>
                    <div className="w-24"><label className="block text-xs text-gray-400 mb-1">배송비</label>
                      <input type="number" value={l.shipping || ''} onChange={(e) => setLine(l.key, { shipping: Number(e.target.value) || 0 })} className="w-full px-2 py-1.5 border border-gray-200 rounded-lg text-base text-right" /></div>
                  </>}
                  <button onClick={() => removeLine(l.key)} className="px-2 py-1.5 text-red-400 hover:text-red-600 text-sm">삭제</button>
                </div>
              ))}
              <button onClick={addLine} className="px-3 py-1.5 text-blue-600 text-sm font-medium hover:bg-blue-50 rounded-lg">+ 품목 추가</button>
            </div>

            {/* 도매 예상 공헌이익 미리보기 */}
            {mType === 'wholesale' && (
              <div className="bg-violet-50 border border-violet-200 rounded-xl px-4 py-3 text-base text-violet-700">
                예상 공헌이익(확정 저장): <b className="text-red-600 text-lg">{mWholesaleMargin.toLocaleString('ko-KR')}원</b>
                {mWholesaleRate !== null && <span className="ml-2">· 예상 공헌이익률 <b className="text-red-600">{mWholesaleRate}%</b></span>}
                <span className="block text-sm text-violet-500 mt-0.5">= (매출 − 원가(개당×수량) − 배송비) ÷ 1.1. 공헌이익률 = 공헌이익 ÷ 매출. 부가세 포함 금액으로 입력하세요. 이 값으로 확정됩니다.</span>
              </div>
            )}

            {mStatus && <div className={`px-4 py-3 rounded-xl border text-base ${statusColors[mStatus.type]}`}>{mStatus.msg}</div>}

            <button onClick={handleManualSave} disabled={saving || !canRegister}
              className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-medium text-base shadow-sm disabled:opacity-50 disabled:cursor-not-allowed">
              {saving ? '⏳ 등록 중...' : '💾 주문 등록 + 재고 차감'}
            </button>
          </div>

          {shipWarn && shipWarn.negative.length > 0 && (
            <div className="bg-red-50 border border-red-200 rounded-xl px-5 py-4">
              <div className="text-base font-semibold text-orange-600">⚠️ 출고 후 재고 마이너스 {shipWarn.negative.length}종</div>
              <div className="flex flex-wrap gap-2 mt-2">{shipWarn.negative.map((m, i) => (<span key={i} className="px-2.5 py-1 rounded-lg bg-white border border-orange-200 text-sm text-gray-700">{m.product_name} · 재고 {m.after}</span>))}</div>
            </div>
          )}
        </div>
      )}

    </div>
  );
}
