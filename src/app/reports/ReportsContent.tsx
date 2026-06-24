'use client';

import { useState, useEffect, useCallback } from 'react';
import * as XLSX from 'xlsx';
import { supabaseFetch } from '@/lib/supabase';
import { getUser } from '@/lib/auth';

interface Report {
  id: string;
  report_type: string;
  title: string;
  report_date: string;
  attendees?: string;
  content?: string;
  result?: string;
  next_action?: string;
  event_id?: string;
  author?: string;
  company?: string;
  created_at: string;
}

interface CalEventLite {
  id: string;
  title: string;
  start_date: string;
}

const REPORT_TYPES = ['외근보고', '미팅보고', '회의록', '기타'] as const;

const TYPE_COLOR: Record<string, string> = {
  '외근보고': 'bg-blue-100 text-blue-700',
  '미팅보고': 'bg-green-100 text-green-700',
  '회의록':   'bg-purple-100 text-purple-700',
  '기타':     'bg-slate-100 text-slate-600',
};

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const EMPTY: Omit<Report, 'id' | 'created_at'> = {
  report_type: '외근보고', title: '', report_date: today(),
  attendees: '', content: '', result: '', next_action: '', event_id: '', author: '', company: '',
};

export default function ReportsContent() {
  const me = getUser();
  const isCeo = me?.role === 'ceo';
  const isManager = isCeo || me?.role === 'admin'; // 대표·실장 전체 수정·삭제

  const [reports, setReports] = useState<Report[]>([]);
  const [events, setEvents] = useState<CalEventLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterType, setFilterType] = useState('전체');
  const [search, setSearch] = useState('');

  const [view, setView] = useState<'list' | 'form' | 'detail'>('list');
  const [selected, setSelected] = useState<Report | null>(null);
  const [form, setForm] = useState({ ...EMPTY });
  const [editId, setEditId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [rRes, eRes] = await Promise.all([
        supabaseFetch('/reports?order=report_date.desc,created_at.desc'),
        supabaseFetch('/calendar_events?select=id,title,start_date&order=start_date.desc&limit=100'),
      ]);
      const r = await rRes.json();
      const e = await eRes.json();
      setReports(Array.isArray(r) ? r : []);
      setEvents(Array.isArray(e) ? e : []);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = reports.filter(r => {
    if (filterType !== '전체' && r.report_type !== filterType) return false;
    if (search) {
      const q = search.toLowerCase();
      return [r.title, r.content, r.attendees, r.author, r.result].some(v => (v || '').toLowerCase().includes(q));
    }
    return true;
  });

  async function save() {
    if (!form.title.trim()) { alert('제목을 입력하세요.'); return; }
    setSaving(true);
    try {
      const payload = {
        report_type: form.report_type, title: form.title, report_date: form.report_date,
        attendees: form.attendees || null, content: form.content || null,
        result: form.result || null, next_action: form.next_action || null,
        event_id: form.event_id || null,
        author: editId ? form.author : (me?.name || ''),
        company: editId ? form.company : (me?.company || null),
      };
      if (editId) {
        await supabaseFetch(`/reports?id=eq.${editId}`, {
          method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(payload),
        });
      } else {
        await supabaseFetch('/reports', {
          method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(payload),
        });
      }
      setView('list'); setEditId(null); setForm({ ...EMPTY });
      await load();
    } finally { setSaving(false); }
  }

  function openNew() { setForm({ ...EMPTY }); setEditId(null); setView('form'); }
  function openEdit(r: Report) {
    setForm({
      report_type: r.report_type, title: r.title, report_date: r.report_date,
      attendees: r.attendees || '', content: r.content || '', result: r.result || '',
      next_action: r.next_action || '', event_id: r.event_id || '',
      author: r.author || '', company: r.company || '',
    });
    setEditId(r.id); setView('form');
  }
  async function del(id: string) {
    if (!confirm('보고서를 삭제하시겠습니까?')) return;
    await supabaseFetch(`/reports?id=eq.${id}`, { method: 'DELETE' });
    setView('list'); await load();
  }

  function exportExcel() {
    const rows = filtered.map(r => ({
      날짜: r.report_date, 종류: r.report_type, 제목: r.title, 작성자: r.author || '',
      참석자: r.attendees || '', 내용: r.content || '', 결과: r.result || '', 후속조치: r.next_action || '',
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '업무보고');
    XLSX.writeFile(wb, `업무보고_${today()}.xlsx`);
  }

  const canEdit = (r: Report) => isManager || r.author === me?.name;
  const linkedEvent = (id?: string) => events.find(e => e.id === id);

  // ── 상세 ──
  if (view === 'detail' && selected) {
    const ev = linkedEvent(selected.event_id);
    return (
      <div className="max-w-2xl mx-auto space-y-4">
        <button onClick={() => setView('list')} className="text-base text-blue-600 hover:text-blue-700">← 목록으로</button>
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-7">
          <div className="flex items-start justify-between gap-3 mb-4">
            <div>
              <span className={`text-sm px-2 py-0.5 rounded-md font-medium ${TYPE_COLOR[selected.report_type]}`}>{selected.report_type}</span>
              <h2 className="text-xl font-bold text-gray-800 mt-2">{selected.title}</h2>
              <div className="text-base text-gray-400 mt-1">
                {selected.report_date} · {selected.author}{selected.company ? ` · ${selected.company}` : ''}
              </div>
            </div>
            {canEdit(selected) && (
              <div className="flex gap-2 flex-shrink-0">
                <button onClick={() => openEdit(selected)} className="text-base text-gray-500 hover:text-blue-600">수정</button>
                <button onClick={() => del(selected.id)} className="text-base text-gray-500 hover:text-red-500">삭제</button>
              </div>
            )}
          </div>

          {ev && (
            <div className="mb-4 text-sm bg-blue-50 text-blue-700 rounded-lg px-3 py-2">
              📅 연결 일정: {ev.title} ({ev.start_date})
            </div>
          )}

          <div className="space-y-4 text-base">
            {[
              { label: '참석자', value: selected.attendees },
              { label: '논의·진행 내용', value: selected.content },
              { label: '결과', value: selected.result },
              { label: '후속 조치', value: selected.next_action },
            ].map((row, i) => (
              <div key={i}>
                <div className="text-sm font-medium text-gray-400 mb-1">{row.label}</div>
                <div className="text-gray-700 whitespace-pre-wrap bg-gray-50 rounded-xl px-4 py-3 min-h-[44px]">{row.value || '-'}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // ── 작성/수정 ──
  if (view === 'form') {
    return (
      <div className="max-w-2xl mx-auto space-y-4">
        <button onClick={() => { setView('list'); setEditId(null); setForm({ ...EMPTY }); }} className="text-base text-blue-600 hover:text-blue-700">← 목록으로</button>
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-7">
          <h2 className="text-lg font-bold text-gray-800 mb-5">{editId ? '보고서 수정' : '보고서 작성'}</h2>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-500 mb-1.5">종류</label>
              <div className="flex gap-2 flex-wrap">
                {REPORT_TYPES.map(t => (
                  <button key={t} onClick={() => setForm({ ...form, report_type: t })}
                    className={`px-3 py-1.5 rounded-lg text-base font-medium ${form.report_type === t ? TYPE_COLOR[t] + ' ring-2 ring-offset-1 ring-gray-300' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}>{t}</button>
                ))}
              </div>
            </div>
            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-500 mb-1">제목 *</label>
                <input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })}
                  placeholder="예: 현대백화점 입점 미팅"
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-base focus:outline-none focus:ring-2 focus:ring-blue-400" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-500 mb-1">날짜</label>
                <input type="date" value={form.report_date} onChange={e => setForm({ ...form, report_date: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-base focus:outline-none focus:ring-2 focus:ring-blue-400" />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-500 mb-1">연결 일정 (선택)</label>
              <select value={form.event_id} onChange={e => setForm({ ...form, event_id: e.target.value })}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-base bg-white focus:outline-none focus:ring-2 focus:ring-blue-400">
                <option value="">연결 안 함</option>
                {events.map(ev => <option key={ev.id} value={ev.id}>{ev.start_date} · {ev.title}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-500 mb-1">참석자</label>
              <input value={form.attendees} onChange={e => setForm({ ...form, attendees: e.target.value })}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-base focus:outline-none focus:ring-2 focus:ring-blue-400" />
            </div>
            {[
              { key: 'content', label: '논의·진행 내용', rows: 4, ph: '미팅에서 논의한 내용을 적어주세요' },
              { key: 'result', label: '결과', rows: 2, ph: '결정 사항 / 결과' },
              { key: 'next_action', label: '후속 조치', rows: 2, ph: '다음에 할 일' },
            ].map(f => (
              <div key={f.key}>
                <label className="block text-sm font-medium text-gray-500 mb-1">{f.label}</label>
                <textarea value={form[f.key as 'content' | 'result' | 'next_action']} rows={f.rows} placeholder={f.ph}
                  onChange={e => setForm({ ...form, [f.key]: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-base focus:outline-none focus:ring-2 focus:ring-blue-400 resize-none" />
              </div>
            ))}
          </div>
          <div className="flex gap-3 mt-6 justify-end">
            <button onClick={() => { setView('list'); setEditId(null); setForm({ ...EMPTY }); }}
              className="px-5 py-2.5 border border-gray-200 text-gray-600 rounded-xl text-base hover:bg-gray-50">취소</button>
            <button onClick={save} disabled={saving}
              className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-base font-medium disabled:opacity-50">
              {saving ? '저장 중...' : '저장'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── 목록 ──
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-lg font-bold text-gray-800">업무 보고</h1>
        <div className="flex gap-2">
          <button onClick={exportExcel} className="px-3 py-2 text-sm border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50">📊 엑셀</button>
          <button onClick={openNew} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-base font-medium">+ 보고서 작성</button>
        </div>
      </div>

      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex gap-2 flex-wrap">
          {['전체', ...REPORT_TYPES].map(t => (
            <button key={t} onClick={() => setFilterType(t)}
              className={`px-3 py-2 rounded-xl text-base font-medium ${filterType === t ? 'bg-slate-700 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'}`}>{t}</button>
          ))}
        </div>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="제목·내용·작성자 검색"
          className="px-3 py-2 border border-gray-200 rounded-xl text-base w-56 focus:outline-none focus:ring-2 focus:ring-blue-400" />
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        {loading ? (
          <div className="text-center py-12 text-gray-400">불러오는 중...</div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-12 text-gray-400">보고서가 없습니다</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-base">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>
                  {['날짜', '종류', '제목', '참석자', '작성자', ''].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-sm font-medium text-gray-500">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filtered.map(r => (
                  <tr key={r.id} onClick={() => { setSelected(r); setView('detail'); }} className="hover:bg-blue-50/40 cursor-pointer">
                    <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{r.report_date}</td>
                    <td className="px-4 py-3">
                      <span className={`text-sm px-2 py-0.5 rounded-md font-medium ${TYPE_COLOR[r.report_type]}`}>{r.report_type}</span>
                    </td>
                    <td className="px-4 py-3 font-medium text-gray-800">{r.title}</td>
                    <td className="px-4 py-3 text-gray-500 text-sm max-w-[180px] truncate">{r.attendees || '-'}</td>
                    <td className="px-4 py-3 text-gray-500">{r.author}</td>
                    <td className="px-4 py-3 text-right">
                      {r.event_id && <span className="text-sm text-blue-400">📅 연결</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
