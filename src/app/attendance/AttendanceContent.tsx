'use client';

import { useState, useEffect } from 'react';
import { supabaseFetch } from '@/lib/supabase';
import { getUser } from '@/lib/auth';
import * as XLSX from 'xlsx';

// 아이테코 좌표 (경기도 하남시 조정대로 150)
// 2026-06-24 사무실 현장 GPS 실측으로 보정 (방기현 대표 단말, 오차 11m)
const OFFICE_LAT = 37.554137;
const OFFICE_LNG = 127.195859;
const ALLOWED_RADIUS_M = 500; // 500m 이내 (정확한 중심점 + GPS 오차 보정으로 전 직원 안정 통과)
const LOW_ACCURACY_M = 500;   // GPS 정확도가 이보다 나쁘면(실내 등) 위치 신뢰 불가 → 차단하지 않음

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
  check_in_device?: string;   // 'pc' | 'mobile'
  check_out_device?: string;  // 'pc' | 'mobile'
  status: string;
  memo?: string;
  created_by?: string;
}

// 출퇴근을 누른 기기 표시 (PC / 모바일)
function DeviceTag({ d }: { d?: string }) {
  if (d !== 'pc' && d !== 'mobile') return null;
  const mobile = d === 'mobile';
  return (
    <span className={`ml-1 text-[11px] px-1.5 py-0.5 rounded font-medium align-middle ${mobile ? 'bg-indigo-50 text-indigo-500' : 'bg-gray-100 text-gray-500'}`}>
      {mobile ? '📱모바일' : '🖥PC'}
    </span>
  );
}
const deviceText = (d?: string) => d === 'mobile' ? '모바일' : d === 'pc' ? 'PC' : '';

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
  const [locStatus, setLocStatus] = useState<'idle' | 'checking' | 'ok' | 'far' | 'lowacc' | 'denied' | 'unavailable'>('idle');
  const [distance, setDistance] = useState<number | null>(null);
  const [accuracy, setAccuracy] = useState<number | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  // 목록 필터 — 기본 조회는 오늘(필요 시 기간을 넓혀서 조회)
  const [dateFrom, setDateFrom] = useState(today);
  const [dateTo, setDateTo] = useState(today);
  const [filterCompany, setFilterCompany] = useState('전체');
  const [filterName, setFilterName] = useState('');

  // 관리자 수동 입력
  const [showManual, setShowManual] = useState(false);
  const [manualForm, setManualForm] = useState({ ...EMPTY_MANUAL });
  const [manualSaving, setManualSaving] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);

  // 일괄 선택 (상태 수정·삭제)
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  const [bulkStatus, setBulkStatus] = useState('');
  const [bulkSaving, setBulkSaving] = useState(false);

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
    finally { setLoading(false); setCheckedIds(new Set()); }
  }

  const isMobile = typeof navigator !== 'undefined' && /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);

  function getPosition(opts: PositionOptions): Promise<GeolocationPosition> {
    return new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(resolve, reject, opts);
    });
  }

  async function checkLocation(): Promise<GeolocationPosition | null> {
    // PC에서는 위치 확인 없이 바로 통과
    if (!isMobile) {
      setLocStatus('ok');
      return { coords: { latitude: OFFICE_LAT, longitude: OFFICE_LNG, accuracy: 0, altitude: null, altitudeAccuracy: null, heading: null, speed: null }, timestamp: Date.now() } as GeolocationPosition;
    }
    if (!navigator.geolocation) { setLocStatus('denied'); return null; }
    setLocStatus('checking');

    let pos: GeolocationPosition;
    try {
      // 1차: 고정밀 시도 (최근 60초 내 잡은 위치는 재사용 허용 → 실내 지연 완화)
      pos = await getPosition({ enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 });
    } catch (e1) {
      // 권한 거부면 즉시 안내, 그 외(시간초과·위치불가)는 저정밀도로 재시도
      if ((e1 as GeolocationPositionError)?.code === 1) { setLocStatus('denied'); return null; }
      try {
        pos = await getPosition({ enableHighAccuracy: false, timeout: 12000, maximumAge: 120000 });
      } catch (e2) {
        setLocStatus((e2 as GeolocationPositionError)?.code === 1 ? 'denied' : 'unavailable');
        return null;
      }
    }

    const dist = getDistanceM(pos.coords.latitude, pos.coords.longitude, OFFICE_LAT, OFFICE_LNG);
    const acc = pos.coords.accuracy || 0;
    setDistance(Math.round(dist));
    setAccuracy(Math.round(acc));

    // ① 반경 안 → 통과
    if (dist <= ALLOWED_RADIUS_M) { setLocStatus('ok'); return pos; }
    // ② GPS 정확도가 낮으면(실내 등 기지국/IP 추정) 위치를 신뢰할 수 없음 → 차단하지 않고 통과 (위치는 기록됨)
    if (acc > LOW_ACCURACY_M) { setLocStatus('lowacc'); return pos; }
    // ③ 정확도는 좋은데 반경 밖 → 진짜 멀리 있음 → 차단
    setLocStatus('far');
    return null;
  }

  async function handleCheckIn() {
    setActionLoading(true);
    try {
      const pos = await checkLocation();
      if (!pos) { setActionLoading(false); return; }
      const nowDate = new Date();
      const now = nowDate.toISOString();
      // 출근 기준 09:30 — 09:30까지 정상, 09:31부터 지각
      const minsOfDay = nowDate.getHours() * 60 + nowDate.getMinutes();
      const isLate = minsOfDay > (9 * 60 + 30);
      // 오늘 반차/연차가 이미 등록된 경우 지각 처리 안 함
      const exempted = todayRecord && NO_LATE_STATUSES.has(todayRecord.status);
      const status = exempted ? todayRecord!.status : (isLate ? 'late' : 'normal');

      if (todayRecord) {
        // 이미 레코드 있으면 출근 시간 업데이트 (반차/연차 포함, 수정 케이스)
        await supabaseFetch(`/attendance?id=eq.${todayRecord.id}`, {
          method: 'PATCH',
          headers: { Prefer: 'return=minimal' },
          body: JSON.stringify({
            check_in: now, status,
            check_in_lat: pos.coords.latitude, check_in_lng: pos.coords.longitude,
            check_in_device: isMobile ? 'mobile' : 'pc',
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
            check_in_device: isMobile ? 'mobile' : 'pc',
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
          check_out_device: isMobile ? 'mobile' : 'pc',
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

  function toggleCheck(id: string) {
    setCheckedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function toggleAll() {
    if (checkedIds.size === records.length) setCheckedIds(new Set());
    else setCheckedIds(new Set(records.map((r) => r.id)));
  }

  // 선택 항목 일괄 상태 변경
  async function handleBulkStatus() {
    if (!bulkStatus || checkedIds.size === 0) return;
    const label = STATUS_LABELS[bulkStatus]?.label || bulkStatus;
    if (!confirm(`선택한 ${checkedIds.size}건의 상태를 "${label}"(으)로 변경할까요?`)) return;
    setBulkSaving(true);
    try {
      await Promise.all([...checkedIds].map((id) =>
        supabaseFetch(`/attendance?id=eq.${id}`, {
          method: 'PATCH',
          headers: { Prefer: 'return=minimal' },
          body: JSON.stringify({ status: bulkStatus }),
        })
      ));
      setBulkStatus('');
      await loadRecords();
      await loadTodayRecord();
    } finally { setBulkSaving(false); }
  }

  // 선택 항목 일괄 삭제
  async function handleBulkDelete() {
    if (checkedIds.size === 0) return;
    if (!confirm(`선택한 ${checkedIds.size}건의 출퇴근 기록을 삭제할까요?`)) return;
    setBulkSaving(true);
    try {
      await Promise.all([...checkedIds].map((id) =>
        supabaseFetch(`/attendance?id=eq.${id}`, { method: 'DELETE' })
      ));
      await loadRecords();
      await loadTodayRecord();
    } finally { setBulkSaving(false); }
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
      출근기기: deviceText(r.check_in_device),
      퇴근: formatTime(r.check_out),
      퇴근기기: deviceText(r.check_out_device),
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
            className={`px-4 py-2 rounded-lg text-base font-medium transition-colors ${tab === t ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
            {label}
          </button>
        ))}
      </div>

      {/* 내 출퇴근 탭 */}
      {tab === 'checkin' && (
        <div className="max-w-sm mx-auto space-y-4">
          {/* 날짜 + 이름 */}
          <div className="text-center">
            <div className="text-base text-gray-400">{new Date().toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' })}</div>
            <div className="text-2xl font-bold text-gray-800 mt-1">{me?.name}</div>
            <div className="text-base text-gray-400">{me?.company}</div>
          </div>

          {/* 실시간 시계 */}
          <div className="text-center">
            <div className="text-5xl font-bold text-gray-800 tracking-widest tabular-nums">{clock}</div>
          </div>

          {/* 오늘 출퇴근 현황 */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
            <div className="grid grid-cols-2 gap-4 mb-4">
              <div className="text-center bg-blue-50 rounded-xl py-3">
                <div className="text-sm text-blue-400 mb-1">출근</div>
                <div className={`text-xl font-bold ${checkedIn ? 'text-blue-600' : 'text-gray-300'}`}>
                  {checkedIn ? formatTime(todayRecord?.check_in) : '--:--'}
                </div>
              </div>
              <div className="text-center bg-orange-50 rounded-xl py-3">
                <div className="text-sm text-orange-400 mb-1">퇴근</div>
                <div className={`text-xl font-bold ${checkedOut ? 'text-orange-500' : 'text-gray-300'}`}>
                  {checkedOut ? formatTime(todayRecord?.check_out) : '--:--'}
                </div>
              </div>
            </div>

            {todayRecord && (
              <div className="text-center mb-4 space-y-1">
                <span className={`text-sm px-2 py-1 rounded-md font-medium ${STATUS_LABELS[todayRecord.status]?.color || 'bg-gray-100 text-gray-600'}`}>
                  {STATUS_LABELS[todayRecord.status]?.label || todayRecord.status}
                </span>
                {NO_LATE_STATUSES.has(todayRecord.status) && (
                  <div className="text-sm text-purple-500">휴가/반차 적용 — 지각 처리 제외</div>
                )}
              </div>
            )}

            {/* 위치 상태 */}
            {locStatus === 'checking' && <div className="text-center text-base text-blue-500 mb-3">위치 확인 중...</div>}
            {locStatus === 'lowacc' && (
              <div className="text-center text-base text-amber-600 mb-3 bg-amber-50 rounded-xl py-2">
                GPS 신호가 약해 위치를 정확히 못 잡았어요<br />
                <span className="text-sm text-amber-500">
                  실내 추정이라 출퇴근은 진행됩니다 (위치 기록됨)
                  {accuracy !== null && ` · GPS 오차 약 ${accuracy}m`}
                </span>
              </div>
            )}
            {locStatus === 'far' && distance !== null && (
              <div className="text-center text-base text-red-500 mb-3 bg-red-50 rounded-xl py-2">
                회사에서 {distance}m 떨어져 있습니다.<br />
                <span className="text-sm text-red-400">
                  {ALLOWED_RADIUS_M}m 이내에서만 가능합니다
                  {accuracy !== null && accuracy > 100 && ` · GPS 오차 약 ${accuracy}m`}
                </span>
              </div>
            )}
            {locStatus === 'denied' && (
              <div className="text-center text-base text-red-500 mb-3 bg-red-50 rounded-xl py-2">
                위치 권한을 허용해주세요<br />
                <span className="text-sm text-red-400">브라우저 설정에서 이 사이트의 위치 권한을 허용으로 바꿔주세요</span>
              </div>
            )}
            {locStatus === 'unavailable' && (
              <div className="text-center text-base text-red-500 mb-3 bg-red-50 rounded-xl py-2">
                위치를 잡지 못했습니다<br />
                <span className="text-sm text-red-400">실내에서는 신호가 약할 수 있어요. 창가나 실외에서 다시 눌러주세요</span>
              </div>
            )}

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
            <p className="text-center text-sm text-gray-400">아이테코 {ALLOWED_RADIUS_M}m 이내에서만 가능합니다</p>
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
                  className="text-base text-gray-700 focus:outline-none bg-transparent" />
                <span className="text-gray-400 text-base">~</span>
                <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)}
                  className="text-base text-gray-700 focus:outline-none bg-transparent" />
              </div>
              {[
                { label: '오늘', from: today, to: today },
                { label: '이번주', from: (() => { const d = new Date(); d.setDate(d.getDate() - d.getDay() + 1); return toLocalDateString(d); })(), to: today },
                { label: '이번달', from: firstOfMonth, to: today },
              ].map((p) => (
                <button key={p.label} onClick={() => { setDateFrom(p.from); setDateTo(p.to); }}
                  className="px-3 py-2 rounded-xl text-base font-medium bg-white border border-gray-200 text-gray-600 hover:bg-gray-50">
                  {p.label}
                </button>
              ))}
              {COMPANIES.map((c) => (
                <button key={c} onClick={() => setFilterCompany(c)}
                  className={`px-3 py-2 rounded-xl text-base font-medium transition-colors ${filterCompany === c ? 'bg-slate-700 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
                  {c}
                </button>
              ))}
              <input value={filterName} onChange={(e) => setFilterName(e.target.value)}
                placeholder="이름 검색"
                className="px-3 py-2 border border-gray-200 rounded-xl text-base focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white w-28" />
            </div>
            <div className="flex gap-2">
              <button onClick={exportExcel}
                className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-xl text-base font-medium">
                엑셀 다운로드
              </button>
              {canManageAtt && (
                <button onClick={() => { setManualForm({ ...EMPTY_MANUAL }); setEditId(null); setShowManual(true); }}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-base font-medium">
                  + 수동 입력
                </button>
              )}
            </div>
          </div>

          {/* 일괄 변경 바 */}
          {canManageAtt && checkedIds.size > 0 && (
            <div className="flex items-center gap-3 bg-blue-600 text-white px-5 py-3 rounded-xl flex-wrap">
              <span className="text-base font-medium flex-shrink-0">{checkedIds.size}건 선택됨</span>
              <div className="flex items-center gap-2 ml-auto flex-wrap">
                <span className="text-base text-blue-200 flex-shrink-0">상태 변경:</span>
                <select value={bulkStatus} onChange={(e) => setBulkStatus(e.target.value)}
                  className="px-3 py-1.5 rounded-lg text-base text-gray-800 bg-white border-0 focus:outline-none">
                  <option value="">선택</option>
                  {Object.entries(STATUS_LABELS).map(([v, { label }]) => <option key={v} value={v}>{label}</option>)}
                </select>
                <button onClick={handleBulkStatus} disabled={!bulkStatus || bulkSaving}
                  className="px-4 py-1.5 bg-white text-blue-600 rounded-lg text-base font-medium disabled:opacity-50 hover:bg-blue-50 transition-colors">
                  {bulkSaving ? '처리 중...' : '적용'}
                </button>
                <button onClick={handleBulkDelete} disabled={bulkSaving}
                  className="px-4 py-1.5 bg-red-500 text-white rounded-lg text-base font-medium disabled:opacity-50 hover:bg-red-600 transition-colors">
                  삭제
                </button>
                <button onClick={() => { setCheckedIds(new Set()); setBulkStatus(''); }}
                  className="px-3 py-1.5 bg-blue-500 rounded-lg text-base hover:bg-blue-400 transition-colors">
                  취소
                </button>
              </div>
            </div>
          )}

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
                  <table className="w-full text-base">
                    <thead className="bg-gray-50 border-b border-gray-100">
                      <tr>
                        {canManageAtt && (
                          <th className="px-4 py-3">
                            <input type="checkbox"
                              checked={records.length > 0 && checkedIds.size === records.length}
                              onChange={toggleAll}
                              className="w-4 h-4 rounded border-gray-300 text-blue-600 cursor-pointer" />
                          </th>
                        )}
                        {['날짜', '이름', '사업자', '출근', '퇴근', '근무시간', '상태', ...(canManageAtt ? [''] : [])].map((h, i) => (
                          <th key={i} className="px-4 py-3 text-left text-sm font-medium text-gray-500">{h}</th>
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
                          <tr key={r.id} className={`hover:bg-gray-50 ${checkedIds.has(r.id) ? 'bg-blue-50' : ''}`}>
                            {canManageAtt && (
                              <td className="px-4 py-3">
                                <input type="checkbox"
                                  checked={checkedIds.has(r.id)}
                                  onChange={() => toggleCheck(r.id)}
                                  className="w-4 h-4 rounded border-gray-300 text-blue-600 cursor-pointer" />
                              </td>
                            )}
                            <td className="px-4 py-3 text-gray-700">{r.work_date}</td>
                            <td className="px-4 py-3 font-medium text-gray-800">{r.employee_name}</td>
                            <td className="px-4 py-3 text-gray-500">{r.company}</td>
                            <td className="px-4 py-3 text-blue-600 font-medium whitespace-nowrap">{formatTime(r.check_in)}<DeviceTag d={r.check_in_device} /></td>
                            <td className="px-4 py-3 text-orange-500 font-medium whitespace-nowrap">{formatTime(r.check_out)}<DeviceTag d={r.check_out_device} /></td>
                            <td className="px-4 py-3 text-gray-600">{workHour}</td>
                            <td className="px-4 py-3">
                              <span className={`text-sm px-2 py-0.5 rounded-md font-medium ${st.color}`}>{st.label}</span>
                            </td>
                            {canManageAtt && (
                              <td className="px-4 py-3">
                                <div className="flex gap-2">
                                  <button onClick={() => openEdit(r)} className="text-sm text-blue-400 hover:text-blue-600 hover:underline">수정</button>
                                  <button onClick={() => handleDelete(r.id)} className="text-sm text-red-400 hover:text-red-600 hover:underline">삭제</button>
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
                      <div key={r.id} className={`px-4 py-3.5 flex items-start gap-3 ${checkedIds.has(r.id) ? 'bg-blue-50' : ''}`}>
                        {canManageAtt && (
                          <input type="checkbox"
                            checked={checkedIds.has(r.id)}
                            onChange={() => toggleCheck(r.id)}
                            className="w-4 h-4 mt-1 rounded border-gray-300 text-blue-600 cursor-pointer flex-shrink-0" />
                        )}
                        <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2 mb-1.5">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="font-bold text-gray-800 text-[15px]">{r.employee_name}</span>
                            <span className="text-sm text-gray-400 truncate">{r.company}</span>
                          </div>
                          <span className={`text-sm px-2 py-0.5 rounded-md font-medium flex-shrink-0 ${st.color}`}>{st.label}</span>
                        </div>
                        <div className="text-sm text-gray-400 mb-1">{r.work_date}</div>
                        <div className="flex items-center gap-4 text-base">
                          <span className="text-blue-600 font-medium">출근 {formatTime(r.check_in)}<DeviceTag d={r.check_in_device} /></span>
                          <span className="text-orange-500 font-medium">퇴근 {formatTime(r.check_out)}<DeviceTag d={r.check_out_device} /></span>
                          <span className="text-gray-500">{workHour}</span>
                        </div>
                        {canManageAtt && (
                          <div className="flex gap-3 mt-2">
                            <button onClick={() => openEdit(r)} className="text-sm text-blue-500 font-medium">수정</button>
                            <button onClick={() => handleDelete(r.id)} className="text-sm text-red-500 font-medium">삭제</button>
                          </div>
                        )}
                        </div>
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
                  <label className="block text-sm font-medium text-gray-600 mb-1">이름 *</label>
                  <input value={manualForm.employee_name} onChange={(e) => setManualForm({ ...manualForm, employee_name: e.target.value })}
                    placeholder="직원 이름"
                    className="w-full px-3 py-2 border border-gray-200 rounded-xl text-base focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-600 mb-1">사업자</label>
                  <select value={manualForm.company} onChange={(e) => setManualForm({ ...manualForm, company: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-200 rounded-xl text-base focus:outline-none focus:ring-2 focus:ring-blue-500">
                    {COMPANIES.filter(c => c !== '전체').map(c => <option key={c}>{c}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-600 mb-1">날짜 *</label>
                <input type="date" value={manualForm.work_date} onChange={(e) => setManualForm({ ...manualForm, work_date: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-200 rounded-xl text-base focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-600 mb-1">출근 시간</label>
                  <input type="time" value={manualForm.check_in} onChange={(e) => setManualForm({ ...manualForm, check_in: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-200 rounded-xl text-base focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-600 mb-1">퇴근 시간</label>
                  <input type="time" value={manualForm.check_out} onChange={(e) => setManualForm({ ...manualForm, check_out: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-200 rounded-xl text-base focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-600 mb-1">상태</label>
                <select value={manualForm.status} onChange={(e) => setManualForm({ ...manualForm, status: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-200 rounded-xl text-base focus:outline-none focus:ring-2 focus:ring-blue-500">
                  {Object.entries(STATUS_LABELS).map(([v, { label }]) => <option key={v} value={v}>{label}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-600 mb-1">메모</label>
                <input value={manualForm.memo} onChange={(e) => setManualForm({ ...manualForm, memo: e.target.value })}
                  placeholder="비고"
                  className="w-full px-3 py-2 border border-gray-200 rounded-xl text-base focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
            </div>
            <div className="flex gap-3 mt-5">
              <button onClick={handleManualSave} disabled={manualSaving || !manualForm.employee_name.trim()}
                className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white rounded-xl text-base font-medium">
                {manualSaving ? '저장 중...' : '저장'}
              </button>
              <button onClick={() => { setShowManual(false); setEditId(null); }}
                className="px-5 py-2.5 bg-white border border-gray-200 text-gray-600 rounded-xl text-base hover:bg-gray-50">
                취소
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
