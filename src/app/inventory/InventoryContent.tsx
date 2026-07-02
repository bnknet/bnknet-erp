'use client';

import { useState, useEffect } from 'react';
import { supabaseFetch, supabaseFetchAll } from '@/lib/supabase';
import { getUser } from '@/lib/auth';
import { matchProduct, loadDbMatches } from '@/lib/orderConvert';
import * as XLSX from 'xlsx';

// 큰 금액 축약 (모바일 통계용): 6.9억 / 688만 등
function shortWon(n: number): string {
  if (n >= 100000000) return (n / 100000000).toFixed(1).replace(/\.0$/, '') + '억';
  if (n >= 10000) return Math.round(n / 10000).toLocaleString() + '만';
  return n.toLocaleString();
}

interface InventoryItem {
  id: string;
  product_id?: string;
  product_name: string;
  category?: string;
  brand?: string;
  company: string;
  quantity: number;
  unit: string;
  cost_price: number;
  location?: string;
  memo?: string;
  is_active?: boolean;
  updated_at: string;
}

interface InventorySnapshot {
  id: string;
  snapshot_date: string;
  product_name: string;
  category?: string;
  brand?: string;
  company: string;
  quantity: number;
  cost_price: number;
}

// 로컬 기준 오늘 YYYY-MM-DD
function todayDate() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// 로컬 기준 어제 YYYY-MM-DD
function yesterdayDate() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

interface InventoryLog {
  id: string;
  inventory_id: string;
  product_name: string;
  type: string;
  quantity: number;
  before_qty: number;
  after_qty: number;
  reason?: string;
  created_by?: string;
  created_at: string;
}

const COMPANIES = ['전체', '더블아이', 'BNKNET', 'SJ글로벌', 'IX글로벌'];
const CATEGORIES = ['전체', '뷰티', '건강기능식품', '식품', '생활용품', '기타'];
const LOG_TYPES = [
  { value: '입고', label: '입고', color: 'text-blue-600 bg-blue-50' },
  { value: '출고', label: '출고', color: 'text-orange-600 bg-orange-50' },
  { value: '조정', label: '조정', color: 'text-purple-600 bg-purple-50' },
  { value: '반품', label: '반품', color: 'text-green-600 bg-green-50' },
];

type View = 'list' | 'detail' | 'form' | 'move';

const EMPTY_FORM = {
  product_name: '', category: '건강기능식품', brand: '',
  company: 'BNKNET', quantity: 0, unit: '개', cost_price: 0, location: '', memo: '', is_active: true,
};

export default function InventoryContent() {
  const me = getUser();
  const isCeo = me?.role === 'ceo';
  const isAdmin = me?.role === 'admin';
  // 재고 등록/수정/삭제 = 대표·실장·영업(강웅구)·재고담당(박정진/최영훈)
  const canManageStock = ['ceo', 'admin', 'sales', 'inventory'].includes(me?.role || '');
  // 입출고 내역(로그) 삭제 = 대표·실장
  const canDeleteLog = isCeo || isAdmin;

  const [view, setView] = useState<View>('list');
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [selected, setSelected] = useState<InventoryItem | null>(null);
  const [logs, setLogs] = useState<InventoryLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterCompany, setFilterCompany] = useState('전체');
  const [filterCategory, setFilterCategory] = useState('전체');
  const [filterBrand, setFilterBrand] = useState('전체');
  const [search, setSearch] = useState('');
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [editId, setEditId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<'stock' | 'log' | 'snapshot' | 'outbound'>('stock');
  const [logManualOnly, setLogManualOnly] = useState(true); // true: 수기 입출고만, false: 주문 자동출고 포함

  // 일자별 출고현황 (주문 데이터 집계)
  const outToday = new Date().toISOString().slice(0, 10);
  const [outFrom, setOutFrom] = useState(outToday);
  const [outTo, setOutTo] = useState(outToday);
  const [outRows, setOutRows] = useState<{ product: string; qty: number; count: number }[]>([]);
  const [outUnmatched, setOutUnmatched] = useState<{ product: string; qty: number; count: number }[]>([]);
  const [outLoading, setOutLoading] = useState(false);

  async function loadOutbound(from: string, to: string) {
    setOutLoading(true);
    try {
      await loadDbMatches(true); // 담당자 등록 매칭 반영
      // PostgREST는 한 번에 최대 1000건만 반환 → 1000건씩 모두 가져오기(페이지네이션)
      type Row = { product_name?: string; collect_product?: string; quantity?: number; canceled?: boolean };
      const data: Row[] = [];
      let start = 0;
      while (true) {
        const res = await supabaseFetch(
          `/orders?upload_date=gte.${from}&upload_date=lte.${to}&select=product_name,collect_product,quantity,canceled`,
          { headers: { 'Range-Unit': 'items', Range: `${start}-${start + 999}` } },
        );
        const chunk: Row[] = await res.json();
        if (!Array.isArray(chunk) || chunk.length === 0) break;
        data.push(...chunk);
        if (chunk.length < 1000) break;
        start += 1000;
      }
      const map: Record<string, { qty: number; count: number }> = {};          // 매칭된 상품
      const unmap: Record<string, { qty: number; count: number }> = {};         // 매칭 안 된 상품(알림용)
      (Array.isArray(data) ? data : []).forEach((r) => {
        if (r.canceled) return;
        const q = Number(r.quantity) || 0;
        if (q < 1) return;
        // 현재 매칭데이터 기준으로 대표상품명 결정 (수집상품명 우선)
        const { name, matched } = matchProduct(r.collect_product || r.product_name || '');
        const target = matched ? map : unmap;
        const key = matched ? name : (r.collect_product || r.product_name || '(상품명 없음)');
        if (!target[key]) target[key] = { qty: 0, count: 0 };
        target[key].qty += q; target[key].count += 1;
      });
      setOutRows(Object.entries(map).map(([product, v]) => ({ product, qty: v.qty, count: v.count })).sort((a, b) => b.qty - a.qty));
      setOutUnmatched(Object.entries(unmap).map(([product, v]) => ({ product, qty: v.qty, count: v.count })).sort((a, b) => b.count - a.count));
    } catch { setOutRows([]); setOutUnmatched([]); }
    finally { setOutLoading(false); }
  }

  function outQuick(kind: 'today' | 'week' | 'month') {
    let from = outToday;
    if (kind === 'week') { const d = new Date(); d.setDate(d.getDate() - 6); from = d.toISOString().slice(0, 10); }
    if (kind === 'month') from = `${outToday.slice(0, 7)}-01`;
    setOutFrom(from); setOutTo(outToday);
    loadOutbound(from, outToday);
  }
  const [loadError, setLoadError] = useState<string | null>(null);
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  const [bulkField, setBulkField] = useState<'company' | 'category' | 'brand' | 'quantity' | 'is_active'>('company');
  const [bulkValue, setBulkValue] = useState('');
  const [bulkSaving, setBulkSaving] = useState(false);

  // 재고↔상품마스터 동기화 (상품명 기준) — 판매상태·카테고리·브랜드
  async function syncProductMaster(productName: string, fields: Record<string, unknown>) {
    if (!productName || !Object.keys(fields).length) return;
    try {
      await supabaseFetch(`/products?name=eq.${encodeURIComponent(productName)}`, {
        method: 'PATCH', headers: { Prefer: 'return=minimal' },
        body: JSON.stringify(fields),
      });
    } catch { /* 매칭 상품 없으면 무시 */ }
  }
  const syncProductActive = (productName: string, isActive: boolean) =>
    syncProductMaster(productName, { is_active: isActive });

  // 일자별 재고 (스냅샷)
  const [snapDate, setSnapDate] = useState(todayDate());
  const [snapshots, setSnapshots] = useState<InventorySnapshot[]>([]);
  const [snapLoading, setSnapLoading] = useState(false);
  const [lastSnapDate, setLastSnapDate] = useState<string | null>(null); // 가장 최근 자동저장 날짜 (안전장치)
  const [snapSaving, setSnapSaving] = useState(false);

  // 입출고 폼
  const [moveForm, setMoveForm] = useState({ type: '입고', quantity: 0, reason: '' });

  useEffect(() => { loadItems(); loadSnapHealth(); }, []);

  // 가장 최근 자동저장 날짜 조회 (안전장치 — 자동저장 누락 감지용)
  async function loadSnapHealth() {
    try {
      const res = await supabaseFetch('/inventory_snapshots?select=snapshot_date&order=snapshot_date.desc&limit=1');
      const data = await res.json();
      setLastSnapDate(Array.isArray(data) && data[0] ? data[0].snapshot_date : null);
    } catch { setLastSnapDate(null); }
  }

  // 수동 스냅샷 저장 (자동저장 실패 시 복구용)
  async function handleManualSnapshot() {
    if (!confirm('지금 시점의 재고를 오늘 날짜로 저장할까요?')) return;
    setSnapSaving(true);
    try {
      const res = await supabaseFetch('/rpc/take_inventory_snapshot', {
        method: 'POST',
        headers: { Prefer: 'return=minimal' },
        body: '{}',
      });
      if (!res.ok) { alert(`저장 실패: ${res.status}`); return; }
      await loadSnapHealth();
      if (activeTab === 'snapshot') await loadSnapshots(snapDate);
      alert('오늘 재고를 저장했습니다.');
    } finally { setSnapSaving(false); }
  }

  async function loadItems() {
    setLoading(true);
    try {
      const data = await supabaseFetchAll<InventoryItem>('/inventory?order=category.asc,product_name.asc');
      setItems(data);
      setLoadError(null);
    } catch (e) { setItems([]); setLoadError('재고 목록을 불러오지 못했습니다. ' + (e instanceof Error ? e.message : '')); }
    finally { setLoading(false); }
  }

  async function loadLogs(inventoryId?: string, manualOnly = logManualOnly) {
    // 전체 입출고 내역 탭에서는 기본적으로 '수기(담당자 직접) 입출고·조정'만 표시.
    // 주문변환 자동출고/취소(order_id 존재)는 건수가 많아 밀리므로 토글로 숨김.
    const base = inventoryId
      ? `/inventory_logs?inventory_id=eq.${inventoryId}&order=created_at.desc&limit=50`
      : `/inventory_logs?order=created_at.desc&limit=200`;
    const query = !inventoryId && manualOnly ? `${base}&order_id=is.null` : base;
    const res = await supabaseFetch(query);
    const data = await res.json();
    setLogs(Array.isArray(data) ? data : []);
  }

  async function loadSnapshots(date: string) {
    setSnapLoading(true);
    try {
      const data = await supabaseFetchAll<InventorySnapshot>(`/inventory_snapshots?snapshot_date=eq.${date}&order=category.asc,product_name.asc`);
      setSnapshots(data);
    } catch { setSnapshots([]); }
    finally { setSnapLoading(false); }
  }

  async function handleSave() {
    if (!form.product_name.trim()) return;
    setSaving(true);
    try {
      const payload = { ...form, quantity: Number(form.quantity) || 0, cost_price: Number(form.cost_price) || 0, updated_at: new Date().toISOString() };
      let res;
      if (editId) {
        res = await supabaseFetch(`/inventory?id=eq.${editId}`, {
          method: 'PATCH',
          headers: { Prefer: 'return=minimal' },
          body: JSON.stringify(payload),
        });
      } else {
        res = await supabaseFetch('/inventory', {
          method: 'POST',
          headers: { Prefer: 'return=minimal' },
          body: JSON.stringify(payload),
        });
      }
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert(`저장 실패: ${(err as any).message || res.status}`);
        return;
      }
      // 판매상태·카테고리·브랜드를 상품마스터에도 동기화 (상품명 기준)
      await syncProductMaster(form.product_name, {
        is_active: form.is_active,
        category: form.category || null,
        brand: form.brand || null,
      });
      setView('list');
      setEditId(null);
      setForm({ ...EMPTY_FORM });
      await loadItems();
    } finally { setSaving(false); }
  }

  async function handleMove() {
    if (!selected || !moveForm.quantity) return;
    setSaving(true);
    try {
      const qty = Number(moveForm.quantity);
      const before = selected.quantity;
      const after = moveForm.type === '출고'
        ? before - qty
        : moveForm.type === '조정'
        ? qty
        : before + qty;

      if (after < 0) { alert('재고가 부족합니다.'); setSaving(false); return; }

      await supabaseFetch(`/inventory?id=eq.${selected.id}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ quantity: after, updated_at: new Date().toISOString() }),
      });

      await supabaseFetch('/inventory_logs', {
        method: 'POST',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({
          inventory_id: selected.id,
          product_name: selected.product_name,
          type: moveForm.type,
          quantity: qty,
          before_qty: before,
          after_qty: after,
          reason: moveForm.reason,
          created_by: me?.name || '',
        }),
      });

      setSelected({ ...selected, quantity: after });
      setMoveForm({ type: '입고', quantity: 0, reason: '' });
      setView('detail');
      await loadItems();
      await loadLogs(selected.id);
    } finally { setSaving(false); }
  }

  async function handleDelete(id: string) {
    if (!confirm('재고 항목을 삭제하시겠습니까?')) return;
    await supabaseFetch(`/inventory?id=eq.${id}`, { method: 'DELETE' });
    setView('list');
    setSelected(null);
    await loadItems();
  }

  async function handleDeleteLog(log: InventoryLog) {
    if (!confirm('입출고 내역을 삭제하시겠습니까?\n재고수량이 변경 전으로 되돌아갑니다.')) return;
    try {
      // 1) 로그 행 삭제 (먼저 — 실패하면 멈춤)
      const delRes = await supabaseFetch(`/inventory_logs?id=eq.${log.id}`, {
        method: 'DELETE', headers: { Prefer: 'return=representation' },
      });
      const deleted = await delRes.json().catch(() => []);
      if (!delRes.ok || !Array.isArray(deleted) || deleted.length === 0) {
        alert('로그 삭제에 실패했습니다. (권한/정책 문제일 수 있어요)');
        return;
      }
      // 2) 재고 수량 원복 (연결된 재고가 있을 때만)
      if (log.inventory_id) {
        await supabaseFetch(`/inventory?id=eq.${log.inventory_id}`, {
          method: 'PATCH', headers: { Prefer: 'return=minimal' },
          body: JSON.stringify({ quantity: log.before_qty, updated_at: new Date().toISOString() }),
        });
      }
      if (selected && log.inventory_id === selected.id) {
        setSelected({ ...selected, quantity: log.before_qty });
        await loadLogs(selected.id);
      } else if (selected) {
        await loadLogs(selected.id);
      } else {
        await loadLogs();
      }
      await loadItems();
    } catch (e) {
      alert('삭제 중 오류: ' + (e instanceof Error ? e.message : '알 수 없음'));
    }
  }

  function openDetail(item: InventoryItem) {
    setSelected(item);
    setView('detail');
    loadLogs(item.id);
  }

  function openForm(item?: InventoryItem) {
    if (item) {
      setForm({
        product_name: item.product_name, category: item.category || '건강기능식품',
        brand: item.brand || '', company: item.company,
        quantity: item.quantity, unit: item.unit || '개',
        cost_price: item.cost_price || 0,
        location: item.location || '', memo: item.memo || '', is_active: item.is_active !== false,
      });
      setEditId(item.id);
    } else {
      setForm({ ...EMPTY_FORM });
      setEditId(null);
    }
    setView('form');
  }

  function toggleCheck(id: string) {
    setCheckedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function toggleAll() {
    if (checkedIds.size === filtered.length) {
      setCheckedIds(new Set());
    } else {
      setCheckedIds(new Set(filtered.map(p => p.id)));
    }
  }

  const BULK_FIELDS = [
    { value: 'company', label: '사업자' },
    { value: 'category', label: '카테고리' },
    { value: 'brand', label: '브랜드' },
    { value: 'quantity', label: '재고수량' },
    { value: 'is_active', label: '판매상태' },
  ] as const;

  async function handleBulkEdit() {
    if (!bulkValue.trim() || checkedIds.size === 0) return;
    const fieldLabel = BULK_FIELDS.find(f => f.value === bulkField)?.label;
    if (!confirm(`선택한 ${checkedIds.size}개 항목의 ${fieldLabel}을(를) "${bulkValue}"으로 변경할까요?`)) return;
    setBulkSaving(true);
    try {
      const val = bulkField === 'quantity' ? Number(bulkValue)
        : bulkField === 'is_active' ? (bulkValue === '판매O')
        : bulkValue;
      await Promise.all([...checkedIds].map(id =>
        supabaseFetch(`/inventory?id=eq.${id}`, {
          method: 'PATCH',
          headers: { Prefer: 'return=minimal' },
          body: JSON.stringify({ [bulkField]: val, updated_at: new Date().toISOString() }),
        })
      ));
      // 판매상태·카테고리·브랜드 변경 시 상품마스터에도 동기화
      if (bulkField === 'is_active' || bulkField === 'category' || bulkField === 'brand') {
        const names = items.filter(it => checkedIds.has(it.id)).map(it => it.product_name);
        await Promise.all(names.map(n => syncProductMaster(n, { [bulkField]: val })));
      }
      setCheckedIds(new Set());
      setBulkValue('');
      await loadItems();
    } finally { setBulkSaving(false); }
  }

  function exportExcel() {
    const data = filtered.map((p) => ({
      상품명: p.product_name,
      카테고리: p.category || '',
      브랜드: p.brand || '',
      사업자: p.company,
      재고수량: p.quantity,
      단위: p.unit,
      개당원가: p.cost_price || 0,
      원가총합: p.quantity * (p.cost_price || 0),
      보관위치: p.location || '',
      최종수정: new Date(p.updated_at).toLocaleDateString('ko-KR'),
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '재고현황');
    XLSX.writeFile(wb, `재고현황_${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  // 브랜드 필터 옵션: 전체 + 기타1(부진재고) + 데이터에 존재하는 나머지 브랜드
  const brandOptions = ['전체', '기타1', ...Array.from(
    new Set(items.map((i) => i.brand).filter((b): b is string => !!b))
  ).filter((b) => b !== '기타1').sort((a, b) => a.localeCompare(b, 'ko'))];

  const filtered = items.filter((p) => {
    const matchCompany = filterCompany === '전체' || p.company === filterCompany;
    const matchCategory = filterCategory === '전체' || p.category === filterCategory;
    const matchBrand = filterBrand === '전체' || (p.brand || '') === filterBrand;
    const matchSearch = !search || p.product_name.includes(search) || (p.brand || '').includes(search);
    return matchCompany && matchCategory && matchBrand && matchSearch;
  }).sort((a, b) => {
    // 판매O 먼저 → 재고수량 많은 순 → 원가총합(수량×원가) 높은 순
    const av = a.is_active !== false, bv = b.is_active !== false;
    if (av !== bv) return av ? -1 : 1;
    if (b.quantity !== a.quantity) return b.quantity - a.quantity;
    return (b.quantity * (b.cost_price || 0)) - (a.quantity * (a.cost_price || 0));
  });

  const totalQty = filtered.reduce((s, p) => s + p.quantity, 0);
  const totalCost = filtered.reduce((s, p) => s + p.quantity * (p.cost_price || 0), 0);

  // 일자별 재고 (스냅샷) — 회사/검색 필터 공유
  const filteredSnap = snapshots.filter((s) =>
    (filterCompany === '전체' || s.company === filterCompany) &&
    (!search || s.product_name.includes(search) || (s.brand || '').includes(search))
  );
  const snapTotalQty = filteredSnap.reduce((a, s) => a + s.quantity, 0);
  const snapTotalCost = filteredSnap.reduce((a, s) => a + s.quantity * (s.cost_price || 0), 0);

  function exportSnapshotExcel() {
    const data = filteredSnap.map((s) => ({
      날짜: s.snapshot_date,
      상품명: s.product_name,
      카테고리: s.category || '',
      브랜드: s.brand || '',
      사업자: s.company,
      재고수량: s.quantity,
      개당원가: s.cost_price || 0,
      원가총합: s.quantity * (s.cost_price || 0),
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '일자별재고');
    XLSX.writeFile(wb, `일자별재고_${snapDate}.xlsx`);
  }

  // 목록
  if (view === 'list') return (
    <div className="space-y-4">
      {/* 탭 */}
      <div className="flex gap-1 bg-gray-100 rounded-xl p-1 w-fit max-w-full overflow-x-auto">
        {(['stock', 'log', 'snapshot', 'outbound'] as const).map((t) => (
          <button key={t} onClick={() => {
              setActiveTab(t);
              if (t === 'log') loadLogs();
              if (t === 'snapshot') loadSnapshots(snapDate);
              if (t === 'outbound') loadOutbound(outFrom, outTo);
            }}
            className={`px-4 py-2 rounded-lg text-base font-medium transition-colors whitespace-nowrap ${activeTab === t ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
            {t === 'stock' ? '재고 현황' : t === 'log' ? '입출고 내역' : t === 'snapshot' ? '일자별 재고' : '일자별 출고'}
          </button>
        ))}
      </div>

      {loadError && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-base text-red-700 font-medium">
          ⚠️ {loadError}
        </div>
      )}

      {/* 자동저장 안전장치 — 자동저장이 하루 이상 누락되면 경고 + 수동 저장 */}
      {canManageStock && lastSnapDate && lastSnapDate < yesterdayDate() && (
        <div className="flex items-center justify-between gap-3 bg-red-50 border border-red-200 rounded-xl px-4 py-3 flex-wrap">
          <div className="text-base text-red-600">
            ⚠️ 재고 자동저장이 멈춘 것 같습니다 — 마지막 저장: <span className="font-bold">{lastSnapDate}</span>
            <span className="block text-sm text-red-400">매일 밤 자동 저장돼야 정상입니다. 오른쪽 버튼으로 지금 바로 저장할 수 있어요.</span>
          </div>
          <button onClick={handleManualSnapshot} disabled={snapSaving}
            className="px-4 py-2 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white rounded-xl text-base font-medium flex-shrink-0">
            {snapSaving ? '저장 중...' : '지금 재고 저장'}
          </button>
        </div>
      )}

      {activeTab === 'stock' ? (
        <>
          {/* 필터 */}
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
            <div className="space-y-2 flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm text-gray-400 w-14 flex-shrink-0">카테고리</span>
                <div className="flex gap-2 overflow-x-auto pb-1 -mb-1">
                  {CATEGORIES.map((c) => (
                    <button key={c} onClick={() => setFilterCategory(c)}
                      className={`px-3 py-1.5 rounded-lg text-base font-medium transition-colors flex-shrink-0 whitespace-nowrap ${filterCategory === c ? 'bg-blue-600 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
                      {c}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm text-gray-400 w-14 flex-shrink-0">사업자</span>
                <div className="flex gap-2 overflow-x-auto pb-1 -mb-1">
                  {COMPANIES.map((c) => (
                    <button key={c} onClick={() => setFilterCompany(c)}
                      className={`px-3 py-1.5 rounded-lg text-base font-medium transition-colors flex-shrink-0 whitespace-nowrap ${filterCompany === c ? 'bg-slate-700 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
                      {c}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm text-gray-400 w-14">브랜드</span>
                <select value={filterBrand} onChange={(e) => setFilterBrand(e.target.value)}
                  className="px-3 py-1.5 rounded-lg text-base font-medium bg-white border border-gray-200 text-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500">
                  {brandOptions.map((b) => (
                    <option key={b} value={b}>{b === '기타1' ? '기타1 (부진재고)' : b}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="flex gap-2 flex-shrink-0">
              <button onClick={exportExcel}
                className="flex-1 sm:flex-none px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-xl text-base font-medium transition-colors whitespace-nowrap">
                엑셀 다운로드
              </button>
              {canManageStock && (
                <button onClick={() => openForm()}
                  className="flex-1 sm:flex-none px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-base font-medium transition-colors whitespace-nowrap">
                  + 재고 등록
                </button>
              )}
            </div>
          </div>

          {/* 검색 */}
          <div className="relative">
            <svg className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="상품명, 브랜드 검색"
              className="w-full pl-10 pr-4 py-3 border border-gray-200 rounded-xl text-base focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white" />
          </div>

          {/* 통계 */}
          <div className="grid grid-cols-3 gap-2 sm:gap-3">
            {[
              { label: '전체 품목', value: `${filtered.length}개`, full: '' },
              { label: '총 재고수량', value: `${totalQty.toLocaleString()}개`, full: '' },
              { label: '원가총합', value: `${shortWon(totalCost)}원`, full: `${totalCost.toLocaleString()}원` },
            ].map((s) => (
              <div key={s.label} className="bg-white rounded-xl border border-gray-100 px-3 py-3" title={s.full}>
                <div className="text-xs sm:text-sm text-gray-400">{s.label}</div>
                <div className="text-base sm:text-lg font-bold mt-0.5 text-gray-800 whitespace-nowrap">{s.value}</div>
              </div>
            ))}
          </div>

          {/* 일괄변경 바 */}
          {checkedIds.size > 0 && canManageStock && (
            <div className="flex items-center gap-3 bg-blue-600 text-white px-5 py-3 rounded-xl flex-wrap">
              <span className="text-base font-medium flex-shrink-0">{checkedIds.size}개 선택됨</span>
              <div className="flex items-center gap-2 ml-auto flex-wrap">
                <span className="text-base text-blue-200 flex-shrink-0">일괄 변경:</span>
                {/* 필드 선택 */}
                <select value={bulkField} onChange={(e) => { setBulkField(e.target.value as any); setBulkValue(''); }}
                  className="px-3 py-1.5 rounded-lg text-base text-gray-800 bg-white border-0 focus:outline-none">
                  {BULK_FIELDS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
                </select>
                {/* 값 입력 — 필드에 따라 드롭다운 or 텍스트 */}
                {bulkField === 'company' ? (
                  <select value={bulkValue} onChange={(e) => setBulkValue(e.target.value)}
                    className="px-3 py-1.5 rounded-lg text-base text-gray-800 bg-white border-0 focus:outline-none">
                    <option value="">선택</option>
                    {COMPANIES.filter(c => c !== '전체').map(c => <option key={c}>{c}</option>)}
                  </select>
                ) : bulkField === 'category' ? (
                  <select value={bulkValue} onChange={(e) => setBulkValue(e.target.value)}
                    className="px-3 py-1.5 rounded-lg text-base text-gray-800 bg-white border-0 focus:outline-none">
                    <option value="">선택</option>
                    {CATEGORIES.filter(c => c !== '전체').map(c => <option key={c}>{c}</option>)}
                  </select>
                ) : bulkField === 'quantity' ? (
                  <input type="number" value={bulkValue} onChange={(e) => setBulkValue(e.target.value)}
                    placeholder="수량 입력" min={0}
                    className="w-24 px-3 py-1.5 rounded-lg text-base text-gray-800 bg-white border-0 focus:outline-none" />
                ) : bulkField === 'is_active' ? (
                  <select value={bulkValue} onChange={(e) => setBulkValue(e.target.value)}
                    className="px-3 py-1.5 rounded-lg text-base text-gray-800 bg-white border-0 focus:outline-none">
                    <option value="">선택</option>
                    <option value="판매O">판매O</option>
                    <option value="판매X">판매X</option>
                  </select>
                ) : (
                  <input type="text" value={bulkValue} onChange={(e) => setBulkValue(e.target.value)}
                    placeholder="브랜드명 입력"
                    className="w-32 px-3 py-1.5 rounded-lg text-base text-gray-800 bg-white border-0 focus:outline-none" />
                )}
                <button onClick={handleBulkEdit} disabled={!bulkValue || bulkSaving}
                  className="px-4 py-1.5 bg-white text-blue-600 rounded-lg text-base font-medium disabled:opacity-50 hover:bg-blue-50 transition-colors">
                  {bulkSaving ? '변경 중...' : '적용'}
                </button>
                <button onClick={() => { setCheckedIds(new Set()); setBulkValue(''); }}
                  className="px-3 py-1.5 bg-blue-500 rounded-lg text-base hover:bg-blue-400 transition-colors">
                  취소
                </button>
              </div>
            </div>
          )}

          {/* 테이블 */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
            {loading ? (
              <div className="text-center py-12 text-gray-400">불러오는 중...</div>
            ) : filtered.length === 0 ? (
              <div className="text-center py-12 text-gray-400">등록된 재고가 없습니다</div>
            ) : (
              <>
                {/* 데스크탑: 표 */}
                <div className="overflow-x-auto hidden sm:block">
                  <table className="w-full text-base">
                    <thead className="bg-gray-50 border-b border-gray-100">
                      <tr>
                        <th className="px-4 py-3">
                          <input type="checkbox"
                            checked={filtered.length > 0 && checkedIds.size === filtered.length}
                            onChange={toggleAll}
                            className="w-4 h-4 rounded border-gray-300 text-blue-600 cursor-pointer" />
                        </th>
                        {['상품명', '판매상태', '카테고리', '브랜드', '사업자', '재고수량', '개당원가', '원가총합', '최종수정'].map((h) => (
                          <th key={h} className="px-4 py-3 text-left text-sm font-medium text-gray-500">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {filtered.map((p) => (
                        <tr key={p.id}
                          className={`hover:bg-blue-50/40 transition-colors ${checkedIds.has(p.id) ? 'bg-blue-50' : ''}`}>
                          <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                            <input type="checkbox"
                              checked={checkedIds.has(p.id)}
                              onChange={() => toggleCheck(p.id)}
                              className="w-4 h-4 rounded border-gray-300 text-blue-600 cursor-pointer" />
                          </td>
                          <td className="px-4 py-3 font-medium text-gray-800 cursor-pointer" onClick={() => openDetail(p)}>{p.product_name}</td>
                          <td className="px-4 py-3">
                            <span className={`text-xs px-2 py-0.5 rounded-md font-medium ${p.is_active === false ? 'bg-gray-100 text-gray-500' : 'bg-green-100 text-green-700'}`}>
                              {p.is_active === false ? '판매X' : '판매O'}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-gray-500 cursor-pointer" onClick={() => openDetail(p)}>{p.category || '-'}</td>
                          <td className="px-4 py-3 text-gray-500 cursor-pointer" onClick={() => openDetail(p)}>{p.brand || '-'}</td>
                          <td className="px-4 py-3 text-gray-500 cursor-pointer" onClick={() => openDetail(p)}>{p.company}</td>
                          <td className="px-4 py-3 cursor-pointer" onClick={() => openDetail(p)}>
                            <span className={`font-bold ${p.quantity === 0 ? 'text-red-500' : p.quantity <= 10 ? 'text-orange-500' : 'text-gray-800'}`}>
                              {p.quantity.toLocaleString()} {p.unit}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-gray-600 cursor-pointer" onClick={() => openDetail(p)}>{(p.cost_price || 0).toLocaleString()}원</td>
                          <td className="px-4 py-3 font-medium text-gray-800 cursor-pointer" onClick={() => openDetail(p)}>{(p.quantity * (p.cost_price || 0)).toLocaleString()}원</td>
                          <td className="px-4 py-3 text-gray-400 text-sm cursor-pointer" onClick={() => openDetail(p)}>{new Date(p.updated_at).toLocaleDateString('ko-KR')}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* 모바일: 카드형 */}
                <div className="sm:hidden divide-y divide-gray-100">
                  {filtered.map((p) => (
                    <div key={p.id} className={`px-4 py-3.5 flex items-start gap-3 ${checkedIds.has(p.id) ? 'bg-blue-50' : ''}`}>
                      <input type="checkbox"
                        checked={checkedIds.has(p.id)}
                        onChange={() => toggleCheck(p.id)}
                        className="w-4 h-4 mt-1 rounded border-gray-300 text-blue-600 cursor-pointer flex-shrink-0" />
                      <div className="flex-1 min-w-0" onClick={() => openDetail(p)}>
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span className="font-bold text-gray-800 text-[15px] truncate">{p.product_name}</span>
                            <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium flex-shrink-0 ${p.is_active === false ? 'bg-gray-100 text-gray-500' : 'bg-green-100 text-green-700'}`}>
                              {p.is_active === false ? '판매X' : '판매O'}
                            </span>
                          </div>
                          <span className={`font-bold flex-shrink-0 ${p.quantity === 0 ? 'text-red-500' : p.quantity <= 10 ? 'text-orange-500' : 'text-gray-800'}`}>
                            {p.quantity.toLocaleString()} {p.unit}
                          </span>
                        </div>
                        <div className="text-sm text-gray-400 mt-1">
                          {p.company}{p.brand ? ` · ${p.brand}` : ''}{p.category ? ` · ${p.category}` : ''}
                        </div>
                        <div className="text-sm text-gray-500 mt-1">
                          개당 {(p.cost_price || 0).toLocaleString()}원 · 총 <span className="font-medium text-gray-700">{(p.quantity * (p.cost_price || 0)).toLocaleString()}원</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </>
      ) : activeTab === 'log' ? (
        /* 입출고 내역 탭 */
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
            <div className="text-sm text-gray-500">
              {logManualOnly ? '수기 입출고·조정만 표시 (주문 자동출고 제외)' : '전체 표시 (주문 자동출고 포함)'}
            </div>
            <button
              onClick={() => { const next = !logManualOnly; setLogManualOnly(next); loadLogs(undefined, next); }}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
                logManualOnly ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
              }`}
            >
              {logManualOnly ? '📝 수기만' : '📋 전체'}
            </button>
          </div>
          {logs.length === 0 ? (
            <div className="text-center py-12 text-gray-400">
              {logManualOnly ? '수기 입출고 내역이 없습니다' : '입출고 내역이 없습니다'}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-base">
                <thead className="bg-gray-50 border-b border-gray-100">
                  <tr>
                    {['일시', '상품명', '구분', '수량', '변경 전', '변경 후', '사유', '처리자', ...(canDeleteLog ? ['삭제'] : [])].map((h) => (
                      <th key={h} className="px-4 py-3 text-left text-sm font-medium text-gray-500">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {logs.map((log) => {
                    const typeInfo = LOG_TYPES.find(t => t.value === log.type);
                    return (
                      <tr key={log.id}>
                        <td className="px-4 py-3 text-gray-400 text-sm">{new Date(log.created_at).toLocaleString('ko-KR')}</td>
                        <td className="px-4 py-3 font-medium text-gray-800">{log.product_name}</td>
                        <td className="px-4 py-3">
                          <span className={`text-sm px-2 py-0.5 rounded-md font-medium ${typeInfo?.color || 'bg-gray-100 text-gray-600'}`}>{log.type}</span>
                        </td>
                        <td className="px-4 py-3 font-medium text-gray-800">{log.quantity}</td>
                        <td className="px-4 py-3 text-gray-500">{log.before_qty}</td>
                        <td className="px-4 py-3 text-gray-500">{log.after_qty}</td>
                        <td className="px-4 py-3 text-gray-500">{log.reason || '-'}</td>
                        <td className="px-4 py-3 text-gray-500">{log.created_by || '-'}</td>
                        {canDeleteLog && (
                          <td className="px-4 py-3">
                            <button onClick={() => handleDeleteLog(log)}
                              className="text-sm text-red-400 hover:text-red-600 hover:underline">삭제</button>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : activeTab === 'snapshot' ? (
        /* 일자별 재고 탭 */
        <>
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm text-gray-400">조회 날짜</span>
              <input type="date" value={snapDate} max={todayDate()}
                onChange={(e) => { setSnapDate(e.target.value); loadSnapshots(e.target.value); }}
                className="px-3 py-2 border border-gray-200 rounded-xl text-base focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white" />
              {COMPANIES.map((c) => (
                <button key={c} onClick={() => setFilterCompany(c)}
                  className={`px-3 py-1.5 rounded-lg text-base font-medium transition-colors ${filterCompany === c ? 'bg-slate-700 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
                  {c}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              {canManageStock && (
                <button onClick={handleManualSnapshot} disabled={snapSaving}
                  className="px-4 py-2 bg-white border border-gray-200 text-gray-700 hover:bg-gray-50 disabled:opacity-50 rounded-xl text-base font-medium transition-colors">
                  {snapSaving ? '저장 중...' : '지금 재고 저장'}
                </button>
              )}
              <button onClick={exportSnapshotExcel} disabled={filteredSnap.length === 0}
                className="px-4 py-2 bg-green-600 hover:bg-green-700 disabled:opacity-40 text-white rounded-xl text-base font-medium transition-colors">
                엑셀 다운로드
              </button>
            </div>
          </div>

          {lastSnapDate && (
            <p className="text-sm text-gray-400">🕚 마지막 자동저장: {lastSnapDate} · 매일 밤 11:50 자동 저장됩니다</p>
          )}

          <div className="relative">
            <svg className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="상품명, 브랜드 검색"
              className="w-full pl-10 pr-4 py-3 border border-gray-200 rounded-xl text-base focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white" />
          </div>

          <div className="grid grid-cols-3 gap-2 sm:gap-3">
            {[
              { label: `${snapDate} 품목`, value: `${filteredSnap.length}개`, full: '' },
              { label: '총 재고수량', value: `${snapTotalQty.toLocaleString()}개`, full: '' },
              { label: '원가총합', value: `${shortWon(snapTotalCost)}원`, full: `${snapTotalCost.toLocaleString()}원` },
            ].map((s) => (
              <div key={s.label} className="bg-white rounded-xl border border-gray-100 px-3 py-3" title={s.full}>
                <div className="text-xs sm:text-sm text-gray-400">{s.label}</div>
                <div className="text-base sm:text-lg font-bold mt-0.5 text-gray-800 whitespace-nowrap">{s.value}</div>
              </div>
            ))}
          </div>

          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
            {snapLoading ? (
              <div className="text-center py-12 text-gray-400">불러오는 중...</div>
            ) : filteredSnap.length === 0 ? (
              <div className="text-center py-12 text-gray-400">
                {snapDate} 재고 기록이 없습니다
                <div className="text-sm text-gray-300 mt-1">일자별 재고는 매일 자동 저장되며, 저장이 시작된 날부터 조회할 수 있습니다</div>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-base">
                  <thead className="bg-gray-50 border-b border-gray-100">
                    <tr>
                      {['상품명', '카테고리', '브랜드', '사업자', '재고수량', '개당원가', '원가총합'].map((h) => (
                        <th key={h} className="px-4 py-3 text-left text-sm font-medium text-gray-500">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {filteredSnap.map((s) => (
                      <tr key={s.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3 font-medium text-gray-800">{s.product_name}</td>
                        <td className="px-4 py-3 text-gray-500">{s.category || '-'}</td>
                        <td className="px-4 py-3 text-gray-500">{s.brand || '-'}</td>
                        <td className="px-4 py-3 text-gray-500">{s.company}</td>
                        <td className="px-4 py-3 font-bold text-gray-800">{s.quantity.toLocaleString()}</td>
                        <td className="px-4 py-3 text-gray-600">{(s.cost_price || 0).toLocaleString()}원</td>
                        <td className="px-4 py-3 font-medium text-gray-800">{(s.quantity * (s.cost_price || 0)).toLocaleString()}원</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      ) : (
        /* 일자별 출고 탭 */
        <>
          <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
            <h2 className="text-lg font-bold text-gray-800 mb-3">일자별 출고현황</h2>
            <div className="flex items-center gap-2 flex-wrap">
              <input type="date" value={outFrom} onChange={e => setOutFrom(e.target.value)}
                className="px-3 py-1.5 border border-gray-200 rounded-lg text-base focus:outline-none focus:ring-2 focus:ring-blue-400" />
              <span className="text-gray-400">~</span>
              <input type="date" value={outTo} onChange={e => setOutTo(e.target.value)}
                className="px-3 py-1.5 border border-gray-200 rounded-lg text-base focus:outline-none focus:ring-2 focus:ring-blue-400" />
              <button onClick={() => loadOutbound(outFrom, outTo)}
                className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-base font-medium">조회</button>
              <div className="flex gap-1.5 ml-1">
                <button onClick={() => outQuick('today')} className="px-2.5 py-1.5 text-sm border border-gray-200 rounded-lg text-gray-500 hover:bg-gray-50">오늘</button>
                <button onClick={() => outQuick('week')} className="px-2.5 py-1.5 text-sm border border-gray-200 rounded-lg text-gray-500 hover:bg-gray-50">최근 7일</button>
                <button onClick={() => outQuick('month')} className="px-2.5 py-1.5 text-sm border border-gray-200 rounded-lg text-gray-500 hover:bg-gray-50">이번달</button>
              </div>
            </div>
            <p className="text-sm text-gray-400 mt-2">매칭데이터 기준 대표상품명으로 합산 · 취소건 제외 · 출고수량 많은 순</p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="bg-white rounded-xl border border-gray-100 px-4 py-3">
              <div className="text-sm text-gray-400">출고 품목 수</div>
              <div className="text-xl font-bold text-gray-800 mt-0.5">{outRows.length}종</div>
            </div>
            <div className="bg-white rounded-xl border border-gray-100 px-4 py-3">
              <div className="text-sm text-gray-400">총 출고 수량</div>
              <div className="text-xl font-bold text-blue-600 mt-0.5">{outRows.reduce((s, r) => s + r.qty, 0).toLocaleString()}개</div>
            </div>
          </div>

          {/* ⚠️ 매칭 안 된 상품 알림 (매칭데이터 추가 필요) */}
          {!outLoading && outUnmatched.length > 0 && (
            <div className="bg-red-50 border border-red-200 rounded-2xl p-4">
              <div className="flex items-start gap-2">
                <span className="text-lg">⚠️</span>
                <div className="flex-1 min-w-0">
                  <div className="font-bold text-red-700">매칭데이터에 없는 상품 {outUnmatched.length}종 ({outUnmatched.reduce((s, r) => s + r.count, 0)}건)</div>
                  <div className="text-sm text-red-500 mt-0.5">아래 상품들은 매칭이 안 돼 위 출고 집계에서 <b>제외</b>됐습니다 (수량이 부정확할 수 있음). 실장님에게 전달해 매칭데이터에 추가하세요.</div>
                  <div className="mt-2 space-y-1">
                    {outUnmatched.map((u, i) => (
                      <div key={i} className="text-sm bg-white border border-red-100 rounded-lg px-3 py-1.5 flex items-center justify-between gap-2">
                        <span className="text-gray-700 truncate">{u.product}</span>
                        <span className="text-red-500 font-medium flex-shrink-0">{u.count}건</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
            {outLoading ? (
              <div className="text-center py-12 text-gray-400">불러오는 중...</div>
            ) : outRows.length === 0 ? (
              <div className="text-center py-12 text-gray-400">{outFrom} ~ {outTo} 출고 내역이 없습니다</div>
            ) : (
              <table className="w-full text-base">
                <thead className="bg-gray-50 border-b border-gray-100">
                  <tr>
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-500 w-10">#</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">상품명</th>
                    <th className="px-4 py-3 text-center text-sm font-medium text-gray-500 w-24">주문건수</th>
                    <th className="px-4 py-3 text-right text-sm font-medium text-gray-500 w-28">출고수량</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {outRows.map((r, i) => (
                    <tr key={i} className="hover:bg-blue-50/40">
                      <td className="px-4 py-2.5 text-gray-400 text-sm">{i + 1}</td>
                      <td className="px-4 py-2.5 text-gray-700">{r.product}</td>
                      <td className="px-4 py-2.5 text-center text-gray-500">{r.count}건</td>
                      <td className="px-4 py-2.5 text-right font-bold text-gray-800">{r.qty.toLocaleString()}개</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-gray-50 border-t border-gray-200 font-bold">
                    <td className="px-4 py-3" colSpan={3}>합계</td>
                    <td className="px-4 py-3 text-right text-blue-600">{outRows.reduce((s, r) => s + r.qty, 0).toLocaleString()}개</td>
                  </tr>
                </tfoot>
              </table>
            )}
          </div>
        </>
      )}
    </div>
  );

  // 상세
  if (view === 'detail' && selected) return (
    <div className="space-y-4">
      <button onClick={() => setView('list')} className="text-base text-blue-600 hover:text-blue-700">← 목록으로</button>
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
        <div className="flex items-start justify-between mb-6">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-xl font-bold text-gray-800">{selected.product_name}</h2>
              {selected.category && <span className="text-sm px-2 py-0.5 rounded-md bg-blue-100 text-blue-700">{selected.category}</span>}
              <span className="text-sm px-2 py-0.5 rounded-md bg-slate-100 text-slate-600">{selected.company}</span>
            </div>
            {selected.brand && <p className="text-gray-400 text-base mt-1">{selected.brand}</p>}
          </div>
          <div className="flex gap-2">
            {canManageStock && (
              <button onClick={() => { setMoveForm({ type: '입고', quantity: 0, reason: '' }); setView('move'); }}
                className="px-3 py-1.5 text-base text-white bg-blue-600 rounded-lg hover:bg-blue-700">입출고</button>
            )}
            {canManageStock && (
              <button onClick={() => openForm(selected)} className="px-3 py-1.5 text-base text-blue-600 border border-blue-200 rounded-lg hover:bg-blue-50">수정</button>
            )}
            {canDeleteLog && (
              <button onClick={() => handleDelete(selected.id)} className="px-3 py-1.5 text-base text-red-500 border border-red-200 rounded-lg hover:bg-red-50">삭제</button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mb-6">
          <div className="bg-blue-50 rounded-xl px-4 py-4 col-span-2 sm:col-span-1">
            <div className="text-sm text-blue-400 mb-1">현재 재고</div>
            <div className={`text-3xl font-bold ${selected.quantity === 0 ? 'text-red-500' : selected.quantity <= 10 ? 'text-orange-500' : 'text-blue-600'}`}>
              {selected.quantity.toLocaleString()}
            </div>
            <div className="text-base text-blue-400 mt-0.5">{selected.unit}</div>
          </div>
          {[
            { label: '개당원가', value: `${(selected.cost_price || 0).toLocaleString()}원` },
            { label: '원가총합', value: `${(selected.quantity * (selected.cost_price || 0)).toLocaleString()}원` },
            { label: '브랜드', value: selected.brand || '-' },
            { label: '보관위치', value: selected.location || '-' },
            { label: '최종수정', value: new Date(selected.updated_at).toLocaleDateString('ko-KR') },
          ].map((item) => (
            <div key={item.label} className="bg-gray-50 rounded-xl px-4 py-3">
              <div className="text-sm text-gray-400 mb-1">{item.label}</div>
              <div className="text-base font-medium text-gray-700">{item.value}</div>
            </div>
          ))}
        </div>

        {selected.memo && (
          <div className="mb-6 bg-gray-50 rounded-xl px-4 py-3">
            <div className="text-sm text-gray-400 mb-1">메모</div>
            <div className="text-base text-gray-700">{selected.memo}</div>
          </div>
        )}

        {/* 입출고 내역 */}
        <div>
          <div className="text-base font-medium text-gray-700 mb-3">입출고 내역</div>
          {logs.length === 0 ? (
            <div className="text-center py-8 text-gray-400 text-base bg-gray-50 rounded-xl">입출고 내역이 없습니다</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-base">
                <thead className="bg-gray-50 rounded-xl">
                  <tr>
                    {['일시', '구분', '수량', '변경 전→후', '사유', '처리자', ...(canDeleteLog ? [''] : [])].map((h, i) => (
                      <th key={i} className="px-3 py-2 text-left text-sm font-medium text-gray-500">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {logs.map((log) => {
                    const typeInfo = LOG_TYPES.find(t => t.value === log.type);
                    return (
                      <tr key={log.id}>
                        <td className="px-3 py-2 text-gray-400 text-sm">{new Date(log.created_at).toLocaleString('ko-KR')}</td>
                        <td className="px-3 py-2">
                          <span className={`text-sm px-2 py-0.5 rounded-md font-medium ${typeInfo?.color || 'bg-gray-100 text-gray-600'}`}>{log.type}</span>
                        </td>
                        <td className="px-3 py-2 font-medium text-gray-800">{log.quantity}</td>
                        <td className="px-3 py-2 text-gray-500">{log.before_qty} → {log.after_qty}</td>
                        <td className="px-3 py-2 text-gray-500">{log.reason || '-'}</td>
                        <td className="px-3 py-2 text-gray-500">{log.created_by || '-'}</td>
                        {canDeleteLog && (
                          <td className="px-3 py-2">
                            <button onClick={() => handleDeleteLog(log)}
                              className="text-sm text-red-400 hover:text-red-600 hover:underline">삭제</button>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );

  // 입출고 처리
  if (view === 'move' && selected) return (
    <div className="space-y-4">
      <button onClick={() => setView('detail')} className="text-base text-blue-600 hover:text-blue-700">← 상세로</button>
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
        <h2 className="text-lg font-bold text-gray-800 mb-1">입출고 처리</h2>
        <p className="text-base text-gray-400 mb-6">{selected.product_name} · 현재 재고: <span className="font-bold text-gray-700">{selected.quantity} {selected.unit}</span></p>

        <div className="space-y-4">
          <div>
            <label className="block text-base font-medium text-gray-700 mb-2">구분</label>
            <div className="flex gap-2 flex-wrap">
              {LOG_TYPES.map((t) => (
                <button key={t.value} onClick={() => setMoveForm({ ...moveForm, type: t.value })}
                  className={`px-4 py-2 rounded-xl text-base font-medium transition-colors border ${moveForm.type === t.value ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}>
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-base font-medium text-gray-700 mb-1.5">
              {moveForm.type === '조정' ? '조정 후 수량' : '수량'}
            </label>
            <input type="number" value={moveForm.quantity || ''}
              onChange={(e) => setMoveForm({ ...moveForm, quantity: Number(e.target.value) })}
              placeholder="0"
              className="w-full px-4 py-3 border border-gray-200 rounded-xl text-base focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>

          {moveForm.quantity > 0 && (
            <div className="bg-blue-50 rounded-xl px-4 py-3 text-base text-blue-600">
              처리 후 재고: <span className="font-bold text-lg">
                {moveForm.type === '출고'
                  ? selected.quantity - moveForm.quantity
                  : moveForm.type === '조정'
                  ? moveForm.quantity
                  : selected.quantity + moveForm.quantity}
              </span> {selected.unit}
            </div>
          )}

          <div>
            <label className="block text-base font-medium text-gray-700 mb-1.5">사유 (선택)</label>
            <input value={moveForm.reason}
              onChange={(e) => setMoveForm({ ...moveForm, reason: e.target.value })}
              placeholder="입출고 사유 입력"
              className="w-full px-4 py-3 border border-gray-200 rounded-xl text-base focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
        </div>

        <div className="flex gap-3 mt-6">
          <button onClick={handleMove} disabled={saving || !moveForm.quantity}
            className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white rounded-xl font-medium text-base transition-colors">
            {saving ? '처리 중...' : '처리 완료'}
          </button>
          <button onClick={() => setView('detail')}
            className="px-6 py-2.5 bg-white border border-gray-200 text-gray-600 rounded-xl font-medium text-base hover:bg-gray-50">
            취소
          </button>
        </div>
      </div>
    </div>
  );

  // 등록/수정 폼
  return (
    <div className="space-y-4">
      <button onClick={() => { setView('list'); setEditId(null); }} className="text-base text-blue-600 hover:text-blue-700">← 목록으로</button>
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
        <h2 className="text-lg font-bold text-gray-800 mb-5">{editId ? '재고 수정' : '재고 등록'}</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="sm:col-span-2">
            <label className="block text-base font-medium text-gray-700 mb-1.5">상품명 *</label>
            <input value={form.product_name} onChange={(e) => setForm({ ...form, product_name: e.target.value })}
              placeholder="상품명" className="w-full px-4 py-3 border border-gray-200 rounded-xl text-base focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="block text-base font-medium text-gray-700 mb-1.5">카테고리</label>
            <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}
              className="w-full px-4 py-3 border border-gray-200 rounded-xl text-base focus:outline-none focus:ring-2 focus:ring-blue-500">
              {CATEGORIES.filter(c => c !== '전체').map((c) => <option key={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-base font-medium text-gray-700 mb-1.5">소속 사업자</label>
            <select value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })}
              className="w-full px-4 py-3 border border-gray-200 rounded-xl text-base focus:outline-none focus:ring-2 focus:ring-blue-500">
              {COMPANIES.map((c) => <option key={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-base font-medium text-gray-700 mb-1.5">브랜드</label>
            <input value={form.brand} onChange={(e) => setForm({ ...form, brand: e.target.value })}
              placeholder="브랜드명 (부진재고는 기타1)" list="inv-brand-list"
              className="w-full px-4 py-3 border border-gray-200 rounded-xl text-base focus:outline-none focus:ring-2 focus:ring-blue-500" />
            <datalist id="inv-brand-list">
              {brandOptions.filter((b) => b !== '전체').map((b) => <option key={b} value={b} />)}
            </datalist>
          </div>
          <div>
            <label className="block text-base font-medium text-gray-700 mb-1.5">단위</label>
            <select value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })}
              className="w-full px-4 py-3 border border-gray-200 rounded-xl text-base focus:outline-none focus:ring-2 focus:ring-blue-500">
              {['개', '박스', '세트', '포', '병', '팩'].map((u) => <option key={u}>{u}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-base font-medium text-gray-700 mb-1.5">초기 재고수량</label>
            <input type="number" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: Number(e.target.value) })}
              placeholder="0" className="w-full px-4 py-3 border border-gray-200 rounded-xl text-base focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="block text-base font-medium text-gray-700 mb-1.5">개당원가 (원)</label>
            <input type="number" value={form.cost_price} onChange={(e) => setForm({ ...form, cost_price: Number(e.target.value) })}
              placeholder="0" min={0} className="w-full px-4 py-3 border border-gray-200 rounded-xl text-base focus:outline-none focus:ring-2 focus:ring-blue-500" />
            {Number(form.quantity) > 0 && Number(form.cost_price) > 0 && (
              <p className="text-sm text-gray-400 mt-1">원가총합 {(Number(form.quantity) * Number(form.cost_price)).toLocaleString()}원</p>
            )}
          </div>
          <div>
            <label className="block text-base font-medium text-gray-700 mb-1.5">보관위치</label>
            <input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })}
              placeholder="창고 A, 선반 3 등" className="w-full px-4 py-3 border border-gray-200 rounded-xl text-base focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="block text-base font-medium text-gray-700 mb-1.5">판매상태</label>
            <div className="flex gap-2">
              {[{ v: true, l: '판매O' }, { v: false, l: '판매X' }].map(o => (
                <button key={o.l} type="button" onClick={() => setForm({ ...form, is_active: o.v })}
                  className={`flex-1 px-4 py-3 rounded-xl text-base font-medium border ${form.is_active === o.v ? (o.v ? 'bg-green-600 text-white border-green-600' : 'bg-gray-500 text-white border-gray-500') : 'bg-white text-gray-500 border-gray-200'}`}>
                  {o.l}
                </button>
              ))}
            </div>
          </div>
          <div className="sm:col-span-2">
            <label className="block text-base font-medium text-gray-700 mb-1.5">메모</label>
            <textarea value={form.memo} onChange={(e) => setForm({ ...form, memo: e.target.value })}
              placeholder="추가 메모" rows={2}
              className="w-full px-4 py-3 border border-gray-200 rounded-xl text-base focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" />
          </div>
        </div>
        <div className="flex gap-3 mt-5">
          <button onClick={handleSave} disabled={saving || !form.product_name.trim()}
            className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white rounded-xl font-medium text-base transition-colors">
            {saving ? '저장 중...' : editId ? '수정 완료' : '등록 완료'}
          </button>
          <button onClick={() => { setView('list'); setEditId(null); }}
            className="px-6 py-2.5 bg-white border border-gray-200 text-gray-600 rounded-xl font-medium text-base hover:bg-gray-50">
            취소
          </button>
        </div>
      </div>
    </div>
  );
}
