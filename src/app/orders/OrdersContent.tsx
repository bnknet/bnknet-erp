'use client';

import { useState, useRef } from 'react';
import { convertOrders, buildSupabaseRows, matchProduct, type ConvertedOrderRow, type RawOrderRow } from '@/lib/orderConvert';
import { supabaseFetch, supabaseFetchAll, supabaseUpload, safeStorageKey } from '@/lib/supabase';
import { getUser } from '@/lib/auth';

type Tab = 'convert' | 'history' | 'manage';
type Status = { type: 'info' | 'success' | 'error'; msg: string } | null;

// 사업자 선택 (값은 재고 테이블의 company 표기와 정확히 일치해야 함)
const COMPANY_OPTIONS = [
  { value: 'BNKNET', label: '비앤케이넷 (BNKNET)' },
  { value: '더블아이', label: '더블아이' },
  { value: 'SJ글로벌', label: 'SJ글로벌' },
  { value: 'IX글로벌', label: 'IX글로벌' },
];

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
}

interface UploadHistory {
  id: string;
  uploaded_at: string;
  uploader?: string;
  file_name?: string;
  file_url?: string;
  row_count?: number;
  saved_count?: number;
}

export default function OrdersContent() {
  const me = getUser();
  const canDelete = me?.role === 'ceo' || me?.role === 'admin';

  const [tab, setTab] = useState<Tab>('convert');
  const [status, setStatus] = useState<Status>(null);
  const [resultData, setResultData] = useState<ConvertedOrderRow[]>([]);
  const [headerOrder, setHeaderOrder] = useState<string[]>([]);
  const [fileName, setFileName] = useState('');
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [history, setHistory] = useState<UploadHistory[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 사업자 선택 + 재고 자동출고 경고
  const [company, setCompany] = useState('');
  const [saving, setSaving] = useState(false);
  const [shipWarn, setShipWarn] = useState<ShipWarn | null>(null);

  // 주문 조회/취소
  const [sOrderNo, setSOrderNo] = useState('');
  const [sProduct, setSProduct] = useState('');
  const [sMall, setSMall] = useState('');
  const [orderList, setOrderList] = useState<OrderRow[]>([]);
  const [orderChecked, setOrderChecked] = useState<Set<string>>(new Set());
  const [orderLoading, setOrderLoading] = useState(false);

  async function searchOrders() {
    setOrderLoading(true);
    setOrderChecked(new Set());
    try {
      let q = '/orders?select=id,upload_date,order_number,recipient_name,mall_name,product_name,quantity,amount,tracking_number,canceled&order=upload_date.desc&limit=300';
      if (sOrderNo.trim()) q += `&order_number=ilike.*${encodeURIComponent(sOrderNo.trim())}*`;
      if (sProduct.trim()) q += `&product_name=ilike.*${encodeURIComponent(sProduct.trim())}*`;
      if (sMall.trim()) q += `&mall_name=ilike.*${encodeURIComponent(sMall.trim())}*`;
      const res = await supabaseFetch(q);
      const data = await res.json();
      setOrderList(Array.isArray(data) ? data : []);
    } catch { setOrderList([]); }
    finally { setOrderLoading(false); }
  }

  async function cancelSelectedOrders() {
    if (orderChecked.size === 0) { alert('취소할 주문을 선택하세요.'); return; }
    if (!confirm(`선택한 ${orderChecked.size}건을 취소 처리하시겠습니까?\n(매출·영업이익에서 제외 + 차감했던 재고는 자동 복구됩니다)`)) return;
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
      alert(`✅ ${r?.uncanceled ?? ids.length}건 취소 해제 완료 (재고 재차감 ${r?.rededucted ?? 0}건)`);
    } catch {
      alert('❌ 취소 해제 중 오류가 발생했습니다. (변경이 모두 취소되었습니다)');
    }
    await searchOrders();
  }

  async function deleteSelectedOrders() {
    if (orderChecked.size === 0) { alert('삭제할 주문을 선택하세요.'); return; }
    if (!confirm(`선택한 ${orderChecked.size}건을 완전히 삭제하시겠습니까? (복구 불가)`)) return;
    const ids = Array.from(orderChecked);
    await supabaseFetch(`/orders?id=in.(${ids.join(',')})`, { method: 'DELETE' });
    await searchOrders();
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

      const converted = convertOrders(raw);
      setResultData(converted);
      const bundleCount = converted.filter((r) => r._is_bundle).length;
      const productCount = new Set(converted.map((r) => r['상품명']).filter(Boolean)).size;
      setStatus({
        type: 'success',
        msg: `✅ 변환 완료 — 총 ${converted.length}건 / 합구매 ${bundleCount}건 / 상품 ${productCount}종`,
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
      await supabaseFetch('/order_uploads', {
        method: 'POST', headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({
          uploader: me?.name || '', file_name: fileName || uploadedFile?.name || '',
          file_url: fileUrl || null, row_count: rows.length, saved_count: newRows.length,
        }),
      });

      // ── 재고 자동출고 ────────────────────────────────────────
      // 상품명(대표명) + 사업자로 재고 매칭 → 못 찾으면 경고(자동출고 안 함, 안전장치)
      let warn: ShipWarn = { unmatched: [], negative: [], shipped: 0 };
      try {
        const inv = await supabaseFetchAll<{ id: string; product_name: string; company: string; quantity: number }>(
          '/inventory?select=id,product_name,company,quantity',
        );
        const invMap = new Map<string, string>(); // `${상품명}|${사업자}` → inventory_id
        for (const it of inv) {
          if (!it.product_name) continue;
          const key = `${it.product_name}|${it.company || ''}`;
          if (!invMap.has(key)) invMap.set(key, it.id);
        }

        const moves: Record<string, string | number>[] = [];
        const missMap = new Map<string, { cnt: number; qty: number }>();
        for (const o of saved) {
          const rep = matchProduct(o.collect_product || o.product_name || '').name;
          const qty = Number(o.quantity) || 0;
          const invId = invMap.get(`${rep}|${company}`);
          if (invId) {
            moves.push({ order_id: o.id, inventory_id: invId, quantity: qty, product_name: rep, company, created_by: me?.name || '' });
          } else {
            const m = missMap.get(rep) || { cnt: 0, qty: 0 };
            m.cnt++; m.qty += qty; missMap.set(rep, m);
          }
        }

        if (moves.length) {
          const shipRes = await supabaseFetch('/rpc/ship_orders', {
            method: 'POST', headers: { Prefer: 'return=representation' },
            body: JSON.stringify({ p_moves: moves }),
          });
          if (!shipRes.ok) throw new Error('ship ' + shipRes.status);
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

  async function deleteUpload(id: string) {
    if (!confirm('이 업로드 이력을 삭제하시겠습니까? (저장된 주문 데이터는 유지됩니다)')) return;
    await supabaseFetch(`/order_uploads?id=eq.${id}`, { method: 'DELETE' });
    await loadHistory();
  }

  function handleTabChange(t: Tab) {
    setTab(t);
    if (t === 'history') loadHistory();
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
      </div>

      {/* 파일 변환 탭 */}
      {tab === 'convert' && (
        <div className="space-y-4">
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
                      <a href="/inventory" className="underline ml-1">재고 관리</a>에서 등록·이름 확인 후 수동 출고하세요. 해결 후 실장님께 보고.
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
                    {resultData.slice(0, 50).map((row, i) => (
                      <tr key={i} className="border-b border-gray-50 hover:bg-gray-50">
                        <td className="py-2 px-3 whitespace-nowrap">
                          <span className="bg-blue-100 text-blue-700 text-sm px-2 py-0.5 rounded-md">
                            {String(row['몰명'] || '-')}
                          </span>
                        </td>
                        <td className="py-2 px-3 text-gray-700">{row['상품명']}</td>
                        <td className="py-2 px-3 text-center text-gray-600">{row['수량(주문수량*EA)']}</td>
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
                    ))}
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
                          ) : <span className="text-gray-400">{h.file_name || '-'}</span>}
                        </td>
                        <td className="py-2.5 px-3 text-center text-gray-500 text-sm">{h.saved_count}건 저장 / {h.row_count}건</td>
                        {canDelete && (
                          <td className="py-2.5 px-3 text-right">
                            <button onClick={() => deleteUpload(h.id)} className="text-sm text-gray-400 hover:text-red-500">삭제</button>
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
                      ) : <span className="text-sm text-gray-400">{h.file_name || '-'}</span>}
                    </div>
                    <div className="flex items-center justify-between mt-1">
                      <span className="text-xs text-gray-500">{h.saved_count}건 저장 / {h.row_count}건</span>
                      {canDelete && <button onClick={() => deleteUpload(h.id)} className="text-xs text-red-500">삭제</button>}
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
            <h2 className="text-lg font-bold text-gray-800 mb-1">주문 조회 · 취소</h2>
            <p className="text-base text-gray-400 mb-4">고객 취소 등으로 주문을 취소/삭제합니다. 취소된 주문은 매출·영업이익 집계에서 제외됩니다.</p>
            <div className="flex gap-2 flex-wrap">
              <input value={sOrderNo} onChange={e => setSOrderNo(e.target.value)} onKeyDown={e => e.key === 'Enter' && searchOrders()}
                placeholder="주문번호" className="px-3 py-2 border border-gray-200 rounded-lg text-base focus:outline-none focus:ring-2 focus:ring-blue-400 w-40" />
              <input value={sProduct} onChange={e => setSProduct(e.target.value)} onKeyDown={e => e.key === 'Enter' && searchOrders()}
                placeholder="상품명" className="px-3 py-2 border border-gray-200 rounded-lg text-base focus:outline-none focus:ring-2 focus:ring-blue-400 flex-1 min-w-[140px]" />
              <input value={sMall} onChange={e => setSMall(e.target.value)} onKeyDown={e => e.key === 'Enter' && searchOrders()}
                placeholder="몰명" className="px-3 py-2 border border-gray-200 rounded-lg text-base focus:outline-none focus:ring-2 focus:ring-blue-400 w-32" />
              <button onClick={searchOrders} className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-base font-medium">검색</button>
            </div>
          </div>

          {orderChecked.size > 0 && (
            <div className="flex items-center gap-2 bg-slate-700 text-white rounded-xl px-4 py-3 flex-wrap">
              <span className="text-base font-medium">{orderChecked.size}건 선택</span>
              <div className="flex gap-2 ml-auto flex-wrap">
                <button onClick={cancelSelectedOrders} className="px-3 py-1.5 bg-orange-500 hover:bg-orange-400 rounded-lg text-sm font-medium">취소 처리</button>
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
                      {['주문번호', '몰명', '상품명', '수량', '금액', '수취인', '상태'].map(h => (
                        <th key={h} className="px-3 py-3 text-left text-sm font-medium text-gray-500 whitespace-nowrap">{h}</th>
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
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          <p className="text-xs text-gray-400">💡 취소 처리 시 차감했던 재고가 자동으로 복구되고, 취소 해제 시 다시 차감됩니다(이력에 기록). 매출·영업이익에서도 자동 제외/포함됩니다.</p>
        </div>
      )}

    </div>
  );
}
