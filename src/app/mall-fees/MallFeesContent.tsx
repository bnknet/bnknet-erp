'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { supabaseFetch, supabaseFetchAll } from '@/lib/supabase';
import { getUser } from '@/lib/auth';
import { normalizeMall, CANONICAL_MALLS, KNOWN_COMPANIES } from '@/lib/mallFees';

interface FeeRow { id: string; company: string; mall: string; rate: number; updated_at?: string }
interface LogRow { id: string; action: string; company: string; mall: string; before_rate?: number | null; after_rate?: number | null; changed_by?: string; created_at: string }

const ACTION_LABEL: Record<string, string> = { create: '추가', update: '수정', delete: '삭제' };
const enc = encodeURIComponent;

export default function MallFeesContent() {
  const me = getUser();
  // 수수료는 매출·영업이익 계산에 직결 → 대표·실장·매출담당만 수정
  const canEdit = ['ceo', 'admin', 'sales'].includes(me?.role || '');
  const canDelete = ['ceo', 'admin'].includes(me?.role || '');

  const [rows, setRows] = useState<FeeRow[]>([]);
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  const [editId, setEditId] = useState<string | null>(null); // null=폼닫힘, ''=신규
  const [formCompany, setFormCompany] = useState('');
  const [formMall, setFormMall] = useState('');
  const [formRate, setFormRate] = useState('');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [fr, lg] = await Promise.all([
        supabaseFetchAll<FeeRow>('/mall_fees?select=id,company,mall,rate,updated_at&order=company.asc,mall.asc').catch(() => []),
        supabaseFetchAll<LogRow>('/mall_fee_logs?select=id,action,company,mall,before_rate,after_rate,changed_by,created_at&order=created_at.desc&limit=200').catch(() => []),
      ]);
      setRows(Array.isArray(fr) ? fr : []);
      setLogs(Array.isArray(lg) ? lg : []);
    } catch { setRows([]); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  // 사업자·몰 입력 후보 (기존 데이터 + 아는 값)
  const companyOptions = useMemo(
    () => Array.from(new Set([...KNOWN_COMPANIES, ...rows.map(r => r.company)])).filter(Boolean).sort(),
    [rows],
  );
  const mallOptions = useMemo(
    () => Array.from(new Set([...CANONICAL_MALLS, ...rows.map(r => r.mall)])).filter(Boolean),
    [rows],
  );

  function startNew() { setEditId(''); setFormCompany(''); setFormMall(''); setFormRate(''); setMsg(''); }
  function startEdit(r: FeeRow) { setEditId(r.id); setFormCompany(r.company); setFormMall(r.mall); setFormRate(String(r.rate)); setMsg(''); }
  function cancel() { setEditId(null); setMsg(''); }

  async function logChange(action: string, company: string, mall: string, before: number | null, after: number | null) {
    try {
      await supabaseFetch('/mall_fee_logs', {
        method: 'POST', headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ action, company, mall, before_rate: before, after_rate: after, changed_by: me?.name || '' }),
      });
    } catch { /* 로그 실패는 본 작업에 영향 없음 */ }
  }

  // 저장 시 몰명은 반드시 정규화 — 매출현황이 `${사업자}|${normalizeMall(몰명)}`로 요율을 찾기 때문
  const normMall = normalizeMall(formMall);
  const rateNum = Number(formRate);
  const rateValid = formRate.trim() !== '' && Number.isFinite(rateNum) && rateNum >= 0 && rateNum <= 100;

  // 같은 (사업자·몰) 조합이 이미 있나 (신규 등록 시 중복 경고)
  const dupExisting = useMemo(
    () => rows.find(r => r.company === formCompany.trim() && r.mall === normMall && r.id !== editId),
    [rows, formCompany, normMall, editId],
  );

  async function save() {
    const company = formCompany.trim();
    const mall = normMall;
    if (!company) { setMsg('사업자를 입력하세요.'); return; }
    if (!mall) { setMsg('판매몰을 입력하세요.'); return; }
    if (!rateValid) { setMsg('수수료율은 0~100 사이 숫자여야 합니다.'); return; }
    const isEdit = !!editId;
    const prevRow = isEdit ? rows.find(r => r.id === editId) : undefined;
    const before = prevRow ? Number(prevRow.rate) : null;
    setSaving(true);
    try {
      // 수정하면서 사업자/몰(=유니크 키)을 바꾼 경우, 기존 행을 먼저 정리(중복·유령행 방지)
      if (isEdit && prevRow && (prevRow.company !== company || prevRow.mall !== mall)) {
        await supabaseFetch(`/mall_fees?company=eq.${enc(prevRow.company)}&mall=eq.${enc(prevRow.mall)}`, { method: 'DELETE' });
      }
      // (사업자·몰) 유니크 → upsert. 이미 있으면 요율만 갱신(과거분 즉시 재계산됨).
      const res = await supabaseFetch('/mall_fees?on_conflict=company,mall', {
        method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify({ company, mall, rate: rateNum, updated_at: new Date().toISOString() }),
      });
      if (!res.ok) { setMsg(`저장 실패 (${res.status})`); return; }
      await logChange(isEdit ? 'update' : 'create', company, mall, before, rateNum);
      setEditId(null);
      await load();
    } catch { setMsg('저장 중 오류가 발생했습니다.'); }
    finally { setSaving(false); }
  }

  async function del(r: FeeRow) {
    if (!canDelete) { alert('삭제는 대표·실장만 가능합니다.'); return; }
    if (!confirm(`${r.company} · ${r.mall} 수수료(${r.rate}%)를 삭제할까요?\n(삭제하면 이 몰 매출엔 수수료가 빠져 공헌이익이 높게 잡힙니다)`)) return;
    await supabaseFetch(`/mall_fees?id=eq.${r.id}`, { method: 'DELETE' });
    await logChange('delete', r.company, r.mall, Number(r.rate), null);
    await load();
  }

  async function delLog(id: string) {
    if (!canDelete) return;
    if (!confirm('이 로그를 삭제할까요? (대표·실장만 가능)')) return;
    await supabaseFetch(`/mall_fee_logs?id=eq.${id}`, { method: 'DELETE' });
    setLogs(prev => prev.filter(l => l.id !== id));
  }

  const filtered = rows.filter(r =>
    !search || r.company.includes(search) || r.mall.toLowerCase().includes(search.toLowerCase()),
  );
  // 사업자별 그룹핑
  const grouped = useMemo(() => {
    const g = new Map<string, FeeRow[]>();
    for (const r of filtered) { const a = g.get(r.company) || []; a.push(r); g.set(r.company, a); }
    return Array.from(g.entries()).sort((a, b) => a[0].localeCompare(b[0], 'ko'));
  }, [filtered]);

  if (!canEdit) {
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-2xl px-5 py-8 text-center">
        <div className="text-lg font-semibold text-amber-700">🔒 접근 권한이 없습니다</div>
        <div className="text-sm text-amber-600 mt-1">몰 수수료 관리는 대표·실장·매출 담당자만 이용할 수 있습니다.</div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-gray-800">몰별 수수료 관리</h1>
          <p className="text-sm text-gray-400 mt-1">사업자·판매몰별 <b>수수료율</b>을 여기서 추가·수정합니다. 저장하면 매출현황이 <b>과거분까지 즉시 새 요율로 다시 계산</b>합니다.</p>
        </div>
        {editId === null && (
          <button onClick={startNew} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-base font-medium">+ 수수료 추가</button>
        )}
      </div>

      {/* 추가/수정 폼 */}
      {editId !== null && (
        <div className="bg-white rounded-2xl border border-blue-200 shadow-sm p-5 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">사업자 *</label>
              <input list="mf-companies" value={formCompany} onChange={e => setFormCompany(e.target.value)}
                placeholder="예: IX글로벌"
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-base focus:outline-none focus:ring-2 focus:ring-blue-400" />
              <datalist id="mf-companies">{companyOptions.map(c => <option key={c} value={c} />)}</datalist>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">판매몰 *</label>
              <input list="mf-malls" value={formMall} onChange={e => setFormMall(e.target.value)}
                placeholder="예: SSG / 롯데온 / 자사몰Npay"
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-base focus:outline-none focus:ring-2 focus:ring-blue-400" />
              <datalist id="mf-malls">{mallOptions.map(m => <option key={m} value={m} />)}</datalist>
              {formMall.trim() && normMall !== formMall.trim() && (
                <p className="text-xs text-blue-500 mt-1">정규화 → <b>{normMall}</b> 로 저장됩니다 (몰 표기 흔들림 자동 통일)</p>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">수수료율 (%) *</label>
              <input type="number" step="0.01" min="0" max="100" value={formRate} onChange={e => setFormRate(e.target.value)}
                placeholder="예: 12 또는 10.56"
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-base focus:outline-none focus:ring-2 focus:ring-blue-400" />
            </div>
          </div>
          {!editId && dupExisting && (
            <p className="text-xs text-amber-600">⚠️ 이미 <b>{dupExisting.company} · {dupExisting.mall} {dupExisting.rate}%</b> 가 있습니다 — 저장하면 <b>{formRate || '?'}%</b> 로 덮어씁니다.</p>
          )}
          {msg && <div className="text-sm text-red-500">{msg}</div>}
          <div className="flex gap-2">
            <button onClick={save} disabled={saving} className="px-5 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white rounded-xl text-base font-medium">{saving ? '저장 중...' : '저장'}</button>
            <button onClick={cancel} className="px-5 py-2 border border-gray-200 text-gray-600 rounded-xl text-base hover:bg-gray-50">취소</button>
          </div>
        </div>
      )}

      {/* 검색 */}
      <input value={search} onChange={e => setSearch(e.target.value)}
        placeholder="사업자·판매몰 검색"
        className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-base focus:outline-none focus:ring-2 focus:ring-blue-400" />

      {/* 수수료 목록 (사업자별 그룹) */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100 text-sm text-gray-500">
          등록된 수수료 <b className="text-gray-700">{rows.length}</b>건 · 사업자 {new Set(rows.map(r => r.company)).size}곳
        </div>
        {loading ? (
          <div className="text-center py-12 text-gray-400">불러오는 중...</div>
        ) : grouped.length === 0 ? (
          <div className="text-center py-12 text-gray-400">{rows.length === 0 ? "등록된 수수료가 없습니다 — '+ 수수료 추가'로 등록하세요" : '검색 결과가 없습니다'}</div>
        ) : (
          <div className="max-h-[36rem] overflow-y-auto">
            {grouped.map(([company, list]) => (
              <div key={company}>
                <div className="px-5 py-2 bg-slate-50 text-sm font-semibold text-slate-600 sticky top-0">{company} <span className="text-slate-400 font-normal">· {list.length}개 몰</span></div>
                <div className="divide-y divide-gray-50">
                  {list.map(r => (
                    <div key={r.id} className="px-5 py-3 flex items-center justify-between gap-4">
                      <div className="min-w-0 flex-1 flex items-center gap-3">
                        <span className="text-base text-gray-800 font-medium">{r.mall}</span>
                        <span className="text-base font-bold text-blue-600 tabular-nums">{r.rate}%</span>
                        {r.updated_at && <span className="text-xs text-gray-300">{r.updated_at.slice(0, 10)}</span>}
                      </div>
                      <div className="flex gap-2 flex-shrink-0">
                        <button onClick={() => startEdit(r)} className="text-sm text-blue-500 hover:underline">수정</button>
                        {canDelete && <button onClick={() => del(r)} className="text-sm text-red-400 hover:underline">삭제</button>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <p className="text-xs text-gray-400 px-1">
        ※ 수수료 금액 = 상품결제금액 × 요율%. 공헌이익 = (상품금액 + 배송비 − 수수료 − 원가 − 실운임) ÷ 1.1.
        요율이 없는 몰로 팔리면 매출현황에 <b>수수료 미설정 경고</b>가 뜨고 그 매출엔 수수료가 빠집니다.
      </p>

      {/* 변경 이력 */}
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
              <div key={l.id} className="px-5 py-3 flex items-center gap-3">
                <span className={`text-xs px-2 py-0.5 rounded-md font-medium flex-shrink-0 ${l.action === 'delete' ? 'bg-red-50 text-red-600' : l.action === 'update' ? 'bg-amber-50 text-amber-600' : 'bg-green-50 text-green-600'}`}>{ACTION_LABEL[l.action] || l.action}</span>
                <div className="min-w-0 flex-1">
                  <div className="text-sm text-gray-700">{l.company} · {l.mall}</div>
                  <div className="text-sm text-gray-500 mt-0.5">
                    {l.action === 'update' ? `${l.before_rate ?? '-'}% → ${l.after_rate ?? '-'}%`
                      : l.action === 'delete' ? `(삭제) ${l.before_rate ?? '-'}%`
                      : `→ ${l.after_rate ?? '-'}%`}
                  </div>
                  <div className="text-xs text-gray-400 mt-0.5">{l.changed_by || '-'} · {l.created_at?.slice(0, 16).replace('T', ' ')}</div>
                </div>
                {canDelete && <button onClick={() => delLog(l.id)} className="text-xs text-gray-300 hover:text-red-500 flex-shrink-0">삭제</button>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
