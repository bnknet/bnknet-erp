'use client';

import { useState, useEffect, useCallback } from 'react';
import { supabaseFetch, supabaseFetchAll } from '@/lib/supabase';
import { getUser } from '@/lib/auth';

// 발주서(결재문서). 작성·결재는 '결재' 메뉴에서 하고, 여기서는 현황 조회 + 입고 처리만 한다.
interface Po {
  id: string;
  company: string;
  purchase_vendor?: string;
  issue_date: string;
  organizer?: string;
  status: string; // pending/approved/rejected/canceled
  total_amount?: number;
}
interface PoItem {
  id: string;
  approval_id: string;
  description: string;
  quantity?: number;
  unit_price?: number;
  amount?: number;
  sort_order?: number;
}
interface Receipt {
  id: string;
  approval_id: string;
  approval_item_id?: string;
  inventory_id?: string;
  inventory_log_id?: string;
  product_name?: string;
  received_date: string;
  received_qty: number;
  memo?: string;
  created_by?: string;
  created_at: string;
}
interface Inv {
  id: string;
  product_name: string;
  company: string;
  quantity: number;
}

const COMPANIES = ['전체', '더블아이', 'BNKNET', 'SJ글로벌', 'IX글로벌'];
const STATUSES = ['전체', '결재중', '입고대기', '부분입고', '입고완료'];

// KST 오늘 (AGENTS.md 규칙)
function todayKST() {
  return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

type RecForm = { itemId: string; date: string; qty: string; inventoryId: string; memo: string };

export default function PurchasingContent() {
  const me = getUser();
  const canDelete = me?.role === 'ceo' || me?.role === 'admin';

  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'list' | 'history'>('list');
  const [pos, setPos] = useState<Po[]>([]);
  const [items, setItems] = useState<PoItem[]>([]);
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [inventory, setInventory] = useState<Inv[]>([]);

  const [company, setCompany] = useState('전체');
  const [statusFilter, setStatusFilter] = useState('전체');
  const [vendorSearch, setVendorSearch] = useState('');

  const [openId, setOpenId] = useState<string | null>(null);
  const [recForm, setRecForm] = useState<RecForm | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const poRows = await supabaseFetchAll<Po>(
        '/approvals?doc_type=eq.발주서&select=id,company,purchase_vendor,issue_date,organizer,status,total_amount&order=issue_date.desc',
      );
      setPos(poRows);
      const ids = poRows.map((p) => p.id);
      if (ids.length > 0) {
        const inList = `(${ids.join(',')})`;
        const [itemRows, recRows] = await Promise.all([
          supabaseFetchAll<PoItem>(
            `/approval_items?approval_id=in.${inList}&select=id,approval_id,description,quantity,unit_price,amount,sort_order&order=sort_order.asc`,
          ),
          supabaseFetchAll<Receipt>(
            `/purchase_receipts?approval_id=in.${inList}&select=*&order=received_date.desc`,
          ),
        ]);
        setItems(itemRows);
        setReceipts(recRows);
      } else {
        setItems([]);
        setReceipts([]);
      }
      const invRows = await supabaseFetchAll<Inv>(
        '/inventory?select=id,product_name,company,quantity&order=product_name.asc',
      );
      setInventory(invRows);
    } catch (e) {
      alert('데이터를 불러오지 못했습니다. ' + (e instanceof Error ? e.message : ''));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // 발주별 집계
  function orderedQty(poId: string) {
    return items.filter((i) => i.approval_id === poId).reduce((s, i) => s + (Number(i.quantity) || 0), 0);
  }
  function receivedQty(poId: string) {
    return receipts.filter((r) => r.approval_id === poId).reduce((s, r) => s + (Number(r.received_qty) || 0), 0);
  }
  function itemReceived(itemId: string) {
    return receipts.filter((r) => r.approval_item_id === itemId).reduce((s, r) => s + (Number(r.received_qty) || 0), 0);
  }

  function statusLabel(po: Po): { label: string; cls: string } {
    if (po.status === 'rejected') return { label: '반려', cls: 'text-red-600 bg-red-50' };
    if (po.status === 'canceled') return { label: '취소', cls: 'text-gray-500 bg-gray-100' };
    if (po.status !== 'approved') return { label: '결재중', cls: 'text-amber-600 bg-amber-50' };
    const ord = orderedQty(po.id);
    const rec = receivedQty(po.id);
    if (rec <= 0) return { label: '입고대기', cls: 'text-blue-600 bg-blue-50' };
    if (rec < ord) return { label: '부분입고', cls: 'text-indigo-600 bg-indigo-50' };
    return { label: '입고완료', cls: 'text-emerald-600 bg-emerald-50' };
  }

  const filtered = pos.filter((p) => {
    if (company !== '전체' && p.company !== company) return false;
    if (statusFilter !== '전체' && statusLabel(p).label !== statusFilter) return false;
    if (vendorSearch && !(p.purchase_vendor || '').toLowerCase().includes(vendorSearch.toLowerCase())) return false;
    return true;
  });

  // 재고 품목명 자동 매칭 (발주 품목명 → 재고)
  function matchInv(desc: string, comp: string): string {
    if (!desc) return '';
    const pool = inventory.filter((i) => i.company === comp);
    const exact = pool.find((i) => i.product_name === desc);
    if (exact) return exact.id;
    const partial = pool.find((i) => desc.includes(i.product_name) || i.product_name.includes(desc));
    return partial ? partial.id : '';
  }

  function openReceiptForm(po: Po, item: PoItem) {
    const remain = (Number(item.quantity) || 0) - itemReceived(item.id);
    setRecForm({
      itemId: item.id,
      date: todayKST(),
      qty: remain > 0 ? String(remain) : '',
      inventoryId: matchInv(item.description, po.company),
      memo: '',
    });
  }

  async function submitReceipt(po: Po, item: PoItem) {
    if (!recForm) return;
    const qty = Number(recForm.qty);
    if (!qty || qty <= 0) {
      alert('입고 수량을 입력하세요.');
      return;
    }
    if (!recForm.date) {
      alert('입고일을 입력하세요.');
      return;
    }
    setSaving(true);
    try {
      const inv = inventory.find((i) => i.id === recForm.inventoryId);
      let logId: string | null = null;

      // 재고 연결된 경우: 재고수량 증가 + 입출고 내역(입고) 자동 기록
      if (inv) {
        const before = inv.quantity;
        const after = before + qty;
        const patchRes = await supabaseFetch(`/inventory?id=eq.${inv.id}`, {
          method: 'PATCH',
          headers: { Prefer: 'return=representation' },
          body: JSON.stringify({ quantity: after, updated_at: new Date().toISOString() }),
        });
        const patched = await patchRes.json().catch(() => null);
        if (!patchRes.ok || !Array.isArray(patched) || patched.length === 0) {
          alert(`재고 수량 반영에 실패했습니다 (HTTP ${patchRes.status}). 입고가 기록되지 않았습니다.`);
          setSaving(false);
          return;
        }
        const finalQty = Number(patched[0]?.quantity ?? after);
        const logRes = await supabaseFetch('/inventory_logs', {
          method: 'POST',
          headers: { Prefer: 'return=representation' },
          body: JSON.stringify({
            inventory_id: inv.id,
            product_name: inv.product_name,
            type: '입고',
            quantity: qty,
            before_qty: before,
            after_qty: finalQty,
            reason: `발주입고: ${po.purchase_vendor || ''}`,
            created_by: me?.name || '',
          }),
        });
        const logRows = await logRes.json().catch(() => null);
        logId = Array.isArray(logRows) && logRows[0]?.id ? logRows[0].id : null;
      }

      // 입고 기록 저장
      const recRes = await supabaseFetch('/purchase_receipts', {
        method: 'POST',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({
          approval_id: po.id,
          approval_item_id: item.id,
          inventory_id: inv?.id || null,
          inventory_log_id: logId,
          product_name: inv?.product_name || item.description || '',
          received_date: recForm.date,
          received_qty: qty,
          memo: recForm.memo || null,
          created_by: me?.name || '',
        }),
      });
      if (!recRes.ok) {
        alert('입고 기록 저장에 실패했습니다. 재고는 반영됐을 수 있으니 재고 메뉴를 확인하세요.');
        setSaving(false);
        return;
      }
      setRecForm(null);
      await load();
    } finally {
      setSaving(false);
    }
  }

  async function deleteReceipt(rec: Receipt) {
    if (!confirm('입고 기록을 삭제하시겠습니까?\n연결된 재고 입고분도 함께 되돌립니다.')) return;
    try {
      // 재고 연결분 원복 (현재고에서 입고수량 차감 후 입출고 로그 삭제)
      if (rec.inventory_id && rec.inventory_log_id) {
        const curRes = await supabaseFetch(`/inventory?id=eq.${rec.inventory_id}&select=quantity`);
        const cur = await curRes.json().catch(() => []);
        if (Array.isArray(cur) && cur[0]) {
          const newQty = Number(cur[0].quantity) - Number(rec.received_qty);
          await supabaseFetch(`/inventory?id=eq.${rec.inventory_id}`, {
            method: 'PATCH',
            body: JSON.stringify({ quantity: newQty, updated_at: new Date().toISOString() }),
          });
        }
        await supabaseFetch(`/inventory_logs?id=eq.${rec.inventory_log_id}`, { method: 'DELETE' });
      }
      const delRes = await supabaseFetch(`/purchase_receipts?id=eq.${rec.id}`, { method: 'DELETE' });
      if (!delRes.ok) {
        alert('입고 기록 삭제에 실패했습니다.');
        return;
      }
      await load();
    } catch (e) {
      alert('삭제 중 오류가 발생했습니다. ' + (e instanceof Error ? e.message : ''));
    }
  }

  const won = (n?: number) => (Number(n) || 0).toLocaleString();

  // 입고 이력(전체) — 최근순
  const historyRows = [...receipts].sort((a, b) => (a.received_date < b.received_date ? 1 : -1));
  const poById = Object.fromEntries(pos.map((p) => [p.id, p]));

  // 요약
  const cntWaiting = pos.filter((p) => statusLabel(p).label === '입고대기').length;
  const cntPartial = pos.filter((p) => statusLabel(p).label === '부분입고').length;

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto">
      <div className="mb-4">
        <h1 className="text-xl font-bold text-gray-800">발주·입고</h1>
        <p className="text-sm text-gray-500 mt-1">
          발주서 작성·결재는 <b>결재</b> 메뉴에서. 여기서는 발주 현황을 보고, 도착한 물량을 입고 처리합니다.
        </p>
      </div>

      {/* 탭 */}
      <div className="flex gap-2 mb-4">
        {(['list', 'history'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 rounded-lg text-base font-medium ${
              tab === t ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {t === 'list' ? '발주 현황' : '입고 이력'}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="text-center py-16 text-gray-400">불러오는 중…</div>
      ) : tab === 'list' ? (
        <>
          {/* 요약 */}
          <div className="flex flex-wrap gap-3 mb-4">
            <div className="px-4 py-2 bg-white border rounded-xl">
              <span className="text-sm text-gray-400">전체 발주</span>{' '}
              <b className="text-gray-800">{pos.length}</b>건
            </div>
            <div className="px-4 py-2 bg-blue-50 border border-blue-100 rounded-xl">
              <span className="text-sm text-blue-500">입고대기</span>{' '}
              <b className="text-blue-700">{cntWaiting}</b>건
            </div>
            <div className="px-4 py-2 bg-indigo-50 border border-indigo-100 rounded-xl">
              <span className="text-sm text-indigo-500">부분입고</span>{' '}
              <b className="text-indigo-700">{cntPartial}</b>건
            </div>
          </div>

          {/* 필터 */}
          <div className="flex flex-wrap gap-2 mb-4">
            <select value={company} onChange={(e) => setCompany(e.target.value)} className="px-3 py-2 border rounded-lg text-base">
              {COMPANIES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="px-3 py-2 border rounded-lg text-base">
              {STATUSES.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
            <input
              value={vendorSearch}
              onChange={(e) => setVendorSearch(e.target.value)}
              placeholder="거래처 검색"
              className="px-3 py-2 border rounded-lg text-base flex-1 min-w-[140px]"
            />
          </div>

          {filtered.length === 0 ? (
            <div className="text-center py-16 text-gray-400 bg-gray-50 rounded-xl">발주서가 없습니다.</div>
          ) : (
            <div className="space-y-2">
              {filtered.map((po) => {
                const st = statusLabel(po);
                const ord = orderedQty(po.id);
                const rec = receivedQty(po.id);
                const poItems = items.filter((i) => i.approval_id === po.id);
                const isOpen = openId === po.id;
                const canReceive = po.status === 'approved';
                return (
                  <div key={po.id} className="bg-white border rounded-xl overflow-hidden">
                    {/* 헤더 행 */}
                    <button
                      onClick={() => {
                        setOpenId(isOpen ? null : po.id);
                        setRecForm(null);
                      }}
                      className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-gray-50"
                    >
                      <span className={`px-2 py-0.5 rounded-full text-sm font-medium ${st.cls}`}>{st.label}</span>
                      <span className="font-semibold text-gray-800 flex-1 min-w-0 truncate">
                        {po.purchase_vendor || '(거래처 미지정)'}
                      </span>
                      <span className="text-sm text-gray-400 hidden sm:inline">{po.company}</span>
                      <span className="text-sm text-gray-500">{po.issue_date}</span>
                      <span className="text-sm text-gray-600 tabular-nums">
                        입고 {rec.toLocaleString()}/{ord.toLocaleString()}
                      </span>
                      <span className="text-gray-400">{isOpen ? '▲' : '▼'}</span>
                    </button>

                    {/* 상세 */}
                    {isOpen && (
                      <div className="border-t bg-gray-50/50 px-4 py-3">
                        {!canReceive && (
                          <div className="mb-3 text-sm text-amber-600 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
                            아직 결재 승인 전이라 입고 처리를 할 수 없습니다. (결재 승인 후 가능)
                          </div>
                        )}
                        <div className="space-y-2">
                          {poItems.length === 0 && <div className="text-sm text-gray-400">품목이 없습니다.</div>}
                          {poItems.map((item) => {
                            const iord = Number(item.quantity) || 0;
                            const irec = itemReceived(item.id);
                            const remain = iord - irec;
                            const formOpen = recForm?.itemId === item.id;
                            const itemRecs = receipts.filter((r) => r.approval_item_id === item.id);
                            return (
                              <div key={item.id} className="bg-white border rounded-lg px-3 py-2">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="font-medium text-gray-800 flex-1 min-w-0 truncate">{item.description}</span>
                                  <span className="text-sm text-gray-500 tabular-nums">
                                    발주 {iord.toLocaleString()} · 입고 {irec.toLocaleString()} ·{' '}
                                    <b className={remain > 0 ? 'text-indigo-600' : 'text-emerald-600'}>잔량 {remain.toLocaleString()}</b>
                                  </span>
                                  {canReceive && (
                                    <button
                                      onClick={() => (formOpen ? setRecForm(null) : openReceiptForm(po, item))}
                                      className="px-2.5 py-1 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700"
                                    >
                                      {formOpen ? '닫기' : '입고'}
                                    </button>
                                  )}
                                </div>

                                {/* 입고 이력 (품목별) */}
                                {itemRecs.length > 0 && (
                                  <div className="mt-1.5 space-y-0.5">
                                    {itemRecs.map((r) => (
                                      <div key={r.id} className="flex items-center gap-2 text-sm text-gray-500">
                                        <span>· {r.received_date}</span>
                                        <span className="tabular-nums">+{Number(r.received_qty).toLocaleString()}</span>
                                        {r.inventory_id ? (
                                          <span className="text-emerald-600">재고반영</span>
                                        ) : (
                                          <span className="text-gray-400">재고 미연결</span>
                                        )}
                                        {r.memo && <span className="text-gray-400 truncate">· {r.memo}</span>}
                                        {canDelete && (
                                          <button onClick={() => deleteReceipt(r)} className="text-red-400 hover:text-red-600 ml-auto">
                                            삭제
                                          </button>
                                        )}
                                      </div>
                                    ))}
                                  </div>
                                )}

                                {/* 입고 등록 폼 */}
                                {formOpen && recForm && (
                                  <div className="mt-2 pt-2 border-t flex flex-wrap items-end gap-2">
                                    <label className="text-sm">
                                      <span className="block text-gray-400 mb-0.5">입고일</span>
                                      <input
                                        type="date"
                                        value={recForm.date}
                                        onChange={(e) => setRecForm({ ...recForm, date: e.target.value })}
                                        className="px-2 py-1 border rounded-lg text-base"
                                      />
                                    </label>
                                    <label className="text-sm">
                                      <span className="block text-gray-400 mb-0.5">입고수량</span>
                                      <input
                                        type="number"
                                        value={recForm.qty}
                                        onChange={(e) => setRecForm({ ...recForm, qty: e.target.value })}
                                        className="px-2 py-1 border rounded-lg text-base w-24"
                                      />
                                    </label>
                                    <label className="text-sm flex-1 min-w-[180px]">
                                      <span className="block text-gray-400 mb-0.5">재고 품목 연결</span>
                                      <select
                                        value={recForm.inventoryId}
                                        onChange={(e) => setRecForm({ ...recForm, inventoryId: e.target.value })}
                                        className="px-2 py-1 border rounded-lg text-base w-full"
                                      >
                                        <option value="">(재고 미연결 — 추적만)</option>
                                        {inventory
                                          .filter((i) => i.company === po.company)
                                          .map((i) => (
                                            <option key={i.id} value={i.id}>
                                              {i.product_name} (현재고 {i.quantity.toLocaleString()})
                                            </option>
                                          ))}
                                      </select>
                                    </label>
                                    <label className="text-sm flex-1 min-w-[120px]">
                                      <span className="block text-gray-400 mb-0.5">메모</span>
                                      <input
                                        value={recForm.memo}
                                        onChange={(e) => setRecForm({ ...recForm, memo: e.target.value })}
                                        className="px-2 py-1 border rounded-lg text-base w-full"
                                        placeholder="선택"
                                      />
                                    </label>
                                    <button
                                      onClick={() => submitReceipt(po, item)}
                                      disabled={saving}
                                      className="px-3 py-1.5 text-base text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 disabled:opacity-50"
                                    >
                                      {saving ? '저장 중…' : '입고 등록'}
                                    </button>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                        {po.total_amount ? (
                          <div className="mt-2 text-sm text-gray-400 text-right">발주 총액 {won(po.total_amount)}원</div>
                        ) : null}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </>
      ) : (
        /* 입고 이력 탭 */
        <div className="bg-white border rounded-xl overflow-x-auto">
          {historyRows.length === 0 ? (
            <div className="text-center py-16 text-gray-400">입고 이력이 없습니다.</div>
          ) : (
            <table className="w-full text-base">
              <thead>
                <tr className="border-b bg-gray-50 text-sm text-gray-500">
                  <th className="px-4 py-3 text-left">입고일</th>
                  <th className="px-4 py-3 text-left">거래처</th>
                  <th className="px-4 py-3 text-left">품목</th>
                  <th className="px-4 py-3 text-right">수량</th>
                  <th className="px-4 py-3 text-left">재고</th>
                  <th className="px-4 py-3 text-left">담당</th>
                  {canDelete && <th className="px-4 py-3" />}
                </tr>
              </thead>
              <tbody>
                {historyRows.map((r) => {
                  const po = poById[r.approval_id];
                  return (
                    <tr key={r.id} className="border-b last:border-0 hover:bg-gray-50">
                      <td className="px-4 py-2.5 whitespace-nowrap">{r.received_date}</td>
                      <td className="px-4 py-2.5">{po?.purchase_vendor || '-'}</td>
                      <td className="px-4 py-2.5">{r.product_name || '-'}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{Number(r.received_qty).toLocaleString()}</td>
                      <td className="px-4 py-2.5">
                        {r.inventory_id ? (
                          <span className="text-emerald-600 text-sm">반영됨</span>
                        ) : (
                          <span className="text-gray-400 text-sm">미연결</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-sm text-gray-500">{r.created_by || '-'}</td>
                      {canDelete && (
                        <td className="px-4 py-2.5 text-right">
                          <button onClick={() => deleteReceipt(r)} className="text-red-400 hover:text-red-600 text-sm">
                            삭제
                          </button>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
