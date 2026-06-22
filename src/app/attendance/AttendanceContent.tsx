'use client';

import { useState, useEffect } from 'react';
import { supabaseFetch } from '@/lib/supabase';
import { getUser } from '@/lib/auth';
import * as XLSX from 'xlsx';

// 아이테코 좌표 (경기도 하남시 조정대로 150)
const OFFICE_LAT = 37.5443;
const OFFICE_LNG = 127.2066;
const ALLOWED_RADIUS_M = 300; // 300m 이내

interface AttendanceRecord {
  id: string;
  employee_id?: string;
  employee_name: string;
  company: string;
  work_date: string;
  check_in?: string;
  check_out?: string;
  check_in_lat?: number;
  check_in_lng?: number;
  check_out_lat?: number;
  check_out_lng?: number;
  status: string;
  memo?: string;
  created_by?: string;
}

const COMPANIES = ['전체', '더블아이', 'BNKNET', 'SJ글로벌', 'IX글로벌'];
const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  normal: { label: '정상', color: 'bg-green-100 text-green-700' },
  late: { label: '지각', color: 'bg-orange-100 text-orange-700' },
  early_leave: { label: '조퇴', color: 'bg-yellow-100 text-yellow-700' },
  absent: { label: '결근', color: 'bg-red-100 text-red-700' },
  half_am: { label: '오전반차', color: 'bg-purple-100 text-purple-700' },
  half_pm: { label: '오후반차', color: 'bg-purple-100 text-purple-700' },
  annual: { label: '연차', color: 'bg-blue-100 text-blue-700' },
};

// 지각 자동 판정 제외 상태
const NO_LATE_STATUSES = new Set(['half_am', 'half_pm', 'annual']);

function getDistanceM(lat1: number, lng1: number, lat2: number, lng2: number) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function formatTime(iso?: string) {
  if (!iso) return '-';
  return new Date(iso).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
}

function toLocalDateString(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

const EMPTY_MANUAL = {
  employee_name: '', company: 'BNKNET', work_date: toLocalDateString(),
  check_in: '', check_out: '', status: 'normal', memo: '',
};

export default function AttendanceContent() {
  const me = getUser();
  const isCeo = me?.role === 'ceo';
  const canManageAtt = isCeo || me?.role === 'admin'; // 수동입력·수정·삭제 = 대표·실장

  const today = toLocalDateString();
  const firstOfMonth = today.slice(0, 7) + '-01';

  const [tab, setTab] = useState<'checkin' | 'list'>('checkin');
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [todayRecord, setTodayRecord] = useState<AttendanceRecord | null>(null);
  const [loading, setLoading] = useState(false);
  const [locStatus, setLocStatus] = useState<'idle' | 'checking' | 'ok' | 'far' | 'denied'>('idle');
  const [distance, setDistance] = useState<number | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  // 목록 필터
  const [dateFrom, setDateFrom] = useState(firstOfMonth);
  const [dateTo, setDateTo] = useState(today);
  const [filterCompany, setFilterCompany] = useState('전체');
  const [filterName, setFilterName] = useState('');

  // 관리자 수동 입력
  const [showManual, setShowManual] = useState(false);
  const [manualForm, setManualForm] = useState({ ...EMPTY_MANUAL });
  const [manualSaving, setManualSaving] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);

  useEffect(() => {
    loadTodayRecord();
    if (tab === 'list') loadRecords();
  }, [tab]);

  useEffect(() => {
    if (tab === 'list') loadRecords();
  }, [dateFrom, dateTo, filterCompany, filterName]);

  async function loadTodayRecord() {
    if (!me) return;
    const res = await supabaseFetch(`/attendance?employee_name=eq.${encodeURIComponent(me.name)}&work_date=eq.${today}&order=created_at.desc&limit=1`);
    const data = await res.json();
    setTodayRecord(Array.isArray(data) && data.length > 0 ? data[0] : null);
  }

  async function loadRecords() {
    setLoading(true);
    try {
      let query = `/attendance?work_date=gte.${dateFrom}&work_date=lte.${dateTo}&order=work_date.desc,check_in.desc`;
      if (filterCompany !== '전체') query += `&company=eq.${encodeURIComponent(filterCompany)}`;
      if (filterName.trim()) query += `&employee_name=ilike.*${encodeURIComponent(filterName.trim())}*`;
      const res = await supabaseFetch(query);
      const data = await res.json();
      setRecords(Array.isArray(data) ? data : []);
    } catch { setRecords([]); }
    finally { setLoading(false); }
  }

  const isMobile = typeof navigator !== 'undefined' && /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);

  async function checkLocation(): Promise<GeolocationPosition | null> {
    // PC에서는 위치 확인 없이 바로 통과
    if (!isMobile) {
      setLocStatus('ok');
      return { coords: { latitude: OFFICE_LAT, longitude: OFFICE_LNG, accuracy: 0, altitude: null, altitudeAccuracy: null, heading: null, speed: null }, timestamp: Date.now() } as GeolocationPosition;
    }
    return new Promise((resolve) => {
      if (!navigator.geolocation) { setLocStatus('denied'); resolve(null); return; }
      setLocStatus('checking');
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const dist = getDistanceM(pos.coords.latitude, pos.coords.longitude, OFFICE_LAT, OFFICE_LNG);
          setDistance(Math.round(dist));
          if (dist <= ALLOWED_RADIUS_M) { setLocStatus('ok'); resolve(pos); }
          else { setLocStatus('far'); resolve(null); }
        },
        () => { setLocStatus('denied'); resolve(null); },
        { enableHighAccuracy: true, timeout: 10000 }
      );
    });
  }

  async function handleCheckIn() {
    setActionLoading(true);
    try {
      const pos = await checkLocation();
      if (!pos) { setActionLoading(false); return; }
      const now = new Date().toISOString();
      const checkInHour = new Date().getHours();
      // 오늘 반차/연차가 이미 등록된 경우 지각 처리 안 함
      const exempted = todayRecord && NO_LATE_STATUSES.has(todayRecord.status);
      const status = exempted ? todayRecord!.status : (checkInHour >= 9 ? 'late' : 'normal');

      if (todayRecord) {
        // 이미 레코드 있으면 출근 시간 업데이트 (반차/연차 포함, 수정 케이스)
        await supabaseFetch(`/attendance?id=eq.${todayRecord.id}`, {
          method: 'PATCH',
          headers: { Prefer: 'return=minimal' },
          body: JSON.stringify({
            check_in: now, status,
            check_in_lat: pos.coords.latitude, check_in_lng: pos.coords.longitude,
          }),
        });
      } else {
        await supabaseFetch('/attendance', {
          method: 'POST',
          headers: { Prefer: 'return=minimal' },
          body: JSON.stringify({
            employee_name: me?.name, company: me?.company || 'BNKNET',
            work_date: today, check_in: now, status,
            check_in_lat: pos.coords.latitude, check_in_lng: pos.coords.longitude,
          }),
        });
      }
      await loadTodayRecord();
      setMessage('오늘 하루도 응원합니다 💪');
      setTimeout(() => setMessage(''), 4000);
    } finally { setActionLoading(false); }
  }

  async function handleCheckOut() {
    if (!todayRecord) return;
    setActionLoading(true);
    try {
      const pos = await checkLocation();
      if (!pos) { setActionLoading(false); return; }
      const now = new Date().toISOString();
      await supabaseFetch(`/attendance?id=eq.${todayRecord.id}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({
          check_out: now,
          check_out_lat: pos.coords.latitude, check_out_lng: pos.coords.longitude,
        }),
      });
      await loadTodayRecord();
      setMessage('오늘 하루도 수고했어요 🌙');
      setTimeout(() => setMessage(''), 4000);
    } finally { setActionLoading(false); }
  }

  async function handleManualSave() {
    if (!manualForm.employee_name.trim() || !manualForm.work_date) return;
    setManualSaving(true);
    try {
      const payload = {
        employee_name: manualForm.employee_name,
        company: manualForm.company,
        work_date: manualForm.work_date,
        check_in: manualForm.check_in ? `${manualForm.work_date}T${manualForm.check_in}:00+09:00` : null,
        check_out: manualForm.check_out ? `${manualForm.work_date}T${manualForm.check_out}:00+09:00` : null,
        status: manualForm.status,
        memo: manualForm.memo,
        created_by: me?.name,
      };
      let res;
      if (editId) {
        res = await supabaseFetch(`/attendance?id=eq.${editId}`, {
          method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(payload),
        });
      } else {
        res = await supabaseFetch('/attendance', {
          method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(payload),
        });
      }
      if (!res.ok) { alert('저장 실패'); return; }
      setShowManual(false);
      setEditId(null);
      setManualForm({ ...EMPTY_MANUAL });
      await loadRecords();
      await loadTodayRecord();
    } finally { setManualSaving(false); }
  }

  async function handleDelete(id: string) {
    if (!confirm('출퇴근 기록을 삭제하시겠습니까?')) return;
    await supabaseFetch(`/attendance?id=eq.${id}`, { method: 'DELETE' });
    await loadRecords();
    await loadTodayRecord();
  }

  function openEdit(rec: AttendanceRecord) {
    setManualForm({
      employee_name: rec.employee_name,
      company: rec.company,
      work_date: rec.work_date,
      check_in: rec.check_in ? new Date(rec.check_in).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false }) : '',
      check_out: rec.check_out ? new Date(rec.check_out).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false }) : '',
      status: rec.status || 'normal',
      memo: rec.memo || '',
    });
    setEditId(rec.id);
    setShowManual(true);
  }

  function exportExcel() {
    const data = records.map((r) => ({
      날짜: r.work_date,
      이름: r.employee_name,
      사업자: r.company,
      출근: formatTime(r.check_in),
      퇴근: formatTime(r.check_out),
      상태: STATUS_LABELS[r.status]?.label || r.status,
      메모: r.memo || '',
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '출퇴근');
    XLSX.writeFile(wb, `출퇴근_${dateFrom}_${dateTo}.xlsx`);
  }

  const checkedIn = !!todayRecord?.check_in;
  const checkedOut = !!todayRecord?.check_out;
  const [message, setMessage] = useState('');
  const [clock, setClock] = useState('');
  useEffect(() => {
    const tick = () => setClock(new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="space-y-4">
      {/* 탭 */}
      <div className="flex gap-1 bg-gray-100 rounded-xl p-1 w-fit">
        {([['checkin', '내 출퇴근'], ['list', '전체 내역']] as const).map(([t, label]) => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${tab === t ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
            {label}
          </button>
        ))}
      </div>

      {/* 내 출퇴근 탭 */}
      {tab === 'checkin' && (
        <div className="max-w-sm mx-auto space-y-4">
          {/* 날짜 + 이름 */}
          <div className="text-center">
            <div className="text-sm text-gray-400">{new Date().toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' })}</div>
            <div className="text-2xl font-bold text-gray-800 mt-1">{me?.name}</div>
            <div className="text-sm text-gray-400">{me?.company}</div>
          </div>

          {/* 실시간 시계 */}
          <div className="text-center">
            <div className="text-5xl font-bold text-gray-800 tracking-widest tabular-nums">{clock}</div>
          </div>

          {/* 오늘 출퇴근 현황 */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
            <div className="grid grid-cols-2 gap-4 mb-4">
              <div className="text-center bg-blue-50 rounded-xl py-3">
                <div className="text-xs text-blue-400 mb-1">출근</div>
                <div className={`text-xl font-bold ${checkedIn ? 'text-blue-600' : 'text-gray-300'}`}>
                  {checkedIn ? formatTime(todayRecord?.check_in) : '--:--'}
                </div>
              </div>
              <div className="text-center bg-orange-50 rounded-xl py-3">
                <div className="text-xs text-orange-400 mb-1">퇴근</div>
                <div className={`text-xl font-bold ${checkedOut ? 'text-orange-500' : 'text-gray-300'}`}>
                  {checkedOut ? formatTime(todayRecord?.check_out) : '--:--'}
                </div>
              </div>
            </div>

            {todayRecord && (
              <div className="text-center mb-4 space-y-1">
                <span className={`text-xs px-2 py-1 rounded-md font-medium ${STATUS_LABELS[todayRecord.status]?.color || 'bg-gray-100 text-gray-600'}`}>
                  {STATUS_LABELS[todayRecord.status]?.label || todayRecord.status}
                </span>
                {NO_LATE_STATUSES.has(todayRecord.status) && (
                  <div className="text-xs text-purple-500">휴가/반차 적용 — 지각 처리 제외</div>
                )}
              </div>
            )}

            {/* 위치 상태 */}
            {locStatus === 'checking' && <div className="text-center text-sm text-blue-500 mb-3">위치 확인 중...</div>}
            {locStatus === 'far' && distance !== null && (
              <div className="text-center text-sm text-red-500 mb-3 bg-red-50 rounded-xl py-2">
                회사에서 {distance}m 떨어져 있습니다.<br />
                <span className="text-xs text-red-400">{ALLOWED_RADIUS_M}m 이내에서만 가능합니다</span>
              </div>
            )}
            {locStatus === 'denied' && <div className="text-center text-sm text-red-500 mb-3 bg-red-50 rounded-xl py-2">위치 권한을 허용해주세요</div>}

            {/* 출근 / 퇴근 버튼 — 항상 표시, 재클릭 시 시간 업데이트 */}
            <div className="grid grid-cols-2 gap-3">
              <button onClick={handleCheckIn} disabled={actionLoading}
                className={`py-4 rounded-xl font-bold text-lg transition-colors ${checkedIn ? 'bg-blue-100 text-blue-600 hover:bg-blue-200' : 'bg-blue-600 text-white hover:bg-blue-700 shadow-md shadow-blue-500/20'} disabled:opacity-50`}>
                {actionLoading ? '...' : checkedIn ? '출근 수정' : '출근'}
              </button>
              <button onClick={handleCheckOut} disabled={actionLoading || !checkedIn}
                className={`py-4 rounded-xl font-bold text-lg transition-colors ${checkedOut ? 'bg-orange-100 text-orange-500 hover:bg-orange-200' : 'bg-orange-500 text-white hover:bg-orange-600 shadow-md shadow-orange-500/20'} disabled:opacity-40`}>
                {actionLoading ? '...' : checkedOut ? '퇴근 수정' : '퇴근'}
              </button>
            </div>

            {message && (
              <div className="text-center pt-3 text-gray-700 font-medium animate-pulse">{message}</div>
            )}
          </div>

          {isMobile && (
            <p className="text-center text-xs text-gray-400">아이테코 {ALLOWED_RADIUS_M}m 이내에서만 가능합니다</p>
          )}
        </div>
      )}

      {/* 전체 내역 탭 */}
      {tab === 'list' && (
        <>
          {/* 필터 */}
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2 flex-wrap">
              <div className="flex items-center gap-1.5 bg-white border border-gray-200 rounded-xl px-3 py-2">
                <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)}
                  className="text-sm text-gray-700 focus:outline-none bg-transparent" />
                <span className="text-gray-400 text-sm">~</span>
                <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)}
                  className="text-sm text-gray-700 focus:outline-none bg-transparent" />
              </div>
              {[
                { label: '오늘', from: today, to: today },
                { label: '이번주', from: (() => { const d = new Date(); d.setDate(d.getDate() - d.getDay() + 1); return toLocalDateString(d); })(), to: today },
                { label: '이번달', from: firstOfMonth, to: today },
              ].map((p) => (
                <button key={p.label} onClick={() => { setDateFrom(p.from); setDateTo(p.to); }}
                  className="px-3 py-2 rounded-xl text-sm font-medium bg-white border border-gray-200 text-gray-600 hover:bg-gray-50">
                  {p.label}
                </button>
              ))}
              {COMPANIES.map((c) => (
                <button key={c} onClick={() => setFilterCompany(c)}
                  className={`px-3 py-2 rounded-xl text-sm font-medium transition-colors ${filterCompany === c ? 'bg-slate-700 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
                  {c}
                </button>
              ))}
              <input value={filterName} onChange={(e) => setFilterName(e.target.value)}
                placeholder="이름 검색"
                className="px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white w-28" />
            </div>
            <div className="flex gap-2">
              <button onClick={exportExcel}
                className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-xl text-sm font-medium">
                엑셀 다운로드
              </button>
              {canManageAtt && (
                <button onClick={() => { setManualForm({ ...EMPTY_MANUAL }); setEditId(null); setShowManual(true); }}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-medium">
                  + 수동 입력
                </button>
              )}
            </div>
          </div>

          {/* 테이블 */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
            {loading ? (
              <div className="text-center py-12 text-gray-400">불러오는 중...</div>
            ) : records.length === 0 ? (
              <div className="text-center py-12 text-gray-400">출퇴근 기록이 없습니다</div>
            ) : (
              <>
                {/* 데스크탑: 표 */}
                <div className="overflow-x-auto hidden sm:block">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 border-b border-gray-100">
                      <tr>
                        {['날짜', '이름', '사업자', '출근', '퇴근', '근무시간', '상태', ...(canManageAtt ? [''] : [])].map((h) => (
                          <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-500">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {records.map((r) => {
                        const workMin = r.check_in && r.check_out
                          ? Math.round((new Date(r.check_out).getTime() - new Date(r.check_in).getTime()) / 60000)
                          : null;
                        const workHour = workMin !== null ? `${Math.floor(workMin / 60)}h ${workMin % 60}m` : '-';
                        const st = STATUS_LABELS[r.status] || { label: r.status, color: 'bg-gray-100 text-gray-600' };
                        return (
                          <tr key={r.id} className="hover:bg-gray-50">
                            <td className="px-4 py-3 text-gray-700">{r.work_date}</td>
                            <td className="px-4 py-3 font-medium text-gray-800">{r.employee_name}</td>
                            <td className="px-4 py-3 text-gray-500">{r.company}</td>
                            <td className="px-4 py-3 text-blue-600 font-medium">{formatTime(r.check_in)}</td>
                            <td className="px-4 py-3 text-orange-500 font-medium">{formatTime(r.check_out)}</td>
                            <td className="px-4 py-3 text-gray-600">{workHour}</td>
                            <td className="px-4 py-3">
                              <span className={`text-xs px-2 py-0.5 rounded-md font-medium ${st.color}`}>{st.label}</span>
                            </td>
                            {canManageAtt && (
                              <td className="px-4 py-3">
                                <div className="flex gap-2">
                                  <button onClick={() => openEdit(r)} className="text-xs text-blue-400 hover:text-blue-600 hover:underline">수정</button>
                                  <button onClick={() => handleDelete(r.id)} className="text-xs text-red-400 hover:text-red-600 hover:underline">삭제</button>
                                </div>
                              </td>
                            )}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* 모바일: 카드형 */}
                <div className="sm:hidden divide-y divide-gray-100">
                  {records.map((r) => {
                    const workMin = r.check_in && r.check_out
                      ? Math.round((new Date(r.check_out).getTime() - new Date(r.check_in).getTime()) / 60000)
                      : null;
                    const workHour = workMin !== null ? `${Math.floor(workMin / 60)}h ${workMin % 60}m` : '-';
                    const st = STATUS_LABELS[r.status] || { label: r.status, color: 'bg-gray-100 text-gray-600' };
                    return (
                      <div key={r.id} className="px-4 py-3.5">
                        <div className="flex items-center justify-between gap-2 mb-1.5">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="font-bold text-gray-800 text-[15px]">{r.employee_name}</span>
                            <span className="text-xs text-gray-400 truncate">{r.company}</span>
                          </div>
                          <span className={`text-xs px-2 py-0.5 rounded-md font-medium flex-shrink-0 ${st.color}`}>{st.label}</span>
                        </div>
                        <div className="text-xs text-gray-400 mb-1">{r.work_date}</div>
                        <div className="flex items-center gap-4 text-sm">
                          <span className="text-blue-600 font-medium">출근 {formatTime(r.check_in)}</span>
                          <span className="text-orange-500 font-medium">퇴근 {formatTime(r.check_out)}</span>
                          <span className="text-gray-500">{workHour}</span>
                        </div>
                        {canManageAtt && (
                          <div className="flex gap-3 mt-2">
                            <button onClick={() => openEdit(r)} className="text-xs text-blue-500 font-medium">수정</button>
                            <button onClick={() => handleDelete(r.id)} className="text-xs text-red-500 font-medium">삭제</button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        </>
      )}

      {/* 수동 입력 모달 */}
      {showManual && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
            <h3 className="text-lg font-bold text-gray-800 mb-4">{editId ? '출퇴근 수정' : '수동 입력'}</h3>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">이름 *</label>
                  <input value={manualForm.employee_name} onChange={(e) => setManualForm({ ...manualForm, employee_name: e.target.value })}
                    placeholder="직원 이름"
                    className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">사업자</label>
                  <select value={manualForm.company} onChange={(e) => setManualForm({ ...manualForm, company: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                    {COMPANIES.filter(c => c !== '전체').map(c => <option key={c}>{c}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">날짜 *</label>
                <input type="date" value={manualForm.work_date} onChange={(e) => setManualForm({ ...manualForm, work_date: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">출근 시간</label>
                  <input type="time" value={manualForm.check_in} onChange={(e) => setManualForm({ ...manualForm, check_in: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">퇴근 시간</label>
                  <input type="time" value={manualForm.check_out} onChange={(e) => setManualForm({ ...manualForm, check_out: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">상태</label>
                <select value={manualForm.status} onChange={(e) => setManualForm({ ...manualForm, status: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                  {Object.entries(STATUS_LABELS).map(([v, { label }]) => <option key={v} value={v}>{label}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">메모</label>
                <input value={manualForm.memo} onChange={(e) => setManualForm({ ...manualForm, memo: e.target.value })}
                  placeholder="비고"
                  className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
            </div>
            <div className="flex gap-3 mt-5">
              <button onClick={handleManualSave} disabled={manualSaving || !manualForm.employee_name.trim()}
                className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white rounded-xl text-sm font-medium">
                {manualSaving ? '저장 중...' : '저장'}
              </button>
              <button onClick={() => { setShowManual(false); setEditId(null); }}
                className="px-5 py-2.5 bg-white border border-gray-200 text-gray-600 rounded-xl text-sm hover:bg-gray-50">
                취소
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
