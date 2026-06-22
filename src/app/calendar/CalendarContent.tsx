'use client';

import { useState, useEffect, useCallback } from 'react';
import { supabaseFetch } from '@/lib/supabase';
import { getUser } from '@/lib/auth';

interface CalEvent {
  id: string;
  title: string;
  event_type: string;
  start_date: string;
  end_date?: string;
  all_day: boolean;
  start_time?: string;
  end_time?: string;
  location?: string;
  description?: string;
  created_by?: string;
  company?: string;
}

// 휴가 연동 등 읽기전용 가상 이벤트 포함용
interface DisplayEvent extends CalEvent {
  readonly_link?: boolean;   // 휴가 등 연동 일정 (수정 불가)
}

const EVENT_TYPES = ['외근', '오프라인 행사', '온라인 행사', '회의', '기타'] as const;

const TYPE_STYLE: Record<string, { chip: string; dot: string; bar: string }> = {
  '외근':        { chip: 'bg-blue-100 text-blue-700',     dot: 'bg-blue-500',    bar: 'bg-blue-500' },
  '오프라인 행사': { chip: 'bg-green-100 text-green-700',   dot: 'bg-green-500',   bar: 'bg-green-500' },
  '온라인 행사':  { chip: 'bg-purple-100 text-purple-700', dot: 'bg-purple-500',  bar: 'bg-purple-500' },
  '회의':        { chip: 'bg-amber-100 text-amber-700',    dot: 'bg-amber-500',   bar: 'bg-amber-500' },
  '기타':        { chip: 'bg-slate-100 text-slate-600',    dot: 'bg-slate-400',   bar: 'bg-slate-400' },
  '휴가':        { chip: 'bg-pink-100 text-pink-700',      dot: 'bg-pink-500',    bar: 'bg-pink-500' },
};

const VAC_LABEL: Record<string, string> = { annual: '연차', half_am: '반차(오전)', half_pm: '반차(오후)' };
const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

function pad(n: number) { return String(n).padStart(2, '0'); }
function ymd(d: Date) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function today() { return ymd(new Date()); }

const EMPTY_EVENT = {
  title: '', event_type: '외근', start_date: today(), end_date: '',
  all_day: true, start_time: '', end_time: '', location: '', description: '',
};

export default function CalendarContent() {
  const me = getUser();
  const isCeo = me?.role === 'ceo';

  const [events, setEvents] = useState<CalEvent[]>([]);
  const [vacations, setVacations] = useState<DisplayEvent[]>([]);
  const [loading, setLoading] = useState(true);

  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState({ ...EMPTY_EVENT });
  const [saving, setSaving] = useState(false);

  const loadEvents = useCallback(async () => {
    const res = await supabaseFetch('/calendar_events?order=start_date.asc');
    const data = await res.json();
    setEvents(Array.isArray(data) ? data : []);
  }, []);

  const loadVacations = useCallback(async () => {
    const res = await supabaseFetch(
      '/approvals?doc_type=eq.휴가신청서&status=eq.approved&select=id,submitter_name,company,vacation_type,vacation_start,vacation_end,vacation_days'
    );
    const data = await res.json();
    if (!Array.isArray(data)) { setVacations([]); return; }
    const vac: DisplayEvent[] = data.map((v: {
      id: string; submitter_name: string; company: string;
      vacation_type: string; vacation_start: string; vacation_end?: string;
    }) => ({
      id: 'vac_' + v.id,
      title: `${v.submitter_name} ${VAC_LABEL[v.vacation_type] || '휴가'}`,
      event_type: '휴가',
      start_date: v.vacation_start,
      end_date: v.vacation_end || v.vacation_start,
      all_day: true,
      created_by: v.submitter_name,
      company: v.company,
      readonly_link: true,
    }));
    setVacations(vac);
  }, []);

  useEffect(() => {
    (async () => {
      setLoading(true);
      await Promise.all([loadEvents(), loadVacations()]);
      setLoading(false);
    })();
  }, [loadEvents, loadVacations]);

  const allEvents: DisplayEvent[] = [...events, ...vacations];

  // 특정 날짜에 걸치는 이벤트
  function eventsOn(date: string): DisplayEvent[] {
    return allEvents.filter(e => {
      const s = e.start_date;
      const en = e.end_date || e.start_date;
      return date >= s && date <= en;
    });
  }

  // ── 저장 ──
  async function saveEvent() {
    if (!form.title.trim()) { alert('일정 제목을 입력하세요.'); return; }
    setSaving(true);
    try {
      const payload = {
        title: form.title,
        event_type: form.event_type,
        start_date: form.start_date,
        end_date: form.end_date || null,
        all_day: form.all_day,
        start_time: form.all_day ? null : (form.start_time || null),
        end_time: form.all_day ? null : (form.end_time || null),
        location: form.location || null,
        description: form.description || null,
        created_by: me?.name || '',
        company: me?.company || null,
      };
      if (editId) {
        await supabaseFetch(`/calendar_events?id=eq.${editId}`, {
          method: 'PATCH', headers: { Prefer: 'return=minimal' },
          body: JSON.stringify(payload),
        });
      } else {
        await supabaseFetch('/calendar_events', {
          method: 'POST', headers: { Prefer: 'return=minimal' },
          body: JSON.stringify(payload),
        });
      }
      setShowForm(false);
      setEditId(null);
      setForm({ ...EMPTY_EVENT });
      await loadEvents();
    } finally { setSaving(false); }
  }

  function openNew(date?: string) {
    setForm({ ...EMPTY_EVENT, start_date: date || today() });
    setEditId(null);
    setShowForm(true);
  }

  function openEdit(e: DisplayEvent) {
    if (e.readonly_link) return;
    setForm({
      title: e.title, event_type: e.event_type,
      start_date: e.start_date, end_date: e.end_date || '',
      all_day: e.all_day, start_time: e.start_time || '', end_time: e.end_time || '',
      location: e.location || '', description: e.description || '',
    });
    setEditId(e.id);
    setShowForm(true);
  }

  async function deleteEvent(id: string) {
    if (!confirm('일정을 삭제하시겠습니까?')) return;
    await supabaseFetch(`/calendar_events?id=eq.${id}`, { method: 'DELETE' });
    setShowForm(false);
    setEditId(null);
    await loadEvents();
  }

  // ── 달력 그리드 ──
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (string | null)[] = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(ymd(new Date(year, month, d)));
  while (cells.length % 7 !== 0) cells.push(null);

  function prevMonth() { if (month === 0) { setYear(year - 1); setMonth(11); } else setMonth(month - 1); setSelectedDay(null); }
  function nextMonthFn() { if (month === 11) { setYear(year + 1); setMonth(0); } else setMonth(month + 1); setSelectedDay(null); }

  const todayStr = today();

  function canEdit(e: DisplayEvent) {
    return !e.readonly_link && (isCeo || e.created_by === me?.name);
  }

  return (
    <div className="space-y-4">
      {/* 상단: 월 이동 + 추가 */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <button onClick={prevMonth} className="w-8 h-8 rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-500">‹</button>
          <div className="text-lg font-bold text-gray-800 w-32 text-center">{year}년 {month + 1}월</div>
          <button onClick={nextMonthFn} className="w-8 h-8 rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-500">›</button>
          <button onClick={() => { setYear(now.getFullYear()); setMonth(now.getMonth()); }}
            className="ml-1 px-2 py-1 text-xs border border-gray-200 rounded-lg text-gray-500 hover:bg-gray-50">오늘</button>
        </div>
        <button onClick={() => openNew(selectedDay || undefined)}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-medium">+ 일정 등록</button>
      </div>

      {/* 색상 범례 */}
      <div className="flex gap-3 flex-wrap text-xs text-gray-500">
        {[...EVENT_TYPES, '휴가'].map(t => (
          <div key={t} className="flex items-center gap-1.5">
            <span className={`w-2.5 h-2.5 rounded-full ${TYPE_STYLE[t]?.dot}`} />
            {t}{t === '휴가' && <span className="text-gray-300">(결재 연동)</span>}
          </div>
        ))}
      </div>

      {loading ? (
        <div className="text-center py-12 text-gray-400">불러오는 중...</div>
      ) : (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="grid grid-cols-7 border-b border-gray-100">
            {WEEKDAYS.map((w, i) => (
              <div key={w} className={`py-2 text-center text-xs font-medium ${i === 0 ? 'text-red-400' : i === 6 ? 'text-blue-400' : 'text-gray-400'}`}>{w}</div>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {cells.map((date, i) => {
              if (!date) return <div key={i} className="min-h-[110px] border-b border-r border-gray-50 bg-gray-50/30" />;
              const dayEvents = eventsOn(date);
              const dayNum = Number(date.slice(-2));
              const dow = new Date(date).getDay();
              const isToday = date === todayStr;
              return (
                <div key={i}
                  onClick={() => setSelectedDay(date)}
                  className={`min-h-[110px] border-b border-r border-gray-50 p-1.5 cursor-pointer hover:bg-blue-50/30 ${selectedDay === date ? 'bg-blue-50' : ''}`}>
                  <div className={`text-xs font-medium mb-1 ${isToday ? 'bg-blue-600 text-white rounded-full w-5 h-5 flex items-center justify-center' : dow === 0 ? 'text-red-400' : dow === 6 ? 'text-blue-400' : 'text-gray-500'}`}>{dayNum}</div>
                  <div className="space-y-0.5">
                    {dayEvents.slice(0, 3).map((e, idx) => (
                      <div key={idx}
                        onClick={(ev) => { ev.stopPropagation(); canEdit(e) ? openEdit(e) : setSelectedDay(date); }}
                        className={`text-[10px] px-1 py-0.5 rounded truncate ${TYPE_STYLE[e.event_type]?.chip || 'bg-gray-100 text-gray-600'}`}
                        title={e.title}>
                        {!e.all_day && e.start_time ? `${e.start_time} ` : ''}{e.title}
                      </div>
                    ))}
                    {dayEvents.length > 3 && (
                      <div className="text-[10px] text-gray-400 px-1">+{dayEvents.length - 3}건 더</div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 선택한 날짜 상세 */}
      {selectedDay && (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-bold text-gray-800">{selectedDay} 일정</h3>
            <div className="flex items-center gap-2">
              <button onClick={() => openNew(selectedDay)} className="text-xs text-blue-600 hover:underline">+ 이 날 일정 추가</button>
              <button onClick={() => setSelectedDay(null)} className="text-gray-400 text-sm ml-1">✕</button>
            </div>
          </div>
          {eventsOn(selectedDay).length === 0 ? (
            <div className="text-center py-6 text-sm text-gray-400">등록된 일정이 없습니다</div>
          ) : (
            <div className="space-y-2">
              {eventsOn(selectedDay).map((e, idx) => (
                <div key={idx} className="flex items-start gap-3 p-3 rounded-xl border border-gray-100 hover:bg-gray-50">
                  <span className={`mt-1 w-2.5 h-2.5 rounded-full flex-shrink-0 ${TYPE_STYLE[e.event_type]?.dot}`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`text-xs px-2 py-0.5 rounded-md font-medium ${TYPE_STYLE[e.event_type]?.chip}`}>{e.event_type}</span>
                      <span className="font-medium text-gray-800">{e.title}</span>
                    </div>
                    <div className="text-xs text-gray-400 mt-1 space-x-2">
                      <span>
                        {e.start_date}{e.end_date && e.end_date !== e.start_date ? ` ~ ${e.end_date}` : ''}
                        {!e.all_day && e.start_time ? ` · ${e.start_time}${e.end_time ? `~${e.end_time}` : ''}` : ''}
                      </span>
                      {e.created_by && <span>· {e.created_by}</span>}
                    </div>
                    {e.location && <div className="text-xs text-gray-500 mt-0.5">📍 {e.location}</div>}
                    {e.description && <div className="text-xs text-gray-500 mt-0.5">{e.description}</div>}
                  </div>
                  {canEdit(e) && (
                    <div className="flex gap-1 flex-shrink-0">
                      <button onClick={() => openEdit(e)} className="text-xs text-gray-400 hover:text-blue-600">수정</button>
                      <button onClick={() => deleteEvent(e.id)} className="text-xs text-gray-400 hover:text-red-500">삭제</button>
                    </div>
                  )}
                  {e.readonly_link && <span className="text-[10px] text-gray-300 flex-shrink-0">결재연동</span>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 일정 등록/수정 모달 */}
      {showForm && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-6 my-8">
            <h3 className="text-lg font-bold text-gray-800 mb-5">{editId ? '일정 수정' : '일정 등록'}</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1.5">종류</label>
                <div className="flex gap-2 flex-wrap">
                  {EVENT_TYPES.map(t => (
                    <button key={t} onClick={() => setForm({ ...form, event_type: t })}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium ${form.event_type === t ? TYPE_STYLE[t].chip + ' ring-2 ring-offset-1 ring-gray-300' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}>
                      {t}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">제목 *</label>
                <input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })}
                  placeholder="예: 현대백화점 외근, 신제품 라이브 방송"
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">시작일 *</label>
                  <input type="date" value={form.start_date} onChange={e => setForm({ ...form, start_date: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">종료일 (선택)</label>
                  <input type="date" value={form.end_date} min={form.start_date} onChange={e => setForm({ ...form, end_date: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
                </div>
              </div>
              <label className="flex items-center gap-2 text-sm text-gray-600">
                <input type="checkbox" checked={form.all_day} onChange={e => setForm({ ...form, all_day: e.target.checked })} className="accent-blue-600" />
                종일 일정
              </label>
              {!form.all_day && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">시작 시간</label>
                    <input type="time" value={form.start_time} onChange={e => setForm({ ...form, start_time: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">종료 시간</label>
                    <input type="time" value={form.end_time} onChange={e => setForm({ ...form, end_time: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
                  </div>
                </div>
              )}
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">장소 / 온라인 링크</label>
                <input value={form.location} onChange={e => setForm({ ...form, location: e.target.value })}
                  placeholder="예: 강남 코엑스 / https://zoom.us/..."
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">메모</label>
                <textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })}
                  rows={2} placeholder="상세 내용"
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 resize-none" />
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button onClick={saveEvent} disabled={saving}
                className="flex-1 px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-medium disabled:opacity-50">
                {saving ? '저장 중...' : '저장'}
              </button>
              {editId && (
                <button onClick={() => deleteEvent(editId)}
                  className="px-5 py-2.5 border border-red-200 text-red-500 rounded-xl text-sm hover:bg-red-50">삭제</button>
              )}
              <button onClick={() => { setShowForm(false); setEditId(null); setForm({ ...EMPTY_EVENT }); }}
                className="px-5 py-2.5 border border-gray-200 text-gray-600 rounded-xl text-sm hover:bg-gray-50">취소</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
