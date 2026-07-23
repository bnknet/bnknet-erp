'use client';

import { useState, useEffect, useCallback } from 'react';
import { supabaseFetch, supabaseFetchAll } from '@/lib/supabase';
import { getUser } from '@/lib/auth';

interface BomRow { id: string; set_name: string; component_name: string; component_qty: number }
interface InvOpt { product_name: string; company: string; cost_price: number }
interface LogRow { id: string; action: string; set_name: string; detail?: string; changed_by?: string; created_at: string }
interface MatchRow { collect_name: string; collect_option?: string; product_name: string }

const won = (n: number) => `${Math.round(n).toLocaleString('ko-KR')}원`;
const compStr = (list: { component_name?: string; name?: string; component_qty?: number; qty?: number }[]) =>
  list.map(c => `${c.component_name ?? c.name}×${c.component_qty ?? c.qty}`).join(', ');

export default function SetsContent() {
  const me = getUser();
  // 사용(조회·편집): 대표·실장·영업(강웅구)·재고담당(박정진·최영훈)
  const canEdit = ['ceo', 'admin', 'sales', 'inventory'].includes(me?.role || '');
  // 로그 삭제: 대표·실장만
  const canManageLog = ['ceo', 'admin'].includes(me?.role || '');

  const [logs, setLogs] = useState<LogRow[]>([]);
  const [rows, setRows] = useState<BomRow[]>([]);
  const [invNames, setInvNames] = useState<string[]>([]);
  const [invCost, setInvCost] = useState<Map<string, number>>(new Map());
  const [loading, setLoading] = useState(true);

  const [editSet, setEditSet] = useState<string | null>(null); // null=폼 닫힘, ''=신규
  const [formName, setFormName] = useState('');
  const [comps, setComps] = useState<{ name: string; qty: number }[]>([{ name: '', qty: 1 }]);
  // 이 세트로 인식할 주문 매칭(수집상품명 + 수집옵션) — 저장 시 product_matches에 등록
  const [allMatches, setAllMatches] = useState<MatchRow[]>([]);
  const [matches, setMatches] = useState<{ collect: string; option: string }[]>([{ collect: '', option: '' }]);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [bom, inv, lg, mt] = await Promise.all([
        supabaseFetchAll<BomRow>('/product_bom?select=id,set_name,component_name,component_qty&order=set_name.asc'),
        supabaseFetchAll<InvOpt>('/inventory?select=product_name,company,cost_price&order=product_name.asc'),
        supabaseFetchAll<LogRow>('/bom_change_logs?select=id,action,set_name,detail,changed_by,created_at&order=created_at.desc&limit=200').catch(() => []),
        supabaseFetchAll<MatchRow>('/product_matches?select=collect_name,collect_option,product_name').catch(() => []),
      ]);
      setRows(Array.isArray(bom) ? bom : []);
      setLogs(Array.isArray(lg) ? lg : []);
      setAllMatches(Array.isArray(mt) ? mt : []);
      const names = Array.from(new Set((inv || []).map(i => i.product_name).filter(Boolean))).sort();
      setInvNames(names);
      const cm = new Map<string, number>(); // 상품명 → 최저원가(참고용, 실제는 사업자별)
      for (const i of inv || []) { if (!i.product_name) continue; const c = Number(i.cost_price) || 0; const p = cm.get(i.product_name); if (p === undefined || c < p) cm.set(i.product_name, c); }
      setInvCost(cm);
    } catch { setRows([]); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  // 세트명별 그룹
  const setNames = Array.from(new Set(rows.map(r => r.set_name))).sort();
  const compsOf = (name: string) => rows.filter(r => r.set_name === name);

  const matchesOf = (name: string) => allMatches.filter(m => m.product_name === name);
  function startNew() { setEditSet(''); setFormName(''); setComps([{ name: '', qty: 1 }]); setMatches([{ collect: '', option: '' }]); setMsg(''); }
  function startEdit(name: string) {
    setEditSet(name); setFormName(name);
    setComps(compsOf(name).map(r => ({ name: r.component_name, qty: Number(r.component_qty) || 1 })));
    const ms = matchesOf(name).map(m => ({ collect: m.collect_name, option: m.collect_option || '' }));
    setMatches(ms.length ? ms : [{ collect: '', option: '' }]);
    setMsg('');
  }
  function cancel() { setEditSet(null); setMsg(''); }
  function addComp() { setComps(c => [...c, { name: '', qty: 1 }]); }
  function removeComp(i: number) { setComps(c => c.length > 1 ? c.filter((_, idx) => idx !== i) : c); }
  function updateComp(i: number, patch: Partial<{ name: string; qty: number }>) {
    setComps(c => c.map((x, idx) => idx === i ? { ...x, ...patch } : x));
  }
  function addMatch() { setMatches(m => [...m, { collect: '', option: '' }]); }
  function removeMatch(i: number) { setMatches(m => m.length > 1 ? m.filter((_, idx) => idx !== i) : [{ collect: '', option: '' }]); }
  function updateMatch(i: number, patch: Partial<{ collect: string; option: string }>) {
    setMatches(m => m.map((x, idx) => idx === i ? { ...x, ...patch } : x));
  }

  const formCostPreview = comps.reduce((s, c) => s + (invCost.get(c.name) || 0) * (Number(c.qty) || 0), 0);
  const unknownComps = comps.filter(c => c.name && !invNames.includes(c.name)).map(c => c.name);

  async function logChange(action: string, setName: string, detail: string) {
    try {
      await supabaseFetch('/bom_change_logs', {
        method: 'POST', headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ action, set_name: setName, detail, changed_by: me?.name || '' }),
      });
    } catch { /* 로그 실패는 본 작업에 영향 주지 않음 */ }
  }

  async function save() {
    const name = formName.trim();
    if (!name) { setMsg('세트명을 입력하세요.'); return; }
    const valid = comps.filter(c => c.name.trim() && (Number(c.qty) || 0) > 0);
    if (!valid.length) { setMsg('구성품 1개 이상(수량 1 이상)을 입력하세요.'); return; }
    // 변경 로그 상세 (이전 → 이후)
    const isEdit = !!editSet;
    const oldComps = editSet ? compsOf(editSet) : [];
    const newStr = compStr(valid);
    // 이 세트로 인식할 주문 매칭(수집상품명 + 수집옵션 → 대표상품명=세트명)
    const validMatches = matches
      .map(m => ({ collect: m.collect.trim(), option: m.option.trim() }))
      .filter(m => m.collect);
    const matchStr = validMatches.map(m => `${m.collect}${m.option ? `(${m.option})` : ''}`).join(', ');
    const detail = isEdit
      ? `${editSet !== name ? `이름변경: "${editSet}" → "${name}" · ` : ''}이전: [${compStr(oldComps)}] → 이후: [${newStr}]${matchStr ? ` · 매칭: [${matchStr}]` : ''}`
      : `구성: [${newStr}]${matchStr ? ` · 매칭: [${matchStr}]` : ''}`;
    setSaving(true);
    try {
      // 기존 세트명 + 새 세트명 모두 정리 후 재삽입 (이름 변경 대응)
      await supabaseFetch(`/product_bom?set_name=eq.${encodeURIComponent(name)}`, { method: 'DELETE' });
      if (editSet && editSet !== name) await supabaseFetch(`/product_bom?set_name=eq.${encodeURIComponent(editSet)}`, { method: 'DELETE' });
      await supabaseFetch('/product_bom', {
        method: 'POST', headers: { Prefer: 'return=minimal' },
        body: JSON.stringify(valid.map(c => ({ set_name: name, component_name: c.name.trim(), component_qty: Number(c.qty) || 1 }))),
      });

      // 매칭 등록: 입력한 수집상품명+옵션을 이 세트(대표상품명)로 매핑(상품매칭에 반영)
      if (validMatches.length) {
        await supabaseFetch('/product_matches?on_conflict=collect_name,collect_option', {
          method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
          body: JSON.stringify(validMatches.map(m => ({
            collect_name: m.collect, collect_option: m.option, product_name: name,
            created_by: me?.name || '', updated_at: new Date().toISOString(),
          }))),
        });
      }
      // 이전에 이 세트(또는 이름변경 전)에 연결됐던 매칭 중 이번에 뺀 것은 삭제
      const orig = allMatches.filter(m => m.product_name === editSet || m.product_name === name);
      const keep = new Set(validMatches.map(m => `${m.collect}|${m.option}`));
      for (const o of orig) {
        const key = `${o.collect_name}|${o.collect_option || ''}`;
        if (!keep.has(key)) {
          await supabaseFetch(`/product_matches?collect_name=eq.${encodeURIComponent(o.collect_name)}&collect_option=eq.${encodeURIComponent(o.collect_option || '')}`, { method: 'DELETE' });
        }
      }

      await logChange(isEdit ? '수정' : '생성', name, detail);
      setEditSet(null);
      await load();
    } catch { setMsg('저장 중 오류가 발생했습니다.'); }
    finally { setSaving(false); }
  }

  async function del(name: string) {
    if (!confirm(`"${name}" 세트 구성을 삭제할까요?`)) return;
    const detail = `구성: [${compStr(compsOf(name))}]`;
    await supabaseFetch(`/product_bom?set_name=eq.${encodeURIComponent(name)}`, { method: 'DELETE' });
    await logChange('삭제', name, detail);
    await load();
  }

  async function delLog(id: string) {
    if (!canManageLog) return;
    if (!confirm('이 로그를 삭제할까요? (대표·실장만 가능)')) return;
    await supabaseFetch(`/bom_change_logs?id=eq.${id}`, { method: 'DELETE' });
    setLogs(prev => prev.filter(l => l.id !== id));
  }

  if (!canEdit) {
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-2xl px-5 py-8 text-center">
        <div className="text-lg font-semibold text-amber-700">🔒 접근 권한이 없습니다</div>
        <div className="text-sm text-amber-600 mt-1">세트 구성 관리는 대표·실장·재고/영업 담당자만 이용할 수 있습니다.</div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-gray-800">세트 구성 관리</h1>
          <p className="text-sm text-gray-400 mt-1">세트상품 1개 주문 시 구성품 재고가 각각 자동 차감됩니다 (주문수량 × 구성수량). 원가도 구성품 원가 합으로 자동 계산.</p>
        </div>
        {canEdit && editSet === null && (
          <button onClick={startNew} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-base font-medium">+ 세트 추가</button>
        )}
      </div>

      {/* 편집/추가 폼 */}
      {canEdit && editSet !== null && (
        <div className="bg-white rounded-2xl border border-blue-200 shadow-sm p-5 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-600 mb-1">세트 대표상품명 *</label>
            <input value={formName} onChange={e => setFormName(e.target.value)}
              placeholder="예: 픽프롬 슬로우에이징 리겐 올인원 본품1개+리필1개"
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-base focus:outline-none focus:ring-2 focus:ring-blue-400" />
            <p className="text-xs text-gray-400 mt-1">⚠️ 매칭데이터의 <b>대표상품명과 정확히 동일</b>하게 입력해야 주문이 이 세트로 인식됩니다.</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-600 mb-1">구성품 (재고 상품명 + 세트당 수량)</label>
            <div className="space-y-2">
              {comps.map((c, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input list="inv-names" value={c.name} onChange={e => updateComp(i, { name: e.target.value })}
                    placeholder="구성품(재고) 상품명"
                    className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-base focus:outline-none focus:ring-2 focus:ring-blue-400" />
                  <input type="number" min={1} value={c.qty || ''} onChange={e => updateComp(i, { qty: Number(e.target.value) || 0 })}
                    className="w-20 px-2 py-2 border border-gray-200 rounded-lg text-base text-right focus:outline-none focus:ring-2 focus:ring-blue-400" />
                  <span className="text-sm text-gray-400 w-6">개</span>
                  <button onClick={() => removeComp(i)} className="text-gray-300 hover:text-red-500 text-lg px-1">×</button>
                </div>
              ))}
            </div>
            <datalist id="inv-names">{invNames.map(n => <option key={n} value={n} />)}</datalist>
            <button onClick={addComp} className="mt-2 text-sm text-blue-600 hover:underline">+ 구성품 추가</button>
          </div>

          {/* 주문 매칭 등록 (수집상품명 + 수집옵션 → 이 세트) */}
          <div>
            <label className="block text-sm font-medium text-gray-600 mb-1">이 세트로 인식할 주문 <span className="text-gray-400 font-normal">(수집상품명 + 수집옵션 · 상품매칭에 자동 등록)</span></label>
            <div className="space-y-2">
              {matches.map((m, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input value={m.collect} onChange={e => updateMatch(i, { collect: e.target.value })}
                    placeholder="수집상품명 (주문에 찍히는 상품명)"
                    className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-base focus:outline-none focus:ring-2 focus:ring-blue-400" />
                  <input value={m.option} onChange={e => updateMatch(i, { option: e.target.value })}
                    placeholder="수집옵션 (예: 색상:흑색 · 비우면 옵션무관)"
                    className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-base focus:outline-none focus:ring-2 focus:ring-blue-400" />
                  <button onClick={() => removeMatch(i)} className="text-gray-300 hover:text-red-500 text-lg px-1">×</button>
                </div>
              ))}
            </div>
            <button onClick={addMatch} className="mt-2 text-sm text-blue-600 hover:underline">+ 매칭 추가</button>
            <p className="text-xs text-gray-400 mt-1">주문의 ‘수집상품명’이 여기와 같고 ‘★수집옵션’에 이 값이 <b>포함되면</b> 이 세트로 인식됩니다(가장 구체적인 것 우선). 색상만 다른 세트는 <b>색상:흑색 / 색상:자연갈색</b>을 각각 등록하세요. 비워두면 옵션과 무관하게 매칭. (선택 — 비워도 세트는 저장됩니다)</p>
          </div>

          {unknownComps.length > 0 && (
            <div className="text-sm text-amber-600 bg-amber-50 rounded-lg px-3 py-2">
              ⚠️ 재고에 없는 구성품: {unknownComps.join(', ')} — 재고(상품마스터)에 먼저 등록해야 차감됩니다.
            </div>
          )}
          <div className="text-sm text-gray-500">참고 원가(최저): <b>{won(formCostPreview)}</b> <span className="text-gray-400">· 실제 원가는 주문 사업자별 구성품 원가로 계산됩니다.</span></div>
          {msg && <div className="text-sm text-red-500">{msg}</div>}
          <div className="flex gap-2">
            <button onClick={save} disabled={saving} className="px-5 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white rounded-xl text-base font-medium">{saving ? '저장 중...' : '저장'}</button>
            <button onClick={cancel} className="px-5 py-2 border border-gray-200 text-gray-600 rounded-xl text-base hover:bg-gray-50">취소</button>
          </div>
        </div>
      )}

      {/* 세트 목록 */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        {loading ? (
          <div className="text-center py-12 text-gray-400">불러오는 중...</div>
        ) : setNames.length === 0 ? (
          <div className="text-center py-12 text-gray-400">등록된 세트가 없습니다{canEdit ? " — '+ 세트 추가'로 등록하세요" : ''}</div>
        ) : (
          <div className="divide-y divide-gray-100">
            {setNames.map(name => {
              const cs = compsOf(name);
              const cost = cs.reduce((s, r) => s + (invCost.get(r.component_name) || 0) * (Number(r.component_qty) || 0), 0);
              return (
                <div key={name} className="px-5 py-4 flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold text-gray-800">🎁 {name}</div>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {cs.map(r => (
                        <span key={r.id} className="text-sm bg-gray-100 text-gray-600 rounded-md px-2 py-0.5">
                          {r.component_name} <b className="text-gray-800">×{r.component_qty}</b>
                          {!invNames.includes(r.component_name) && <span className="text-amber-500 ml-1">⚠️재고없음</span>}
                        </span>
                      ))}
                    </div>
                    <div className="text-xs text-gray-400 mt-1.5">참고 원가(최저) {won(cost)}</div>
                    {matchesOf(name).length > 0 && (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {matchesOf(name).map((m, i) => (
                          <span key={i} className="text-xs bg-blue-50 text-blue-600 rounded px-1.5 py-0.5">↳ {m.collect_name}{m.collect_option ? ` · ${m.collect_option}` : ''}</span>
                        ))}
                      </div>
                    )}
                  </div>
                  {canEdit && (
                    <div className="flex gap-2 flex-shrink-0">
                      <button onClick={() => startEdit(name)} className="text-sm text-blue-500 hover:underline">수정</button>
                      <button onClick={() => del(name)} className="text-sm text-red-400 hover:underline">삭제</button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 변경 로그 */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
          <h2 className="font-semibold text-gray-700">변경 이력</h2>
          <span className="text-xs text-gray-400">누가·언제·무엇을·어떻게 바꿨는지 기록{canManageLog ? ' · 삭제는 대표·실장만' : ''}</span>
        </div>
        {logs.length === 0 ? (
          <div className="text-center py-8 text-gray-400 text-sm">변경 이력이 없습니다</div>
        ) : (
          <div className="divide-y divide-gray-50 max-h-96 overflow-y-auto">
            {logs.map(l => (
              <div key={l.id} className="px-5 py-3 flex items-start gap-3">
                <span className={`text-xs px-2 py-0.5 rounded-md font-medium flex-shrink-0 ${l.action === '삭제' ? 'bg-red-50 text-red-600' : l.action === '수정' ? 'bg-amber-50 text-amber-600' : 'bg-green-50 text-green-600'}`}>{l.action}</span>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-gray-800 truncate">{l.set_name}</div>
                  {l.detail && <div className="text-xs text-gray-500 mt-0.5 break-words">{l.detail}</div>}
                  <div className="text-xs text-gray-400 mt-0.5">{l.changed_by || '-'} · {l.created_at?.slice(0, 16).replace('T', ' ')}</div>
                </div>
                {canManageLog && (
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
