'use client';

import { useState, useEffect, useCallback } from 'react';
import * as XLSX from 'xlsx';
import { supabaseFetch } from '@/lib/supabase';
import { getUser } from '@/lib/auth';
import {
  Card, CARD_TYPES, CARD_TYPE_COLORS, formatBillingCycle, toISO, logCardChange,
} from '@/lib/cardBilling';

interface CardLog {
  id: string;
  action: string;
  target?: string;
  detail?: string;
  actor?: string;
  created_at: string;
}

// 승인된 지출결의서 중 카드 매입건
interface CardPurchase {
  id: string;
  company: string;
  organizer: string;
  total_amount: number;
  card_id: string;
  payment_due_date: string;
  purchase_status: string;     // normal / canceled
  refund_due_date?: string;
  spend_date?: string;
  purchase_vendor?: string;
}

// 캘린더에 표시할 이벤트 (매입 + / 환불 -)
interface PayEvent {
  date: string;
  cardId: string;
  amount: number;       // + 매입, - 환불
  type: 'charge' | 'refund';
  purchase: CardPurchase;
}

const CARD_COMPANIES = ['현대', '삼성', '신한', '국민', '롯데', '하나', '우리', 'BC', '농협', '기타'];

const EMPTY_CARD = {
  card_name: '', card_type: '법인', holder_name: '', card_company: '현대',
  last4: '', limit_amount: 0, billing_day: 14, close_day: 31,
  benefit_memo: '', is_active: true,
};

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

function ymd(d: Date) { return toISO(d); }
function won(n: number) { return n.toLocaleString(); }

type Tab = 'calendar' | 'cards' | 'log';

export default function CardsContent() {
  const me = getUser();
  const canManage = me?.role === 'ceo' || me?.role === 'admin';
  const canView = canManage || me?.role === 'sales'; // 조회 = 대표·실장·영업(강웅구)

  const [tab, setTab] = useState<Tab>('calendar');
  const [cards, setCards] = useState<Card[]>([]);
  const [purchases, setPurchases] = useState<CardPurchase[]>([]);
  const [logs, setLogs] = useState<CardLog[]>([]);
  const [loading, setLoading] = useState(true);

  // 카드 폼
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState({ ...EMPTY_CARD });
  const [saving, setSaving] = useState(false);

  // 캘린더 상태
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth()); // 0-11
  const [cardFilter, setCardFilter] = useState<string>('all');
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

  const loadCards = useCallback(async () => {
    const res = await supabaseFetch('/cards?order=sort_order.asc,created_at.asc');
    const data = await res.json();
    setCards(Array.isArray(data) ? data : []);
  }, []);

  const loadPurchases = useCallback(async () => {
    const res = await supabaseFetch(
      '/approvals?doc_type=eq.지출결의서&status=eq.approved&card_id=not.is.null' +
      '&select=id,company,organizer,total_amount,card_id,payment_due_date,purchase_status,refund_due_date,spend_date,purchase_vendor'
    );
    const data = await res.json();
    setPurchases(Array.isArray(data) ? data : []);
  }, []);

  const loadLogs = useCallback(async () => {
    const res = await supabaseFetch('/card_logs?order=created_at.desc&limit=200');
    const data = await res.json();
    setLogs(Array.isArray(data) ? data : []);
  }, []);

  useEffect(() => {
    (async () => {
      setLoading(true);
      await Promise.all([loadCards(), loadPurchases(), loadLogs()]);
      setLoading(false);
    })();
  }, [loadCards, loadPurchases, loadLogs]);

  // ── 카드 저장 ──
  async function saveCard() {
    if (!form.card_name.trim()) { alert('카드 별칭을 입력하세요.'); return; }
    setSaving(true);
    try {
      const payload = {
        ...form,
        limit_amount: Number(form.limit_amount) || 0,
        billing_day: Number(form.billing_day) || 1,
        close_day: Number(form.close_day) || 31,
      };
      const detail = `한도 ${(Number(form.limit_amount) || 0).toLocaleString()}원 · 결제일 ${form.billing_day}일 · 마감 ${form.close_day >= 31 ? '말일' : form.close_day + '일'}`;
      if (editId) {
        await supabaseFetch(`/cards?id=eq.${editId}`, {
          method: 'PATCH', headers: { Prefer: 'return=minimal' },
          body: JSON.stringify(payload),
        });
        await logCardChange('카드수정', `[${form.card_type}] ${form.card_name}`, detail, me?.name || '');
      } else {
        await supabaseFetch('/cards', {
          method: 'POST', headers: { Prefer: 'return=minimal' },
          body: JSON.stringify({ ...payload, sort_order: cards.length }),
        });
        await logCardChange('카드등록', `[${form.card_type}] ${form.card_name}`, detail, me?.name || '');
      }
      setShowForm(false);
      setEditId(null);
      setForm({ ...EMPTY_CARD });
      await Promise.all([loadCards(), loadLogs()]);
    } finally { setSaving(false); }
  }

  function openEdit(c: Card) {
    setForm({
      card_name: c.card_name, card_type: c.card_type,
      holder_name: c.holder_name || '', card_company: c.card_company || '현대',
      last4: c.last4 || '', limit_amount: c.limit_amount,
      billing_day: c.billing_day, close_day: c.close_day,
      benefit_memo: c.benefit_memo || '', is_active: c.is_active,
    });
    setEditId(c.id);
    setShowForm(true);
  }

  async function deleteCard(id: string) {
    if (!confirm('카드를 삭제하시겠습니까?')) return;
    const c = cards.find(x => x.id === id);
    await supabaseFetch(`/cards?id=eq.${id}`, { method: 'DELETE' });
    if (c) await logCardChange('카드삭제', `[${c.card_type}] ${c.card_name}`, '', me?.name || '');
    await Promise.all([loadCards(), loadLogs()]);
  }

  // ── 캘린더 이벤트 생성 ──
  const events: PayEvent[] = [];
  for (const p of purchases) {
    if (p.payment_due_date) {
      events.push({ date: p.payment_due_date, cardId: p.card_id, amount: p.total_amount, type: 'charge', purchase: p });
    }
    if (p.purchase_status === 'canceled' && p.refund_due_date) {
      events.push({ date: p.refund_due_date, cardId: p.card_id, amount: -p.total_amount, type: 'refund', purchase: p });
    }
  }
  const filteredEvents = cardFilter === 'all' ? events : events.filter(e => e.cardId === cardFilter);

  // 날짜별 합산
  const byDate: Record<string, PayEvent[]> = {};
  for (const e of filteredEvents) {
    (byDate[e.date] ||= []).push(e);
  }

  // 이번 달 카드별 결제 예정 합계 (net)
  const monthStart = ymd(new Date(year, month, 1));
  const monthEnd = ymd(new Date(year, month + 1, 0));
  function cardMonthTotal(cardId: string): number {
    return events
      .filter(e => e.cardId === cardId && e.date >= monthStart && e.date <= monthEnd)
      .reduce((s, e) => s + e.amount, 0);
  }
  const monthTotalAll = filteredEvents
    .filter(e => e.date >= monthStart && e.date <= monthEnd)
    .reduce((s, e) => s + e.amount, 0);

  // 달력 그리드 구성
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (string | null)[] = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(ymd(new Date(year, month, d)));
  while (cells.length % 7 !== 0) cells.push(null);

  function prevMonth() { if (month === 0) { setYear(year - 1); setMonth(11); } else setMonth(month - 1); setSelectedDay(null); }
  function nextMonthFn() { if (month === 11) { setYear(year + 1); setMonth(0); } else setMonth(month + 1); setSelectedDay(null); }

  const cardName = (id: string) => cards.find(c => c.id === id)?.card_name || '(삭제된 카드)';
  const todayStr = ymd(new Date());

  function exportExcel() {
    const rows = filteredEvents
      .slice()
      .sort((a, b) => a.date.localeCompare(b.date))
      .map(e => ({
        결제예정일: e.date,
        구분: e.type === 'charge' ? '매입' : '환불',
        카드: cardName(e.cardId),
        사업자: e.purchase.company,
        담당: e.purchase.organizer,
        구매처: e.purchase.purchase_vendor || '',
        금액: e.amount,
      }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '카드결제예정');
    XLSX.writeFile(wb, `카드결제예정_${year}-${String(month + 1).padStart(2, '0')}.xlsx`);
  }

  // ── 카드 폼 모달 ──
  const cardFormModal = showForm && (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-6 my-8">
        <h3 className="text-lg font-bold text-gray-800 mb-5">{editId ? '카드 수정' : '카드 등록'}</h3>
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">카드 별칭 *</label>
            <input value={form.card_name} onChange={e => setForm({ ...form, card_name: e.target.value })}
              placeholder="예: 현대 법인카드"
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">종류</label>
              <select value={form.card_type} onChange={e => setForm({ ...form, card_type: e.target.value })}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none">
                {CARD_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">담당자</label>
              <input value={form.holder_name} onChange={e => setForm({ ...form, holder_name: e.target.value })}
                placeholder="예: 방성훈"
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">카드사</label>
              <select value={form.card_company} onChange={e => setForm({ ...form, card_company: e.target.value })}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none">
                {CARD_COMPANIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">끝 4자리</label>
              <input value={form.last4} maxLength={4} onChange={e => setForm({ ...form, last4: e.target.value.replace(/\D/g, '') })}
                placeholder="1234"
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">월 한도 (원)</label>
            <input type="number" value={form.limit_amount || ''} onChange={e => setForm({ ...form, limit_amount: Number(e.target.value) })}
              placeholder="10000000"
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">결제일 (매월)</label>
              <input type="number" min={1} max={31} value={form.billing_day} onChange={e => setForm({ ...form, billing_day: Number(e.target.value) })}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">사용 마감일 (31=말일)</label>
              <input type="number" min={1} max={31} value={form.close_day} onChange={e => setForm({ ...form, close_day: Number(e.target.value) })}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
            </div>
          </div>
          <p className="text-xs text-gray-400">
            {formatBillingCycle({ ...form, id: '', is_active: true } as Card)}
          </p>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">주요 혜택 / 제휴 메모</label>
            <input value={form.benefit_memo} onChange={e => setForm({ ...form, benefit_memo: e.target.value })}
              placeholder="예: GS홈쇼핑 7% 할인"
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
          </div>
          <label className="flex items-center gap-2 text-sm text-gray-600">
            <input type="checkbox" checked={form.is_active} onChange={e => setForm({ ...form, is_active: e.target.checked })} className="accent-blue-600" />
            사용 중인 카드
          </label>
        </div>
        <div className="flex gap-3 mt-6">
          <button onClick={saveCard} disabled={saving}
            className="flex-1 px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-medium disabled:opacity-50">
            {saving ? '저장 중...' : '저장'}
          </button>
          <button onClick={() => { setShowForm(false); setEditId(null); setForm({ ...EMPTY_CARD }); }}
            className="px-5 py-2.5 border border-gray-200 text-gray-600 rounded-xl text-sm hover:bg-gray-50">취소</button>
        </div>
      </div>
    </div>
  );

  if (!canView) {
    return (
      <div className="text-center py-20 text-gray-400">
        <div className="text-3xl mb-2">🔒</div>
        <div className="text-sm">카드·매입은 대표·실장·영업 담당자만 열람할 수 있습니다.</div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* 탭 */}
      <div className="flex items-center gap-2 border-b border-gray-200 pb-3">
        <button onClick={() => setTab('calendar')}
          className={`px-4 py-2 rounded-t-lg text-sm font-medium border-b-2 ${tab === 'calendar' ? 'border-blue-600 text-blue-600 bg-white' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
          결제 캘린더
        </button>
        <button onClick={() => setTab('cards')}
          className={`px-4 py-2 rounded-t-lg text-sm font-medium border-b-2 ${tab === 'cards' ? 'border-blue-600 text-blue-600 bg-white' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
          카드 목록
        </button>
        {canManage && (
          <button onClick={() => setTab('log')}
            className={`px-4 py-2 rounded-t-lg text-sm font-medium border-b-2 ${tab === 'log' ? 'border-blue-600 text-blue-600 bg-white' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
            변경 로그
          </button>
        )}
      </div>

      {loading ? (
        <div className="text-center py-12 text-gray-400">불러오는 중...</div>
      ) : tab === 'cards' ? (
        // ─────────── 카드 목록 ───────────
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <p className="text-sm text-gray-500">법인/개인/대표 카드와 결제 주기를 관리합니다.</p>
            {canManage && (
              <button onClick={() => { setForm({ ...EMPTY_CARD }); setEditId(null); setShowForm(true); }}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-medium">+ 카드 등록</button>
            )}
          </div>

          {cards.length === 0 ? (
            <div className="text-center py-12 text-gray-400 bg-white rounded-2xl border border-gray-100">등록된 카드가 없습니다</div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {cards.map(c => {
                const monthTot = cardMonthTotal(c.id);
                const usePct = c.limit_amount > 0 ? Math.min(100, Math.round(monthTot / c.limit_amount * 100)) : 0;
                return (
                  <div key={c.id} className={`bg-white rounded-2xl shadow-sm border p-5 ${c.is_active ? 'border-gray-100' : 'border-gray-100 opacity-60'}`}>
                    <div className="flex items-start justify-between mb-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className={`text-xs px-2 py-0.5 rounded-md font-medium ${CARD_TYPE_COLORS[c.card_type] || 'bg-gray-100 text-gray-600'}`}>{c.card_type}</span>
                          {!c.is_active && <span className="text-xs text-gray-400">(미사용)</span>}
                        </div>
                        <div className="font-bold text-gray-800 mt-1.5">{c.card_name}</div>
                        <div className="text-xs text-gray-400 mt-0.5">
                          {c.card_company} {c.last4 && `****${c.last4}`} {c.holder_name && `· ${c.holder_name}`}
                        </div>
                      </div>
                      {canManage && (
                        <div className="flex gap-1">
                          <button onClick={() => openEdit(c)} className="text-xs text-gray-400 hover:text-blue-600 px-1">수정</button>
                          <button onClick={() => deleteCard(c.id)} className="text-xs text-gray-400 hover:text-red-500 px-1">삭제</button>
                        </div>
                      )}
                    </div>
                    <div className="text-xs text-gray-500 mb-2">{formatBillingCycle(c)}</div>
                    {c.benefit_memo && <div className="text-xs text-blue-600 bg-blue-50 rounded-lg px-2 py-1 mb-3">💳 {c.benefit_memo}</div>}
                    <div className="border-t border-gray-100 pt-3">
                      <div className="flex justify-between text-xs text-gray-400 mb-1">
                        <span>이번 달 결제예정</span>
                        <span>한도 {c.limit_amount > 0 ? `${won(c.limit_amount)}원` : '미설정'}</span>
                      </div>
                      <div className="font-bold text-gray-800">{won(monthTot)}원</div>
                      {c.limit_amount > 0 && (
                        <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden mt-2">
                          <div className={`h-full rounded-full ${usePct >= 90 ? 'bg-red-400' : usePct >= 70 ? 'bg-orange-400' : 'bg-blue-400'}`} style={{ width: `${usePct}%` }} />
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : tab === 'log' ? (
        // ─────────── 변경 로그 ───────────
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
          {logs.length === 0 ? (
            <div className="text-center py-12 text-gray-400">변경 기록이 없습니다</div>
          ) : (
            <div className="divide-y divide-gray-50">
              {logs.map(l => {
                const color = l.action.includes('삭제') || l.action.includes('취소') ? 'bg-red-50 text-red-600'
                  : l.action.includes('등록') ? 'bg-green-50 text-green-600' : 'bg-blue-50 text-blue-600';
                return (
                  <div key={l.id} className="px-4 py-3 flex items-start gap-3">
                    <span className={`text-xs px-2 py-0.5 rounded-md font-medium flex-shrink-0 ${color}`}>{l.action}</span>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-gray-800">{l.target}</div>
                      {l.detail && <div className="text-xs text-gray-500 mt-0.5">{l.detail}</div>}
                      <div className="text-xs text-gray-400 mt-0.5">
                        {l.actor} · {new Date(l.created_at).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : (
        // ─────────── 결제 캘린더 ───────────
        <div className="space-y-4">
          {/* 카드 필터 + 월 이동 */}
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-2">
              <button onClick={prevMonth} className="w-8 h-8 rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-500">‹</button>
              <div className="text-lg font-bold text-gray-800 w-32 text-center">{year}년 {month + 1}월</div>
              <button onClick={nextMonthFn} className="w-8 h-8 rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-500">›</button>
              <button onClick={() => { setYear(now.getFullYear()); setMonth(now.getMonth()); }}
                className="ml-1 px-2 py-1 text-xs border border-gray-200 rounded-lg text-gray-500 hover:bg-gray-50">오늘</button>
            </div>
            <button onClick={exportExcel} className="px-3 py-1.5 text-xs border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50">📊 엑셀</button>
          </div>

          <div className="flex gap-2 flex-wrap">
            <button onClick={() => setCardFilter('all')}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium ${cardFilter === 'all' ? 'bg-slate-700 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'}`}>전체</button>
            {cards.filter(c => c.is_active).map(c => (
              <button key={c.id} onClick={() => setCardFilter(c.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium ${cardFilter === c.id ? 'bg-slate-700 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'}`}>{c.card_name}</button>
            ))}
          </div>

          {/* 이번 달 합계 */}
          <div className="bg-gradient-to-r from-slate-700 to-slate-600 rounded-2xl p-5 text-white flex items-center justify-between">
            <div>
              <div className="text-xs text-slate-300">{year}년 {month + 1}월 결제 예정 합계 {cardFilter !== 'all' && `· ${cardName(cardFilter)}`}</div>
              <div className="text-2xl font-bold mt-1">{won(monthTotalAll)}원</div>
            </div>
            <div className="text-xs text-slate-300 text-right">매입 − 취소환불<br />상계 금액</div>
          </div>

          {/* 달력 */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="grid grid-cols-7 border-b border-gray-100">
              {WEEKDAYS.map((w, i) => (
                <div key={w} className={`py-2 text-center text-xs font-medium ${i === 0 ? 'text-red-400' : i === 6 ? 'text-blue-400' : 'text-gray-400'}`}>{w}</div>
              ))}
            </div>
            <div className="grid grid-cols-7">
              {cells.map((date, i) => {
                if (!date) return <div key={i} className="min-h-[90px] border-b border-r border-gray-50 bg-gray-50/30" />;
                const dayEvents = byDate[date] || [];
                const dayTotal = dayEvents.reduce((s, e) => s + e.amount, 0);
                const dayNum = Number(date.slice(-2));
                const dow = new Date(date).getDay();
                const isToday = date === todayStr;
                return (
                  <div key={i}
                    onClick={() => dayEvents.length && setSelectedDay(selectedDay === date ? null : date)}
                    className={`min-h-[90px] border-b border-r border-gray-50 p-1.5 ${dayEvents.length ? 'cursor-pointer hover:bg-blue-50/40' : ''} ${selectedDay === date ? 'bg-blue-50' : ''}`}>
                    <div className={`text-xs font-medium ${isToday ? 'bg-blue-600 text-white rounded-full w-5 h-5 flex items-center justify-center' : dow === 0 ? 'text-red-400' : dow === 6 ? 'text-blue-400' : 'text-gray-500'}`}>{dayNum}</div>
                    {dayEvents.length > 0 && (
                      <div className="mt-1 space-y-0.5">
                        <div className={`text-xs font-bold ${dayTotal < 0 ? 'text-red-500' : 'text-gray-700'}`}>{won(dayTotal)}</div>
                        <div className="text-[10px] text-gray-400">{dayEvents.length}건</div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* 선택한 날짜 상세 */}
          {selectedDay && byDate[selectedDay] && (
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-bold text-gray-800">{selectedDay} 결제 상세</h3>
                <button onClick={() => setSelectedDay(null)} className="text-gray-400 text-sm">✕</button>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-gray-400 border-b border-gray-100">
                    <th className="py-2 text-left font-medium">구분</th>
                    <th className="py-2 text-left font-medium">카드</th>
                    <th className="py-2 text-left font-medium">사업자</th>
                    <th className="py-2 text-left font-medium">담당</th>
                    <th className="py-2 text-left font-medium">구매처</th>
                    <th className="py-2 text-right font-medium">금액</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {byDate[selectedDay].map((e, idx) => (
                    <tr key={idx}>
                      <td className="py-2">
                        <span className={`text-xs px-2 py-0.5 rounded-md font-medium ${e.type === 'refund' ? 'bg-red-50 text-red-500' : 'bg-blue-50 text-blue-600'}`}>
                          {e.type === 'refund' ? '환불' : '매입'}
                        </span>
                      </td>
                      <td className="py-2 text-gray-600">{cardName(e.cardId)}</td>
                      <td className="py-2 text-gray-500">{e.purchase.company}</td>
                      <td className="py-2 text-gray-500">{e.purchase.organizer}</td>
                      <td className="py-2 text-gray-500">{e.purchase.purchase_vendor || '-'}</td>
                      <td className={`py-2 text-right font-medium ${e.amount < 0 ? 'text-red-500' : 'text-gray-700'}`}>{won(e.amount)}원</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t border-gray-200 font-bold">
                    <td colSpan={5} className="py-2 text-xs text-gray-400">합계 (상계)</td>
                    <td className="py-2 text-right text-gray-800">{won(byDate[selectedDay].reduce((s, e) => s + e.amount, 0))}원</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}

          {cards.length === 0 && (
            <div className="text-center py-6 text-sm text-gray-400">
              먼저 <button onClick={() => setTab('cards')} className="text-blue-600 underline">카드 목록</button>에서 카드를 등록하세요.
            </div>
          )}
        </div>
      )}

      {cardFormModal}
    </div>
  );
}
