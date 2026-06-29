'use client';

import { useState, useEffect, useCallback } from 'react';
import * as XLSX from 'xlsx';
import { supabaseFetch } from '@/lib/supabase';
import { getUser } from '@/lib/auth';

interface TargetRow {
  id?: string;
  company: string;
  year: number;
  month: number;
  target_amount: number;
  actual_amount: number;
  target_margin?: number;
}

const COMPANIES = ['BNKNET', 'SJ글로벌', '더블아이', 'IX글로벌'];
const COMPANY_COLORS: Record<string, string> = {
  '더블아이': '#3b82f6', 'BNKNET': '#8b5cf6', 'SJ글로벌': '#10b981', 'IX글로벌': '#f59e0b',
};

function won(n: number) { return n.toLocaleString(); }
function manwon(n: number) {
  if (n >= 100000000) return `${(n / 100000000).toFixed(1)}억`;
  if (n >= 10000) return `${Math.round(n / 10000).toLocaleString()}만`;
  return n.toLocaleString();
}

function achColor(pct: number) {
  if (pct >= 100) return { text: 'text-green-600', bar: 'bg-green-500', stroke: '#22c55e' };
  if (pct >= 70) return { text: 'text-blue-600', bar: 'bg-blue-500', stroke: '#3b82f6' };
  if (pct >= 40) return { text: 'text-orange-500', bar: 'bg-orange-400', stroke: '#fb923c' };
  return { text: 'text-red-500', bar: 'bg-red-400', stroke: '#f87171' };
}

// 원형 게이지
function Gauge({ pct, color }: { pct: number; color: string }) {
  const r = 30, c = 2 * Math.PI * r;
  const off = c * (1 - Math.min(100, pct) / 100);
  return (
    <svg width="76" height="76" viewBox="0 0 76 76" className="flex-shrink-0">
      <circle cx="38" cy="38" r={r} fill="none" stroke="#e5e7eb" strokeWidth="7" />
      <circle cx="38" cy="38" r={r} fill="none" stroke={color} strokeWidth="7" strokeLinecap="round"
        strokeDasharray={c} strokeDashoffset={off} transform="rotate(-90 38 38)" />
      <text x="38" y="42" textAnchor="middle" className="fill-gray-700 font-bold" fontSize="15">{Math.round(pct)}%</text>
    </svg>
  );
}

type Tab = 'dashboard' | 'edit';

export default function SalesTargetContent() {
  const me = getUser();
  const canEdit = me?.role === 'ceo' || me?.role === 'admin';

  const [tab, setTab] = useState<Tab>('dashboard');
  const [year, setYear] = useState(new Date().getFullYear());
  const [rows, setRows] = useState<TargetRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [chartCompany, setChartCompany] = useState('전체');
  const [editCompany, setEditCompany] = useState(COMPANIES[0]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await supabaseFetch(`/sales_targets?year=eq.${year}`);
      const data = await res.json();
      setRows(Array.isArray(data) ? data : []);
    } finally { setLoading(false); }
  }, [year]);

  useEffect(() => { (async () => { await load(); })(); }, [load]);

  // 조회 헬퍼
  const cell = (company: string, month: number): { target_amount: number; actual_amount: number; target_margin?: number } =>
    rows.find(r => r.company === company && r.month === month) || { target_amount: 0, actual_amount: 0 };

  const companyYearTarget = (company: string) =>
    rows.filter(r => r.company === company).reduce((s, r) => s + (r.target_amount || 0), 0);
  const companyYearActual = (company: string) =>
    rows.filter(r => r.company === company).reduce((s, r) => s + (r.actual_amount || 0), 0);
  // 목표 마진율 (월별 동일값 → 입력된 값 중 첫 값)
  const companyMargin = (company: string) => {
    const r = rows.find(r => r.company === company && r.target_margin != null);
    return r?.target_margin ?? null;
  };

  const quarterSum = (company: string, q: number, field: 'target_amount' | 'actual_amount') => {
    const months = [q * 3 - 2, q * 3 - 1, q * 3];
    return months.reduce((s, m) => s + (cell(company, m)[field] || 0), 0);
  };

  const totalTarget = COMPANIES.reduce((s, c) => s + companyYearTarget(c), 0);
  const totalActual = COMPANIES.reduce((s, c) => s + companyYearActual(c), 0);
  const totalPct = totalTarget > 0 ? totalActual / totalTarget * 100 : 0;

  // 월별 차트 데이터 (선택 회사 또는 전체)
  const monthly = Array.from({ length: 12 }, (_, i) => {
    const m = i + 1;
    if (chartCompany === '전체') {
      return {
        month: m,
        target: COMPANIES.reduce((s, c) => s + (cell(c, m).target_amount || 0), 0),
        actual: COMPANIES.reduce((s, c) => s + (cell(c, m).actual_amount || 0), 0),
      };
    }
    const cc = cell(chartCompany, m);
    return { month: m, target: cc.target_amount || 0, actual: cc.actual_amount || 0 };
  });
  const chartMax = Math.max(1, ...monthly.map(d => Math.max(d.target, d.actual)));

  // 업서트
  async function saveCell(company: string, month: number, field: 'target_amount' | 'actual_amount' | 'target_margin', value: number) {
    await supabaseFetch('/sales_targets?on_conflict=company,year,month', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({ company, year, month, [field]: value, updated_at: new Date().toISOString() }),
    });
    await load();
  }

  function exportExcel() {
    const data: Record<string, string | number>[] = [];
    COMPANIES.forEach(c => {
      for (let m = 1; m <= 12; m++) {
        const cc = cell(c, m);
        data.push({
          사업자: c, 연도: year, 월: m,
          목표: cc.target_amount || 0, 실적: cc.actual_amount || 0,
          달성률: cc.target_amount ? `${Math.round((cc.actual_amount || 0) / cc.target_amount * 100)}%` : '-',
        });
      }
    });
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '매출목표');
    XLSX.writeFile(wb, `매출목표_${year}.xlsx`);
  }

  return (
    <div className="space-y-4">
      {/* 탭 + 연도 */}
      <div className="flex items-center justify-between flex-wrap gap-3 border-b border-gray-200 pb-3">
        <div className="flex items-center gap-2">
          <button onClick={() => setTab('dashboard')}
            className={`px-4 py-2 rounded-t-lg text-base font-medium border-b-2 ${tab === 'dashboard' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>대시보드</button>
          {canEdit && (
            <button onClick={() => setTab('edit')}
              className={`px-4 py-2 rounded-t-lg text-base font-medium border-b-2 ${tab === 'edit' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>목표 설정</button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setYear(year - 1)} className="w-8 h-8 rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-500">‹</button>
          <div className="text-base font-bold text-gray-800 w-16 text-center">{year}년</div>
          <button onClick={() => setYear(year + 1)} className="w-8 h-8 rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-500">›</button>
          <button onClick={exportExcel} className="ml-1 px-3 py-1.5 text-sm border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50">📊 엑셀</button>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-12 text-gray-400">불러오는 중...</div>
      ) : tab === 'dashboard' ? (
        <div className="space-y-5">
          {/* 전체 요약 */}
          <div className="bg-gradient-to-r from-slate-800 to-slate-600 rounded-2xl p-6 text-white">
            <div className="flex items-center justify-between flex-wrap gap-4">
              <div>
                <div className="text-base text-slate-300">{year}년 전체 매출 달성</div>
                <div className="text-3xl font-bold mt-1">{won(totalActual)}<span className="text-lg font-normal text-slate-300"> / {won(totalTarget)}원</span></div>
              </div>
              <div className="text-right">
                <div className={`text-4xl font-bold ${totalPct >= 100 ? 'text-green-300' : 'text-white'}`}>{Math.round(totalPct)}%</div>
                <div className="text-sm text-slate-300">달성률</div>
              </div>
            </div>
            <div className="h-2.5 bg-white/20 rounded-full overflow-hidden mt-4">
              <div className="h-full bg-white rounded-full transition-all" style={{ width: `${Math.min(100, totalPct)}%` }} />
            </div>
          </div>

          {/* 사업자별 연간 카드 */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {COMPANIES.map(c => {
              const t = companyYearTarget(c), a = companyYearActual(c);
              const pct = t > 0 ? a / t * 100 : 0;
              const col = achColor(pct);
              return (
                <div key={c} className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
                  <div className="flex items-center gap-3">
                    <Gauge pct={pct} color={col.stroke} />
                    <div className="min-w-0">
                      <div className="font-bold text-gray-800 flex items-center gap-1.5">
                        <span className="w-2.5 h-2.5 rounded-full" style={{ background: COMPANY_COLORS[c] }} />{c}
                      </div>
                      <div className="text-sm text-gray-400 mt-1">목표 {manwon(t)}</div>
                      <div className="text-sm text-gray-600">실적 <span className="font-medium">{manwon(a)}</span></div>
                      {companyMargin(c) != null && (
                        <div className="text-sm text-violet-600 mt-0.5">목표 마진율 {companyMargin(c)}%</div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* 월별 추이 막대 차트 */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
            <div className="flex items-center justify-between flex-wrap gap-2 mb-4">
              <h3 className="font-bold text-gray-800">월별 목표 vs 실적</h3>
              <div className="flex gap-1.5 flex-wrap">
                {['전체', ...COMPANIES].map(c => (
                  <button key={c} onClick={() => setChartCompany(c)}
                    className={`px-2.5 py-1 rounded-lg text-sm font-medium ${chartCompany === c ? 'bg-slate-700 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}>{c}</button>
                ))}
              </div>
            </div>
            <div className="flex items-center gap-3 text-sm text-gray-500 mb-3">
              <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-gray-300" />목표</span>
              <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-blue-500" />실적</span>
            </div>
            <div className="overflow-x-auto">
              <div className="flex items-end gap-2 min-w-[560px] h-44 border-b border-gray-100 pb-0">
                {monthly.map(d => {
                  const pct = d.target > 0 ? d.actual / d.target * 100 : 0;
                  return (
                    <div key={d.month} className="flex-1 flex flex-col items-center justify-end h-full group">
                      <div className="text-[10px] text-gray-400 mb-1 opacity-0 group-hover:opacity-100">{pct ? `${Math.round(pct)}%` : ''}</div>
                      <div className="flex items-end gap-0.5 w-full justify-center h-full">
                        <div className="w-2.5 bg-gray-300 rounded-t" style={{ height: `${d.target / chartMax * 100}%` }} title={`목표 ${won(d.target)}`} />
                        <div className="w-2.5 bg-blue-500 rounded-t" style={{ height: `${d.actual / chartMax * 100}%` }} title={`실적 ${won(d.actual)}`} />
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="flex gap-2 min-w-[560px] mt-1">
                {monthly.map(d => <div key={d.month} className="flex-1 text-center text-[10px] text-gray-400">{d.month}월</div>)}
              </div>
            </div>
          </div>

          {/* 분기 요약 */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
            <h3 className="font-bold text-gray-800 mb-4">분기별 달성률</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-base min-w-[480px]">
                <thead>
                  <tr className="text-sm text-gray-400 border-b border-gray-100">
                    <th className="py-2 text-left font-medium">사업자</th>
                    {[1, 2, 3, 4].map(q => <th key={q} className="py-2 text-center font-medium">{q}분기</th>)}
                    <th className="py-2 text-center font-medium">연간</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {COMPANIES.map(c => (
                    <tr key={c}>
                      <td className="py-2.5 font-medium text-gray-700">{c}</td>
                      {[1, 2, 3, 4].map(q => {
                        const t = quarterSum(c, q, 'target_amount'), a = quarterSum(c, q, 'actual_amount');
                        const pct = t > 0 ? a / t * 100 : 0;
                        return (
                          <td key={q} className="py-2.5 text-center">
                            <span className={`font-bold ${achColor(pct).text}`}>{t > 0 ? `${Math.round(pct)}%` : '-'}</span>
                          </td>
                        );
                      })}
                      <td className="py-2.5 text-center">
                        {(() => { const t = companyYearTarget(c), a = companyYearActual(c); const pct = t > 0 ? a / t * 100 : 0;
                          return <span className={`font-bold ${achColor(pct).text}`}>{t > 0 ? `${Math.round(pct)}%` : '-'}</span>; })()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <p className="text-sm text-gray-400 text-center">💡 실적은 현재 수동 입력이며, 추후 주문 변환 매출 데이터와 자동 연동됩니다.</p>
        </div>
      ) : (
        // ── 목표 설정 ──
        <div className="space-y-4">
          <div className="flex gap-2 flex-wrap">
            {COMPANIES.map(c => (
              <button key={c} onClick={() => setEditCompany(c)}
                className={`px-3 py-1.5 rounded-lg text-base font-medium ${editCompany === c ? 'bg-slate-700 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'}`}>{c}</button>
            ))}
          </div>
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-base min-w-[520px]">
                <thead className="bg-gray-50 border-b border-gray-100">
                  <tr>
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">월</th>
                    <th className="px-4 py-3 text-right text-sm font-medium text-gray-500">목표 금액</th>
                    <th className="px-4 py-3 text-right text-sm font-medium text-gray-500">목표 마진율(%)</th>
                    <th className="px-4 py-3 text-right text-sm font-medium text-gray-500">실적 금액</th>
                    <th className="px-4 py-3 text-center text-sm font-medium text-gray-500">달성률</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {Array.from({ length: 12 }, (_, i) => i + 1).map(m => {
                    const cc = cell(editCompany, m);
                    const pct = cc.target_amount > 0 ? (cc.actual_amount || 0) / cc.target_amount * 100 : 0;
                    return (
                      <tr key={m}>
                        <td className="px-4 py-2.5 font-medium text-gray-700">{m}월</td>
                        <td className="px-4 py-2 text-right">
                          <input type="number" defaultValue={cc.target_amount || ''} placeholder="0"
                            onBlur={e => { const v = Number(e.target.value) || 0; if (v !== (cc.target_amount || 0)) saveCell(editCompany, m, 'target_amount', v); }}
                            className="w-32 text-right px-2 py-1 border border-gray-200 rounded-lg text-base focus:outline-none focus:ring-2 focus:ring-blue-400" />
                        </td>
                        <td className="px-4 py-2 text-right">
                          <input type="number" step="0.1" defaultValue={cc.target_margin ?? ''} placeholder="0"
                            onBlur={e => { const v = Number(e.target.value) || 0; if (v !== (cc.target_margin || 0)) saveCell(editCompany, m, 'target_margin', v); }}
                            className="w-24 text-right px-2 py-1 border border-gray-200 rounded-lg text-base focus:outline-none focus:ring-2 focus:ring-blue-400" />
                        </td>
                        <td className="px-4 py-2 text-right">
                          <input type="number" defaultValue={cc.actual_amount || ''} placeholder="0"
                            onBlur={e => { const v = Number(e.target.value) || 0; if (v !== (cc.actual_amount || 0)) saveCell(editCompany, m, 'actual_amount', v); }}
                            className="w-32 text-right px-2 py-1 border border-gray-200 rounded-lg text-base focus:outline-none focus:ring-2 focus:ring-blue-400" />
                        </td>
                        <td className="px-4 py-2.5 text-center">
                          <span className={`font-bold ${achColor(pct).text}`}>{cc.target_amount > 0 ? `${Math.round(pct)}%` : '-'}</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="bg-gray-50 font-bold border-t border-gray-200">
                    <td className="px-4 py-3 text-gray-700">연간 합계</td>
                    <td className="px-4 py-3 text-right text-gray-800">{won(companyYearTarget(editCompany))}원</td>
                    <td className="px-4 py-3 text-right text-violet-600">{companyMargin(editCompany) != null ? `${companyMargin(editCompany)}%` : '-'}</td>
                    <td className="px-4 py-3 text-right text-gray-800">{won(companyYearActual(editCompany))}원</td>
                    <td className="px-4 py-3 text-center">
                      {(() => { const t = companyYearTarget(editCompany), a = companyYearActual(editCompany); const pct = t > 0 ? a / t * 100 : 0;
                        return <span className={achColor(pct).text}>{t > 0 ? `${Math.round(pct)}%` : '-'}</span>; })()}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
          <p className="text-sm text-gray-400">💡 금액 입력 후 칸 밖을 클릭하면 자동 저장됩니다. 실적은 추후 주문 변환 매출과 자동 연동 예정입니다.</p>
        </div>
      )}
    </div>
  );
}
