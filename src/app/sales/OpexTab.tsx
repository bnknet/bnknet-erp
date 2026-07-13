'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabaseFetch, supabaseFetchAll } from '@/lib/supabase';
import { computeOrderLines, type FullOrder, type FullInv } from '@/lib/salesStats';
import { type MallFee } from '@/lib/mallFees';
import { OPEX_CATEGORIES, OPEX_COMPANIES, toSupply, type OpexCatDef, type OpexRow } from '@/lib/opex';

interface Props {
  orders: FullOrder[];
  inventory: FullInv[];
  fees: MallFee[];
  bomRows: { set_name: string; component_name: string; component_qty: number }[];
  userName?: string;
}

const won = (n: number) => `${Math.round(n).toLocaleString('ko-KR')}원`;
const NATURES = ['고정', '변동', '준변동', '혼합'];
const nowYm = () => {
  const d = new Date(Date.now() + 9 * 3600 * 1000); // KST
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};
const prevYm = (ym: string) => {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 2, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};
const genKey = () => {
  try { if (typeof crypto !== 'undefined' && crypto.randomUUID) return 'c_' + crypto.randomUUID().slice(0, 8); } catch { /* noop */ }
  return 'c_' + Date.now().toString(36) + Math.floor(Math.random() * 1e5).toString(36);
};

// 기본 카테고리(코드) → DB 조회 실패 시 폴백
const FALLBACK_CATS: OpexCatDef[] = OPEX_CATEGORIES.map((c, i) => ({ key: c.key, label: c.label, nature: c.nature, taxable: c.taxable, sort: (i + 1) * 10, active: true }));

export default function OpexTab({ orders, inventory, fees, bomRows, userName }: Props) {
  const [ym, setYm] = useState(nowYm());
  const [company, setCompany] = useState(OPEX_COMPANIES[0]);
  const [allCats, setAllCats] = useState<OpexCatDef[]>(FALLBACK_CATS);
  const [rows, setRows] = useState<OpexRow[]>([]);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  // 항목 관리 패널
  const [manageOpen, setManageOpen] = useState(false);
  const [draft, setDraft] = useState<(OpexCatDef & { _new?: boolean })[]>([]);
  const [catSaving, setCatSaving] = useState(false);

  const [year, month] = ym.split('-').map(Number);

  const inputCats = useMemo(() => allCats.filter((c) => c.active !== false), [allCats]);
  const taxMap = useMemo(() => {
    const m: Record<string, boolean> = {};
    for (const c of allCats) m[c.key] = c.taxable;
    for (const c of OPEX_CATEGORIES) if (!(c.key in m)) m[c.key] = c.taxable; // 폴백
    return m;
  }, [allCats]);

  // 카테고리 로드 (활성/비활성 모두)
  async function loadCats() {
    try {
      const data = await supabaseFetchAll<OpexCatDef>('/opex_category?order=sort.asc&select=key,label,nature,taxable,sort,active');
      if (Array.isArray(data) && data.length) setAllCats(data);
      else setAllCats(FALLBACK_CATS);
    } catch { setAllCats(FALLBACK_CATS); }
  }
  useEffect(() => { loadCats(); }, []);

  // 월별·사업자별 공헌이익 — 매출현황과 동일한 computeOrderLines
  const monthAgg = useMemo(() => {
    const { lines } = computeOrderLines(orders, inventory, fees, bomRows);
    const map = new Map<string, { rev: number; prof: number; mrev: number; cnt: number }>();
    let othersProf = 0, othersRev = 0, othersMrev = 0;
    for (const l of lines) {
      if (!l.date || l.date.slice(0, 7) !== ym) continue;
      if (OPEX_COMPANIES.includes(l.company)) {
        const a = map.get(l.company) || { rev: 0, prof: 0, mrev: 0, cnt: 0 };
        a.rev += l.rev; a.cnt++;
        if (l.profitKnown) { a.prof += l.profit; a.mrev += l.rev; }
        map.set(l.company, a);
      } else {
        othersRev += l.rev;
        if (l.profitKnown) { othersProf += l.profit; othersMrev += l.rev; }
      }
    }
    return { map, othersProf, othersRev, othersMrev };
  }, [orders, inventory, fees, bomRows, ym]);

  async function loadOpex(y: number, m: number) {
    setLoading(true);
    try {
      const data = await supabaseFetchAll<OpexRow>(`/opex?year=eq.${y}&month=eq.${m}&select=id,company,year,month,category,amount,memo`);
      setRows(Array.isArray(data) ? data : []);
    } catch { setRows([]); }
    finally { setLoading(false); }
  }
  useEffect(() => { loadOpex(year, month); }, [year, month]);

  useEffect(() => {
    const e: Record<string, string> = {};
    for (const c of inputCats) {
      const r = rows.find((x) => x.company === company && x.category === c.key);
      e[c.key] = r && r.amount ? String(r.amount) : '';
    }
    setEdits(e);
  }, [rows, company, inputCats]);

  const parse = (s: string) => Number(String(s).replace(/[^0-9.-]/g, '')) || 0;

  const opexPaid = inputCats.reduce((a, c) => a + parse(edits[c.key] || ''), 0);
  const opexSupply = inputCats.reduce((a, c) => a + toSupply(c.taxable, parse(edits[c.key] || '')), 0);

  const cur = monthAgg.map.get(company) || { rev: 0, prof: 0, mrev: 0, cnt: 0 };
  const operProfit = cur.prof - opexSupply;
  const operMargin = cur.mrev > 0 ? (operProfit / cur.mrev) * 100 : null;

  async function save() {
    setSaving(true);
    try {
      const payload = inputCats.map((c) => ({
        company, year, month, category: c.key,
        amount: parse(edits[c.key] || ''), created_by: userName || '',
        updated_at: new Date().toISOString(),
      }));
      const res = await supabaseFetch('/opex?on_conflict=company,year,month,category', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(String(res.status));
      await loadOpex(year, month);
      alert('저장되었습니다.');
    } catch (e) {
      alert(`저장 실패 (${e instanceof Error ? e.message : ''}). db/opex.sql 적용 여부를 확인해주세요.`);
    } finally { setSaving(false); }
  }

  async function copyPrevMonth() {
    const pv = prevYm(ym);
    const [py, pm] = pv.split('-').map(Number);
    try {
      const prev = await supabaseFetchAll<OpexRow>(`/opex?year=eq.${py}&month=eq.${pm}&company=eq.${encodeURIComponent(company)}&select=category,amount`);
      if (!prev.length) { alert(`${py}년 ${pm}월 ${company} 판관비 데이터가 없습니다.`); return; }
      const e: Record<string, string> = { ...edits };
      for (const r of prev) if (r.amount) e[r.category] = String(r.amount);
      setEdits(e);
      alert(`${py}년 ${pm}월 값을 불러왔습니다. 확인 후 저장을 눌러주세요.`);
    } catch { alert('전월 데이터를 불러오지 못했습니다.'); }
  }

  // ── 항목 관리 ──
  function openManage() {
    setDraft(allCats.map((c) => ({ ...c })));
    setManageOpen(true);
  }
  function updateDraft(i: number, patch: Partial<OpexCatDef>) {
    setDraft((d) => d.map((c, idx) => (idx === i ? { ...c, ...patch } : c)));
  }
  function moveDraft(i: number, dir: -1 | 1) {
    setDraft((d) => {
      const j = i + dir;
      if (j < 0 || j >= d.length) return d;
      const n = [...d]; [n[i], n[j]] = [n[j], n[i]]; return n;
    });
  }
  function addDraft() {
    setDraft((d) => [...d, { key: genKey(), label: '', nature: '고정', taxable: true, active: true, _new: true }]);
  }
  function removeDraft(i: number) {
    setDraft((d) => {
      const c = d[i];
      if (c._new) return d.filter((_, idx) => idx !== i); // 새 항목은 즉시 제거
      return d.map((x, idx) => (idx === i ? { ...x, active: false } : x)); // 기존 항목은 숨김 처리
    });
  }
  async function saveCats() {
    const bad = draft.find((c) => !c.label.trim());
    if (bad) { alert('항목 이름을 모두 입력해주세요.'); return; }
    setCatSaving(true);
    try {
      const payload = draft.map((c, i) => ({
        key: c.key, label: c.label.trim(), nature: c.nature, taxable: c.taxable,
        active: c.active !== false, sort: (i + 1) * 10, updated_at: new Date().toISOString(),
      }));
      const res = await supabaseFetch('/opex_category?on_conflict=key', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(String(res.status));
      await loadCats();
      setManageOpen(false);
      alert('항목이 저장되었습니다.');
    } catch (e) {
      alert(`항목 저장 실패 (${e instanceof Error ? e.message : ''}). db/opex_category.sql 적용 여부를 확인해주세요.`);
    } finally { setCatSaving(false); }
  }

  // 전사 롤업
  const companyRollup = OPEX_COMPANIES.map((co) => {
    const agg = monthAgg.map.get(co) || { rev: 0, prof: 0, mrev: 0, cnt: 0 };
    const supply = rows.filter((r) => r.company === co)
      .reduce((a, r) => a + toSupply(taxMap[r.category] ?? true, Number(r.amount) || 0), 0);
    const liveSupply = co === company ? opexSupply : supply;
    return { co, rev: agg.rev, prof: agg.prof, mrev: agg.mrev, opex: liveSupply, oper: agg.prof - liveSupply };
  });
  const totalProf = companyRollup.reduce((a, r) => a + r.prof, 0) + monthAgg.othersProf;
  const totalRev = companyRollup.reduce((a, r) => a + r.rev, 0) + monthAgg.othersRev;
  const totalOpex = companyRollup.reduce((a, r) => a + r.opex, 0);
  const totalMrev = companyRollup.reduce((a, r) => a + r.mrev, 0) + monthAgg.othersMrev;
  const totalOper = totalProf - totalOpex;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <input type="month" value={ym} onChange={(e) => e.target.value && setYm(e.target.value)}
          className="px-3 py-2 rounded-lg border border-gray-200 text-base bg-white" />
        <span className="text-sm text-gray-400">경영진 전용 · 영업이익 = 공헌이익 − 판관비(공급가액 기준, 과세 항목 ÷1.1)</span>
        <button onClick={openManage} className="ml-auto px-3 py-1.5 rounded-lg border border-gray-200 text-sm text-gray-600 hover:bg-gray-50">⚙ 항목 관리</button>
      </div>

      {/* 전사 요약 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
          <div className="text-sm text-gray-500">매출(공급가액)</div>
          <div className="text-2xl font-bold text-gray-800 mt-1" style={{ letterSpacing: '-0.02em' }}>{won(totalRev)}</div>
        </div>
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
          <div className="text-sm text-gray-500">공헌이익</div>
          <div className="text-2xl font-bold text-blue-700 mt-1" style={{ letterSpacing: '-0.02em' }}>{won(totalProf)}</div>
        </div>
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
          <div className="text-sm text-gray-500">판관비(합)</div>
          <div className="text-2xl font-bold text-gray-700 mt-1" style={{ letterSpacing: '-0.02em' }}>−{won(totalOpex)}</div>
        </div>
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
          <div className="text-sm text-gray-500">영업이익</div>
          <div className={`text-2xl font-bold mt-1 ${totalOper >= 0 ? 'text-green-700' : 'text-red-600'}`} style={{ letterSpacing: '-0.02em' }}>{won(totalOper)}</div>
          <div className="text-xs text-gray-400 mt-0.5">{totalMrev > 0 ? `영업이익률 ${(totalOper / totalMrev * 100).toFixed(1)}%` : ''}</div>
        </div>
      </div>

      {/* 사업자별 롤업 */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100 text-base font-semibold text-gray-700">사업자별 손익 ({year}년 {month}월)</div>
        <div className="overflow-x-auto">
          <table className="w-full text-base">
            <thead className="bg-gray-50 text-sm text-gray-500">
              <tr>
                <th className="text-left font-medium px-5 py-2.5">사업자</th>
                <th className="text-right font-medium px-4 py-2.5">공헌이익</th>
                <th className="text-right font-medium px-4 py-2.5">판관비</th>
                <th className="text-right font-medium px-5 py-2.5">영업이익</th>
              </tr>
            </thead>
            <tbody>
              {companyRollup.map((r) => (
                <tr key={r.co} className={`border-t border-gray-50 cursor-pointer hover:bg-gray-50 ${r.co === company ? 'bg-blue-50/40' : ''}`} onClick={() => setCompany(r.co)}>
                  <td className="px-5 py-2.5 font-medium text-gray-700">{r.co}</td>
                  <td className="px-4 py-2.5 text-right text-blue-700 font-medium tabular-nums">{won(r.prof)}</td>
                  <td className="px-4 py-2.5 text-right text-gray-500 tabular-nums">−{won(r.opex)}</td>
                  <td className={`px-5 py-2.5 text-right font-semibold tabular-nums ${r.oper >= 0 ? 'text-green-700' : 'text-red-600'}`}>{won(r.oper)}</td>
                </tr>
              ))}
              {monthAgg.othersProf !== 0 && (
                <tr className="border-t border-gray-50 text-gray-400">
                  <td className="px-5 py-2.5">미분류/기타</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{won(monthAgg.othersProf)}</td>
                  <td className="px-4 py-2.5 text-right">−</td>
                  <td className="px-5 py-2.5 text-right tabular-nums">{won(monthAgg.othersProf)}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* 선택 사업자 판관비 입력 */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100 flex items-center gap-2 flex-wrap">
          <span className="text-base font-semibold text-gray-700">판관비 입력</span>
          <div className="flex gap-1 bg-gray-100 rounded-lg p-1 ml-1">
            {OPEX_COMPANIES.map((c) => (
              <button key={c} onClick={() => setCompany(c)}
                className={`px-3 py-1 rounded-md text-sm font-medium transition-colors ${company === c ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
                {c}
              </button>
            ))}
          </div>
          <button onClick={copyPrevMonth} className="ml-auto px-3 py-1.5 rounded-lg border border-gray-200 text-sm text-gray-600 hover:bg-gray-50">전월 복사</button>
        </div>
        <div className="p-4 sm:p-5 space-y-2">
          {inputCats.map((c) => (
            <div key={c.key} className="flex items-center gap-3 flex-wrap">
              <div className="w-32 flex-none">
                <div className="text-base font-medium text-gray-700">{c.label}</div>
                <div className="text-xs text-gray-400">{c.nature}{c.taxable ? '·과세' : '·면세'}</div>
              </div>
              <div className="flex-1 min-w-[160px]">
                <input
                  inputMode="numeric"
                  value={edits[c.key] ? Number(parse(edits[c.key])).toLocaleString('ko-KR') : ''}
                  onChange={(e) => setEdits((p) => ({ ...p, [c.key]: e.target.value }))}
                  placeholder="0"
                  className="w-full px-3 py-2 rounded-lg border border-gray-200 text-base text-right tabular-nums bg-white focus:outline-none focus:ring-2 focus:ring-blue-400"
                />
              </div>
              <div className="w-28 flex-none text-right text-sm text-gray-400 tabular-nums">
                {parse(edits[c.key] || '') > 0 && (c.taxable ? `공급가 ${won(toSupply(true, parse(edits[c.key])))}` : '면세')}
              </div>
            </div>
          ))}
          {inputCats.length === 0 && <div className="text-sm text-gray-400 py-4 text-center">활성 항목이 없습니다. ‘⚙ 항목 관리’에서 추가하세요.</div>}
        </div>
        <div className="px-5 py-4 border-t border-gray-100 bg-gray-50/60">
          <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1 text-base">
            <span className="text-gray-600">{company} · {month}월</span>
            <span className="text-gray-500">공헌이익 <b className="text-blue-700">{won(cur.prof)}</b></span>
            <span className="text-gray-500">판관비 <b className="text-gray-700">−{won(opexSupply)}</b>
              {opexPaid !== opexSupply && <span className="text-xs text-gray-400"> (지급 {won(opexPaid)})</span>}</span>
            <span className="text-gray-500">영업이익 <b className={operProfit >= 0 ? 'text-green-700' : 'text-red-600'}>{won(operProfit)}</b>
              {operMargin !== null && <span className="text-gray-400 text-sm"> ({operMargin.toFixed(1)}%)</span>}</span>
            <button onClick={save} disabled={saving || loading}
              className="ml-auto px-5 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-base font-medium disabled:opacity-50">
              {saving ? '저장 중…' : '저장'}
            </button>
          </div>
        </div>
      </div>

      <p className="text-xs text-gray-400">
        ⚠️ 건당 택배 실운임(2,300원)은 이미 공헌이익에서 차감됩니다. 판관비 ‘물류·보관비’에는 <b>고정 창고비만</b> 넣어주세요(이중차감 방지).
        판관비는 지급액으로 입력하고, 과세 항목은 부가세 제외(÷1.1) 공급가액으로 영업이익에 반영됩니다.
      </p>

      {/* 항목 관리 모달 */}
      {manageOpen && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-start justify-center p-4 overflow-y-auto" onClick={() => setManageOpen(false)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl my-8" onClick={(e) => e.stopPropagation()}>
            <div className="px-5 py-4 border-b border-gray-100 flex items-center">
              <div className="text-lg font-semibold text-gray-800">판관비 항목 관리</div>
              <button onClick={() => setManageOpen(false)} className="ml-auto text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
            </div>
            <div className="p-5 space-y-2 max-h-[60vh] overflow-y-auto">
              <div className="flex items-center gap-2 text-xs text-gray-400 px-1">
                <span className="flex-1">항목 이름</span><span className="w-24">성격</span><span className="w-16 text-center">과세</span><span className="w-24 text-center">순서·삭제</span>
              </div>
              {draft.map((c, i) => (
                <div key={c.key} className={`flex items-center gap-2 ${c.active === false ? 'opacity-45' : ''}`}>
                  <input value={c.label} onChange={(e) => updateDraft(i, { label: e.target.value })} placeholder="예: PG수수료"
                    className="flex-1 px-3 py-2 rounded-lg border border-gray-200 text-base bg-white focus:outline-none focus:ring-2 focus:ring-blue-400" />
                  <select value={c.nature} onChange={(e) => updateDraft(i, { nature: e.target.value })}
                    className="w-24 px-2 py-2 rounded-lg border border-gray-200 text-sm bg-white">
                    {NATURES.map((n) => <option key={n} value={n}>{n}</option>)}
                  </select>
                  <label className="w-16 flex justify-center" title="과세(체크)/면세">
                    <input type="checkbox" checked={c.taxable} onChange={(e) => updateDraft(i, { taxable: e.target.checked })} className="w-5 h-5 rounded border-gray-300 text-blue-600" />
                  </label>
                  <div className="w-24 flex items-center justify-center gap-0.5">
                    <button onClick={() => moveDraft(i, -1)} className="px-1.5 py-1 text-gray-400 hover:text-gray-700" title="위로">▲</button>
                    <button onClick={() => moveDraft(i, 1)} className="px-1.5 py-1 text-gray-400 hover:text-gray-700" title="아래로">▼</button>
                    {c.active === false
                      ? <button onClick={() => updateDraft(i, { active: true })} className="px-1.5 py-1 text-xs text-blue-600" title="다시 사용">복구</button>
                      : <button onClick={() => removeDraft(i)} className="px-1.5 py-1 text-gray-400 hover:text-red-600" title="삭제(숨김)">🗑</button>}
                  </div>
                </div>
              ))}
              <button onClick={addDraft} className="mt-1 px-3 py-2 rounded-lg border border-dashed border-gray-300 text-sm text-gray-500 hover:bg-gray-50 w-full">+ 항목 추가</button>
              <p className="text-xs text-gray-400 pt-1">삭제는 숨김 처리(과거 입력 금액은 보존)됩니다. 과세=부가세 포함 지급(영업이익 계산 시 ÷1.1), 면세=그대로(예: 인건비).</p>
            </div>
            <div className="px-5 py-4 border-t border-gray-100 flex gap-2 justify-end">
              <button onClick={() => setManageOpen(false)} className="px-4 py-2 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50">취소</button>
              <button onClick={saveCats} disabled={catSaving} className="px-5 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-medium disabled:opacity-50">{catSaving ? '저장 중…' : '항목 저장'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
