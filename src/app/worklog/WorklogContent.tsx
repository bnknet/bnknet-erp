'use client';

import { useState, useEffect } from 'react';
import { supabaseFetch } from '@/lib/supabase';
import { getUser } from '@/lib/auth';
import * as XLSX from 'xlsx';

interface Worklog {
  id: string;
  work_date: string;
  author_name: string;
  company: string;
  in_progress: string;
  planned: string;
  notes: string;
  created_at: string;
}

const COMPANIES = ['전체', 'BNKNET', '더블아이', 'SJ글로벌', 'IX글로벌'];

const EMPTY_FORM = {
  work_date: new Date().toISOString().slice(0, 10),
  author_name: '',
  company: 'BNKNET',
  in_progress: '',
  planned: '',
  notes: '',
};

type View = 'list' | 'detail' | 'form';

export default function WorklogContent() {
  const me = getUser();
  const isAdmin = me?.role === 'ceo' || me?.role === 'admin';

  const [view, setView] = useState<View>('list');
  const [logs, setLogs] = useState<Worklog[]>([]);
  const [selected, setSelected] = useState<Worklog | null>(null);
  const [loading, setLoading] = useState(true);
  const [filterCompany, setFilterCompany] = useState('전체');
  const today = new Date().toISOString().slice(0, 10);
  const firstOfMonth = today.slice(0, 7) + '-01';
  const [dateFrom, setDateFrom] = useState(firstOfMonth);
  const [dateTo, setDateTo] = useState(today);
  const [form, setForm] = useState({ ...EMPTY_FORM, author_name: me?.name || '' });
  const [editId, setEditId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => { loadLogs(); }, [filterCompany, dateFrom, dateTo]);

  async function loadLogs() {
    setLoading(true);
    try {
      let query = `/worklogs?work_date=gte.${dateFrom}&work_date=lte.${dateTo}&order=work_date.desc,created_at.desc`;
      if (filterCompany !== '전체') query += `&company=eq.${encodeURIComponent(filterCompany)}`;
      const res = await supabaseFetch(query);
      const data = await res.json();
      setLogs(Array.isArray(data) ? data : []);
    } catch { setLogs([]); }
    finally { setLoading(false); }
  }

  async function handleSave() {
    if (!form.work_date || !form.author_name.trim() || !form.in_progress.trim()) return;
    setSaving(true);
    try {
      const payload = { ...form, updated_at: new Date().toISOString() };
      let res;
      if (editId) {
        res = await supabaseFetch(`/worklogs?id=eq.${editId}`, {
          method: 'PATCH',
          headers: { Prefer: 'return=minimal' },
          body: JSON.stringify(payload),
        });
      } else {
        res = await supabaseFetch('/worklogs', {
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
      setView('list');
      setEditId(null);
      setForm({ ...EMPTY_FORM, author_name: me?.name || '' });
      await loadLogs();
    } finally { setSaving(false); }
  }

  async function handleDelete(id: string) {
    if (!confirm('업무일지를 삭제하시겠습니까?')) return;
    await supabaseFetch(`/worklogs?id=eq.${id}`, { method: 'DELETE' });
    setView('list');
    setSelected(null);
    await loadLogs();
  }

  function openDetail(log: Worklog) {
    setSelected(log);
    setView('detail');
  }

  function openForm(log?: Worklog) {
    if (log) {
      setForm({
        work_date: log.work_date,
        author_name: log.author_name,
        company: log.company,
        in_progress: log.in_progress || '',
        planned: log.planned || '',
        notes: log.notes || '',
      });
      setEditId(log.id);
    } else {
      setForm({ ...EMPTY_FORM, author_name: me?.name || '' });
      setEditId(null);
    }
    setView('form');
  }

  function exportExcel() {
    const data = logs.filter(l => filterCompany === '전체' || l.company === filterCompany).map((l) => ({
      날짜: l.work_date,
      작성자: l.author_name,
      사업자: l.company,
      진행업무: l.in_progress || '',
      예정업무: l.planned || '',
      특이사항: l.notes || '',
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    ws['!cols'] = [{ wch: 12 }, { wch: 10 }, { wch: 10 }, { wch: 40 }, { wch: 40 }, { wch: 30 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '업무일지');
    XLSX.writeFile(wb, `업무일지_${dateFrom}_${dateTo}.xlsx`);
  }

  // 날짜별 그룹
  const grouped = logs.reduce<Record<string, Worklog[]>>((acc, log) => {
    (acc[log.work_date] = acc[log.work_date] || []).push(log);
    return acc;
  }, {});
  const sortedDates = Object.keys(grouped).sort((a, b) => b.localeCompare(a));

  const canEdit = (log: Worklog) => isAdmin || log.author_name === me?.name;

  // 목록
  if (view === 'list') return (
    <div className="space-y-4">
      {/* 필터 */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1.5 bg-white border border-gray-200 rounded-xl px-3 py-2">
            <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)}
              className="text-base text-gray-700 focus:outline-none bg-transparent" />
            <span className="text-gray-400 text-base">~</span>
            <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)}
              className="text-base text-gray-700 focus:outline-none bg-transparent" />
          </div>
          {/* 빠른 기간 버튼 */}
          {[
            { label: '오늘', from: today, to: today },
            { label: '이번주', from: (() => { const d = new Date(); d.setDate(d.getDate() - d.getDay() + 1); return d.toISOString().slice(0,10); })(), to: today },
            { label: '이번달', from: firstOfMonth, to: today },
          ].map((p) => (
            <button key={p.label} onClick={() => { setDateFrom(p.from); setDateTo(p.to); }}
              className="px-3 py-2 rounded-xl text-base font-medium bg-white border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors">
              {p.label}
            </button>
          ))}
          <div className="grid grid-cols-2 gap-2 w-full sm:flex sm:w-auto sm:flex-wrap">
            {COMPANIES.map((c) => (
              <button key={c} onClick={() => setFilterCompany(c)}
                className={`px-3 py-2 rounded-xl text-base font-medium whitespace-nowrap text-center transition-colors ${c === '전체' ? 'col-span-2 sm:col-span-1' : ''} ${filterCompany === c ? 'bg-slate-700 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
                {c}
              </button>
            ))}
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={exportExcel}
            className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-xl text-base font-medium transition-colors">
            엑셀 다운로드
          </button>
          <button onClick={() => openForm()}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-base font-medium transition-colors">
            + 업무일지 작성
          </button>
        </div>
      </div>

      {/* 목록 */}
      {loading ? (
        <div className="text-center py-12 text-gray-400">불러오는 중...</div>
      ) : sortedDates.length === 0 ? (
        <div className="text-center py-12 text-gray-400">등록된 업무일지가 없습니다</div>
      ) : (
        <div className="space-y-4">
          {sortedDates.map((date) => (
            <div key={date}>
              {/* 날짜 헤더 */}
              <div className="flex items-center gap-3 mb-2">
                <span className="text-base font-bold text-gray-700">
                  {new Date(date + 'T00:00:00').toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'short' })}
                </span>
                <div className="flex-1 h-px bg-gray-100" />
                <span className="text-sm text-gray-400">{grouped[date].length}건</span>
              </div>
              {/* 카드들 */}
              <div className="space-y-2">
                {grouped[date].map((log) => (
                  <div key={log.id} onClick={() => openDetail(log)}
                    className="bg-white rounded-2xl border border-gray-100 shadow-sm px-5 py-4 cursor-pointer hover:shadow-md hover:border-blue-100 transition-all">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <span className="text-base font-bold text-gray-800">{log.author_name}</span>
                        <span className="text-sm px-2 py-0.5 rounded-md bg-slate-100 text-slate-500">{log.company}</span>
                      </div>
                    </div>
                    <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div>
                        <div className="text-sm text-blue-400 font-medium mb-1">진행업무</div>
                        <p className="text-base text-gray-700 line-clamp-2 whitespace-pre-line">{log.in_progress || '-'}</p>
                      </div>
                      <div>
                        <div className="text-sm text-orange-400 font-medium mb-1">예정업무</div>
                        <p className="text-base text-gray-700 line-clamp-2 whitespace-pre-line">{log.planned || '-'}</p>
                      </div>
                      <div>
                        <div className="text-sm text-purple-400 font-medium mb-1">특이사항</div>
                        <p className="text-base text-gray-700 line-clamp-2 whitespace-pre-line">{log.notes || '-'}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
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
            <div className="flex items-center gap-2">
              <span className="text-lg font-bold text-gray-800">{selected.author_name}</span>
              <span className="text-sm px-2 py-0.5 rounded-md bg-slate-100 text-slate-500">{selected.company}</span>
            </div>
            <p className="text-base text-gray-400 mt-1">
              {new Date(selected.work_date + 'T00:00:00').toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' })}
            </p>
          </div>
          {canEdit(selected) && (
            <div className="flex gap-2">
              <button onClick={() => openForm(selected)}
                className="px-3 py-1.5 text-base text-blue-600 border border-blue-200 rounded-lg hover:bg-blue-50">수정</button>
              <button onClick={() => handleDelete(selected.id)}
                className="px-3 py-1.5 text-base text-red-500 border border-red-200 rounded-lg hover:bg-red-50">삭제</button>
            </div>
          )}
        </div>

        <div className="space-y-5">
          {[
            { label: '진행업무', value: selected.in_progress, color: 'blue' },
            { label: '예정업무', value: selected.planned, color: 'orange' },
            { label: '특이사항', value: selected.notes, color: 'purple' },
          ].map(({ label, value, color }) => (
            <div key={label}>
              <div className={`text-sm font-semibold mb-2 text-${color}-500`}>{label}</div>
              <div className="bg-gray-50 rounded-xl px-4 py-3 text-base text-gray-700 whitespace-pre-line min-h-[60px]">
                {value || <span className="text-gray-300">내용 없음</span>}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  // 작성/수정 폼
  return (
    <div className="space-y-4">
      <button onClick={() => { setView('list'); setEditId(null); }} className="text-base text-blue-600 hover:text-blue-700">← 목록으로</button>
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
        <h2 className="text-lg font-bold text-gray-800 mb-5">{editId ? '업무일지 수정' : '업무일지 작성'}</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
          <div>
            <label className="block text-base font-medium text-gray-700 mb-1.5">날짜 *</label>
            <input type="date" value={form.work_date} onChange={(e) => setForm({ ...form, work_date: e.target.value })}
              className="w-full px-4 py-3 border border-gray-200 rounded-xl text-base focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="block text-base font-medium text-gray-700 mb-1.5">작성자 *</label>
            <input value={form.author_name} onChange={(e) => setForm({ ...form, author_name: e.target.value })}
              placeholder="이름"
              className="w-full px-4 py-3 border border-gray-200 rounded-xl text-base focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="block text-base font-medium text-gray-700 mb-1.5">사업자</label>
            <select value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })}
              className="w-full px-4 py-3 border border-gray-200 rounded-xl text-base focus:outline-none focus:ring-2 focus:ring-blue-500">
              {COMPANIES.filter(c => c !== '전체').map(c => <option key={c}>{c}</option>)}
            </select>
          </div>
        </div>

        <div className="space-y-4">
          {[
            { key: 'in_progress', label: '진행업무 *', placeholder: '오늘 진행한 업무 내용을 입력하세요', color: 'blue' },
            { key: 'planned', label: '예정업무', placeholder: '내일 또는 앞으로 예정된 업무를 입력하세요', color: 'orange' },
            { key: 'notes', label: '특이사항', placeholder: '특이사항, 이슈, 메모 등을 입력하세요', color: 'purple' },
          ].map(({ key, label, placeholder, color }) => (
            <div key={key}>
              <label className={`block text-base font-medium text-${color}-500 mb-1.5`}>{label}</label>
              <textarea
                value={(form as any)[key]}
                onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                placeholder={placeholder}
                rows={4}
                className="w-full px-4 py-3 border border-gray-200 rounded-xl text-base focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" />
            </div>
          ))}
        </div>

        <div className="flex gap-3 mt-5">
          <button onClick={handleSave} disabled={saving || !form.work_date || !form.author_name.trim() || !form.in_progress.trim()}
            className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white rounded-xl font-medium text-base transition-colors">
            {saving ? '저장 중...' : editId ? '수정 완료' : '작성 완료'}
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
