'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { supabaseFetch, supabaseFetchAll } from '@/lib/supabase';
import { getUser } from '@/lib/auth';
import { matchProduct, loadDbMatches } from '@/lib/orderConvert';

interface MatchRow { id: string; collect_name: string; product_name: string; created_by?: string; created_at?: string; updated_at?: string }
interface LogRow { id: string; action: string; collect_name: string; before_product?: string; after_product?: string; changed_by?: string; created_at: string }

const ACTION_LABEL: Record<string, string> = { create: '생성', update: '수정', delete: '삭제' };

export default function MatchesContent() {
  const me = getUser();
  // 사용(조회·추가·수정): 대표·실장·영업·재고담당 (세트 구성 관리와 동일 범위)
  const canEdit = ['ceo', 'admin', 'sales', 'inventory'].includes(me?.role || '');
  // 삭제(매칭·로그): 대표·실장만
  const canDelete = ['ceo', 'admin'].includes(me?.role || '');

  const [rows, setRows] = useState<MatchRow[]>([]);
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [repNames, setRepNames] = useState<string[]>([]); // 재고 대표상품명 후보
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  const [editId, setEditId] = useState<string | null>(null); // null=폼 닫힘, ''=신규
  const [formCollect, setFormCollect] = useState('');
  const [formProduct, setFormProduct] = useState('');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [mr, lg, inv] = await Promise.all([
        supabaseFetchAll<MatchRow>('/product_matches?select=id,collect_name,product_name,created_by,created_at,updated_at&order=updated_at.desc').catch(() => []),
        supabaseFetchAll<LogRow>('/product_match_logs?select=id,action,collect_name,before_product,after_product,changed_by,created_at&order=created_at.desc&limit=200').catch(() => []),
        supabaseFetchAll<{ product_name: string }>('/inventory?select=product_name&order=product_name.asc').catch(() => []),
      ]);
      setRows(Array.isArray(mr) ? mr : []);
      setLogs(Array.isArray(lg) ? lg : []);
      setRepNames(Array.from(new Set((inv || []).map(i => i.product_name).filter(Boolean))).sort());
      await loadDbMatches(true); // 런타임 매칭 갱신(다른 화면에도 즉시 반영)
    } catch { setRows([]); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  function startNew() { setEditId(''); setFormCollect(''); setFormProduct(''); setMsg(''); }
  function startEdit(r: MatchRow) { setEditId(r.id); setFormCollect(r.collect_name); setFormProduct(r.product_name); setMsg(''); }
  function cancel() { setEditId(null); setMsg(''); }

  async function logChange(action: string, collect: string, before: string | null, after: string | null) {
    try {
      await supabaseFetch('/product_match_logs', {
        method: 'POST', headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ action, collect_name: collect, before_product: before, after_product: after, changed_by: me?.name || '' }),
      });
    } catch { /* 로그 실패는 본 작업에 영향 주지 않음 */ }
  }

  // 미리보기: 입력한 수집상품명이 현재 어떻게 매칭되는지(하드코딩 기준). 신규 매칭 판단 도움.
  const preview = useMemo(() => {
    const c = formCollect.trim();
    if (!c) return null;
    return matchProduct(c);
  }, [formCollect]);

  async function save() {
    const collect = formCollect.trim();
    const product = formProduct.trim();
    if (!collect) { setMsg('수집상품명을 입력하세요.'); return; }
    if (!product) { setMsg('대표상품명을 입력하세요.'); return; }
    const isEdit = !!editId;
    const before = isEdit ? (rows.find(r => r.id === editId)?.product_name || null) : null;
    const beforeCollect = isEdit ? (rows.find(r => r.id === editId)?.collect_name || '') : '';
    setSaving(true);
    try {
      // 수집상품명 유니크 — upsert(on_conflict). 이름을 바꾼 경우 기존 행 정리.
      if (isEdit && beforeCollect && beforeCollect !== collect) {
        await supabaseFetch(`/product_matches?collect_name=eq.${encodeURIComponent(beforeCollect)}`, { method: 'DELETE' });
      }
      const res = await supabaseFetch('/product_matches?on_conflict=collect_name', {
        method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify({ collect_name: collect, product_name: product, created_by: me?.name || '', updated_at: new Date().toISOString() }),
      });
      if (!res.ok) { setMsg(`저장 실패 (${res.status})`); return; }
      await logChange(isEdit ? 'update' : 'create', collect, before, product);
      setEditId(null);
      await load();
    } catch { setMsg('저장 중 오류가 발생했습니다.'); }
    finally { setSaving(false); }
  }

  async function del(r: MatchRow) {
    if (!canEdit) return;
    if (!confirm(`"${r.collect_name}" → "${r.product_name}" 매칭을 삭제할까요?`)) return;
    await supabaseFetch(`/product_matches?id=eq.${r.id}`, { method: 'DELETE' });
    await logChange('delete', r.collect_name, r.product_name, null);
    await load();
  }

  async function delLog(id: string) {
    if (!canDelete) return;
    if (!confirm('이 로그를 삭제할까요? (대표·실장만 가능)')) return;
    await supabaseFetch(`/product_match_logs?id=eq.${id}`, { method: 'DELETE' });
    setLogs(prev => prev.filter(l => l.id !== id));
  }

  const filtered = rows.filter(r =>
    !search || r.collect_name.includes(search) || r.product_name.includes(search),
  );

  if (!canEdit) {
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-2xl px-5 py-8 text-center">
        <div className="text-lg font-semibold text-amber-700">🔒 접근 권한이 없습니다</div>
        <div className="text-sm text-amber-600 mt-1">상품 매칭 관리는 대표·실장·재고/영업 담당자만 이용할 수 있습니다.</div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-gray-800">상품 매칭 관리</h1>
          <p className="text-sm text-gray-400 mt-1">신규 상품이 들어오면 여기서 <b>수집상품명 → 대표상품명</b> 매칭을 직접 추가하세요. 저장 후 주문 변환 화면을 새로고침하면 즉시 반영되고 미매칭 알림이 사라집니다.</p>
        </div>
        {editId === null && (
          <button onClick={startNew} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-base font-medium">+ 매칭 추가</button>
        )}
      </div>

      {/* 추가/수정 폼 */}
      {editId !== null && (
        <div className="bg-white rounded-2xl border border-blue-200 shadow-sm p-5 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-600 mb-1">수집상품명 (몰에서 수집된 원문) *</label>
            <input value={formCollect} onChange={e => setFormCollect(e.target.value)}
              placeholder="예: [마이메이트] 스페인산 유기농 프리미엄 엑스트라버진 올리브오일 (10ml) 개별포장 스틱형, 140ml, 3개"
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-base focus:outline-none focus:ring-2 focus:ring-blue-400" />
            <p className="text-xs text-gray-400 mt-1">주문 파일의 ‘★수집상품명’ 값을 그대로 붙여넣으세요. (수량 표기 포함/미포함 모두 인식)</p>
            {preview && (
              <p className={`text-xs mt-1 ${preview.matched ? 'text-green-600' : 'text-amber-600'}`}>
                {preview.matched ? `이미 매칭됨 → "${preview.name}" (수정하려면 대표명을 바꿔 저장)` : '아직 매칭 없음 — 아래 대표명을 지정하세요'}
              </p>
            )}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-600 mb-1">대표상품명 (재고/매출 매칭 기준) *</label>
            <input list="rep-names" value={formProduct} onChange={e => setFormProduct(e.target.value)}
              placeholder="예: 마이메이트 유기농 엑스트라버진 올리브오일"
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-base focus:outline-none focus:ring-2 focus:ring-blue-400" />
            <datalist id="rep-names">{repNames.map(n => <option key={n} value={n} />)}</datalist>
            <p className="text-xs text-gray-400 mt-1">⚠️ 재고(상품마스터)에 등록된 상품명과 <b>정확히 동일</b>해야 재고가 자동 차감됩니다.</p>
            {formProduct.trim() && !repNames.includes(formProduct.trim()) && (
              <p className="text-xs text-amber-600 mt-1">⚠️ 재고에 없는 대표명입니다 — 재고 관리에 먼저 등록해야 차감됩니다.</p>
            )}
          </div>
          {msg && <div className="text-sm text-red-500">{msg}</div>}
          <div className="flex gap-2">
            <button onClick={save} disabled={saving} className="px-5 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white rounded-xl text-base font-medium">{saving ? '저장 중...' : '저장'}</button>
            <button onClick={cancel} className="px-5 py-2 border border-gray-200 text-gray-600 rounded-xl text-base hover:bg-gray-50">취소</button>
          </div>
        </div>
      )}

      {/* 검색 */}
      <input value={search} onChange={e => setSearch(e.target.value)}
        placeholder="수집상품명·대표상품명 검색"
        className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-base focus:outline-none focus:ring-2 focus:ring-blue-400" />

      {/* 매칭 목록 */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100 text-sm text-gray-500">
          담당자 등록 매칭 <b className="text-gray-700">{rows.length}</b>건 <span className="text-gray-400">· 검증된 기본 매칭 820건은 별도로 항상 적용됩니다</span>
        </div>
        {loading ? (
          <div className="text-center py-12 text-gray-400">불러오는 중...</div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-12 text-gray-400">{rows.length === 0 ? "등록된 매칭이 없습니다 — '+ 매칭 추가'로 등록하세요" : '검색 결과가 없습니다'}</div>
        ) : (
          <div className="divide-y divide-gray-100 max-h-[32rem] overflow-y-auto">
            {filtered.map(r => (
              <div key={r.id} className="px-5 py-3 flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="text-sm text-gray-500 break-words">{r.collect_name}</div>
                  <div className="text-base font-semibold text-gray-800 mt-0.5">
                    → {r.product_name}
                    {!repNames.includes(r.product_name) && <span className="text-amber-500 text-xs ml-1.5">⚠️재고없음</span>}
                  </div>
                  <div className="text-xs text-gray-400 mt-0.5">{r.created_by || '-'} · {(r.updated_at || r.created_at || '').slice(0, 16).replace('T', ' ')}</div>
                </div>
                <div className="flex gap-2 flex-shrink-0">
                  <button onClick={() => startEdit(r)} className="text-sm text-blue-500 hover:underline">수정</button>
                  <button onClick={() => del(r)} className="text-sm text-red-400 hover:underline">삭제</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 변경 로그 */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
          <h2 className="font-semibold text-gray-700">변경 이력</h2>
          <span className="text-xs text-gray-400">누가·언제·무엇을 바꿨는지 기록{canDelete ? ' · 삭제는 대표·실장만' : ''}</span>
        </div>
        {logs.length === 0 ? (
          <div className="text-center py-8 text-gray-400 text-sm">변경 이력이 없습니다</div>
        ) : (
          <div className="divide-y divide-gray-50 max-h-96 overflow-y-auto">
            {logs.map(l => (
              <div key={l.id} className="px-5 py-3 flex items-start gap-3">
                <span className={`text-xs px-2 py-0.5 rounded-md font-medium flex-shrink-0 ${l.action === 'delete' ? 'bg-red-50 text-red-600' : l.action === 'update' ? 'bg-amber-50 text-amber-600' : 'bg-green-50 text-green-600'}`}>{ACTION_LABEL[l.action] || l.action}</span>
                <div className="min-w-0 flex-1">
                  <div className="text-sm text-gray-500 break-words">{l.collect_name}</div>
                  <div className="text-sm text-gray-700 mt-0.5">
                    {l.before_product && l.after_product ? `${l.before_product} → ${l.after_product}` : l.after_product ? `→ ${l.after_product}` : l.before_product ? `(삭제) ${l.before_product}` : ''}
                  </div>
                  <div className="text-xs text-gray-400 mt-0.5">{l.changed_by || '-'} · {l.created_at?.slice(0, 16).replace('T', ' ')}</div>
                </div>
                {canDelete && (
                  <button onClick={() => delLog(l.id)} className="text-xs text-gray-300 hover:text-red-500 flex-shrink-0">삭제</button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
