'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabaseFetch, supabaseFetchAll } from '@/lib/supabase';
import { computeOrderLines, type FullOrder, type FullInv } from '@/lib/salesStats';
import { type MallFee } from '@/lib/mallFees';
import { OPEX_CATEGORIES, OPEX_COMPANIES, OPEX_CAT_MAP, opexSupplyAmount, type OpexRow } from '@/lib/opex';

interface Props {
  orders: FullOrder[];
  inventory: FullInv[];
  fees: MallFee[];
  bomRows: { set_name: string; component_name: string; component_qty: number }[];
  userName?: string;
}

const won = (n: number) => `${Math.round(n).toLocaleString('ko-KR')}원`;
const nowYm = () => {
  const d = new Date(Date.now() + 9 * 3600 * 1000); // KST
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};
const prevYm = (ym: string) => {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 2, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

export default function OpexTab({ orders, inventory, fees, bomRows, userName }: Props) {
  const [ym, setYm] = useState(nowYm());
  const [company, setCompany] = useState(OPEX_COMPANIES[0]);
  const [rows, setRows] = useState<OpexRow[]>([]); // 해당 월 전체 사업자 opex
  const [edits, setEdits] = useState<Record<string, string>>({}); // category -> 금액문자열 (선택 사업자)
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const [year, month] = ym.split('-').map(Number);

  // 월별·사업자별 공헌이익(공급가액 기준) — 매출현황과 동일한 computeOrderLines 사용
  const monthAgg = useMemo(() => {
    const { lines } = computeOrderLines(orders, inventory, fees, bomRows);
    const map = new Map<string, { rev: number; prof: number; mrev: number; cnt: number }>();
    let othersProf = 0, othersRev = 0, othersMrev = 0;
    for (const l of lines) {
      if (!l.date || l.date.slice(0, 7) !== ym) continue;
      const known = OPEX_COMPANIES.includes(l.company);
      if (known) {
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

  // 선택 사업자 편집값 채우기
  useEffect(() => {
    const e: Record<string, string> = {};
    for (const c of OPEX_CATEGORIES) {
      const r = rows.find((x) => x.company === company && x.category === c.key);
      e[c.key] = r && r.amount ? String(r.amount) : '';
    }
    setEdits(e);
  }, [rows, company]);

  const parse = (s: string) => Number(String(s).replace(/[^0-9.-]/g, '')) || 0;

  // 선택 사업자 판관비(지급액 합 / 공급가액 합)
  const opexPaid = OPEX_CATEGORIES.reduce((a, c) => a + parse(edits[c.key] || ''), 0);
  const opexSupply = OPEX_CATEGORIES.reduce((a, c) => a + opexSupplyAmount(c.key, parse(edits[c.key] || '')), 0);

  const cur = monthAgg.map.get(company) || { rev: 0, prof: 0, mrev: 0, cnt: 0 };
  const operProfit = cur.prof - opexSupply;
  const operMargin = cur.mrev > 0 ? (operProfit / cur.mrev) * 100 : null;

  async function save() {
    setSaving(true);
    try {
      const payload = OPEX_CATEGORIES.map((c) => ({
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

  // 전사 합계 (모든 사업자 opex 공급가액 + 그달 공헌이익 전체)
  const companyRollup = OPEX_COMPANIES.map((co) => {
    const agg = monthAgg.map.get(co) || { rev: 0, prof: 0, mrev: 0, cnt: 0 };
    const supply = rows.filter((r) => r.company === co)
      .reduce((a, r) => a + opexSupplyAmount(r.category, Number(r.amount) || 0), 0);
    // 편집 중인 사업자는 화면 입력값 우선 반영
    const liveSupply = co === company ? opexSupply : supply;
    return { co, rev: agg.rev, prof: agg.prof, mrev: agg.mrev, opex: liveSupply, oper: agg.prof - liveSupply };
  });
  const totalRev = companyRollup.reduce((a, r) => a + r.rev, 0) + monthAgg.othersRev;
  const totalProf = companyRollup.reduce((a, r) => a + r.prof, 0) + monthAgg.othersProf;
  const totalOpex = companyRollup.reduce((a, r) => a + r.opex, 0);
  const totalOper = totalProf - totalOpex;

  return (
    <div className="space-y-5">
      {/* 월 선택 + 안내 */}
      <div className="flex flex-wrap items-center gap-3">
        <input type="month" value={ym} onChange={(e) => e.target.value && setYm(e.target.value)}
          className="px-3 py-2 rounded-lg border border-gray-200 text-base bg-white" />
        <span className="text-sm text-gray-400">경영진 전용 · 영업이익 = 공헌이익 − 판관비(공급가액 기준, 과세 항목 ÷1.1)</span>
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
          <div className="text-xs text-gray-400 mt-0.5">{totalProf > 0 ? `영업이익률 ${(totalOper / (companyRollup.reduce((a, r) => a + r.mrev, 0) + monthAgg.othersMrev || 1) * 100).toFixed(1)}%` : ''}</div>
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
          {OPEX_CATEGORIES.map((c) => (
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
                <div className="text-xs text-gray-400 mt-0.5">{c.hint}</div>
              </div>
              <div className="w-28 flex-none text-right text-sm text-gray-400 tabular-nums">
                {parse(edits[c.key] || '') > 0 && (c.taxable ? `공급가 ${won(opexSupplyAmount(c.key, parse(edits[c.key])))}` : '면세')}
              </div>
            </div>
          ))}
        </div>
        {/* 선택 사업자 손익 */}
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
        결재(카드매입) 지출 자동 태깅은 다음 단계에서 붙습니다.
      </p>
    </div>
  );
}
