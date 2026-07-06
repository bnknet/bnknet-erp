'use client';

import { useState, useEffect, useCallback } from 'react';
import * as XLSX from 'xlsx';
import { supabaseFetch, supabaseFetchAll } from '@/lib/supabase';
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
  is_card_payment?: boolean;
}

interface PurchaseItem {
  id?: string;
  approval_id?: string;
  item_date?: string;
  description?: string;
  quantity?: number;
  amount?: number;
  note?: string;
  canceled?: boolean;
  refund_due_date?: string;
}

// 캘린더에 표시할 이벤트 (매입 + / 환불 -)
interface PayEvent {
  date: string;
  cardId: string;
  amount: number;       // + 매입, - 환불/선결제
  type: 'charge' | 'refund' | 'prepay';
  purchase: CardPurchase;
}

const CARD_COMPANIES = ['현대', '삼성', '신한', '국민', '롯데', '하나', '우리', 'BC', '농협', '기타'];

const EMPTY_CARD = {
  card_name: '', card_type: '법인카드', holder_name: '', card_company: '현대',
  last4: '', limit_amount: 0, opening_balance: 0, billing_day: 14, close_day: 31,
  benefit_memo: '', is_active: true,
};

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

function ymd(d: Date) { return toISO(d); }
function won(n: number) { return n.toLocaleString(); }

type Tab = 'calendar' | 'limit' | 'cards' | 'log';

export default function CardsContent() {
  const me = getUser();
  const canManage = me?.role === 'ceo' || me?.role === 'admin'; // 등록·수정·삭제 = 대표·실장
  const canView = !!me; // 조회 = 전 직원

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
  const [typeFilter, setTypeFilter] = useState<string>('all'); // 사업자(카드종류)별 필터
  const [detailEvent, setDetailEvent] = useState<PayEvent | null>(null);
  const [detailItems, setDetailItems] = useState<PurchaseItem[]>([]);
  const [cancelChecked, setCancelChecked] = useState<Set<string>>(new Set());
  const [cancelRefundDate, setCancelRefundDate] = useState('');
  const [canceledItems, setCanceledItems] = useState<PurchaseItem[]>([]); // 취소된 항목(환불 이벤트용)
  const [rangeFrom, setRangeFrom] = useState('');
  const [rangeTo, setRangeTo] = useState('');
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  // 선결제 처리 (미결제 매입을 골라 앞당겨 결제 → 한도 복구)
  const [prepayOpen, setPrepayOpen] = useState(false);
  const [prepayChecked, setPrepayChecked] = useState<Set<string>>(new Set());
  const [prepayDate, setPrepayDate] = useState('');
  const [prepaySaving, setPrepaySaving] = useState(false);

  const loadCards = useCallback(async () => {
    const res = await supabaseFetch('/cards?order=sort_order.asc,created_at.asc');
    const data = await res.json();
    setCards(Array.isArray(data) ? data : []);
  }, []);

  const loadPurchases = useCallback(async () => {
    // 카드 매입은 계속 누적 → 1000건 넘어도 전부 가져오기
    const data = await supabaseFetchAll<CardPurchase>(
      '/approvals?doc_type=in.(지출결의서,카드구매)&status=eq.approved&card_id=not.is.null' +
      '&select=id,company,organizer,total_amount,card_id,payment_due_date,purchase_status,refund_due_date,spend_date,purchase_vendor,is_card_payment&order=payment_due_date.asc'
    );
    setPurchases(data);
    // 취소된 항목(부분취소 포함) — 환불 이벤트/한도 계산용
    const cData = await supabaseFetchAll<PurchaseItem & { approval_id?: string }>('/approval_items?canceled=eq.true&select=id,approval_id,amount,refund_due_date,description&order=approval_id.asc');
    setCanceledItems(cData);
  }, []);

  const loadLogs = useCallback(async () => {
    const res = await supabaseFetch('/card_logs?order=created_at.desc&limit=200');
    const data = await res.json();
    setLogs(Array.isArray(data) ? data : []);
  }, []);

  async function deleteLog(l: CardLog) {
    const isCancelLog = l.action.includes('취소');
    const msg = isCancelLog
      ? '이 로그를 삭제하면 기록만 지워집니다.\n⚠️ 실제 매입 취소(환불·한도)는 되돌아가지 않습니다.\n취소를 되돌리려면 결재 문서나 결제 캘린더에서 "취소 철회"를 사용하세요.\n\n그래도 로그를 삭제하시겠습니까?'
      : '이 변경 로그를 삭제하시겠습니까?';
    if (!confirm(msg)) return;
    await supabaseFetch(`/card_logs?id=eq.${l.id}`, { method: 'DELETE' });
    await loadLogs();
  }

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
        opening_balance: Number(form.opening_balance) || 0,
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
      last4: c.last4 || '', limit_amount: c.limit_amount, opening_balance: c.opening_balance || 0,
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

  const purchaseById = (id: string) => purchases.find(p => p.id === id);
  // 매입별 취소금액 합 (부분취소 포함)
  const canceledAmtByPurchase: Record<string, number> = {};
  for (const ci of canceledItems) {
    if (ci.approval_id) canceledAmtByPurchase[ci.approval_id] = (canceledAmtByPurchase[ci.approval_id] || 0) + (ci.amount || 0);
  }

  // ── 캘린더 이벤트 생성 ──
  const events: PayEvent[] = [];
  for (const p of purchases) {
    if (p.is_card_payment) {
      // 선결제(결제·한도복구) → 실제 선결제한 날(지출일) 기준 표시, 없으면 결제예정일
      const d = p.spend_date || p.payment_due_date;
      if (d) events.push({ date: d, cardId: p.card_id, amount: -(p.total_amount || 0), type: 'prepay', purchase: p });
    } else if (p.payment_due_date) {
      events.push({ date: p.payment_due_date, cardId: p.card_id, amount: p.total_amount, type: 'charge', purchase: p });
    }
  }
  // 환불 이벤트 = 취소된 항목별 (부분취소 지원)
  for (const ci of canceledItems) {
    const p = ci.approval_id ? purchaseById(ci.approval_id) : null;
    if (p && ci.refund_due_date && ci.amount) {
      events.push({ date: ci.refund_due_date, cardId: p.card_id, amount: -(ci.amount || 0), type: 'refund', purchase: p });
    }
  }

  async function openPurchaseDetail(e: PayEvent) {
    setDetailEvent(e);
    setDetailItems([]);
    setCancelChecked(new Set());
    setCancelRefundDate(todayStr);
    const res = await supabaseFetch(`/approval_items?approval_id=eq.${e.purchase.id}&order=sort_order.asc`);
    const d = await res.json();
    setDetailItems(Array.isArray(d) ? d : []);
  }

  // 선택 항목 부분 취소
  async function cancelSelectedItems() {
    if (!detailEvent || cancelChecked.size === 0) { alert('취소할 항목을 선택하세요.'); return; }
    if (!cancelRefundDate) { alert('환불 예정일을 입력하세요.'); return; }
    const ids = Array.from(cancelChecked);
    const nowIso = new Date().toISOString();
    for (const id of ids) {
      await supabaseFetch(`/approval_items?id=eq.${id}`, {
        method: 'PATCH', headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ canceled: true, refund_due_date: cancelRefundDate, canceled_at: nowIso }),
      });
    }
    // 매입 상태 갱신 (전체취소/부분취소/정상)
    const totalCnt = detailItems.length;
    const canceledCnt = detailItems.filter(it => it.canceled || cancelChecked.has(it.id || '')).length;
    const status = canceledCnt === 0 ? 'normal' : canceledCnt >= totalCnt ? 'canceled' : 'partial';
    await supabaseFetch(`/approvals?id=eq.${detailEvent.purchase.id}`, {
      method: 'PATCH', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ purchase_status: status, canceled_at: nowIso }),
    });
    const amt = detailItems.filter(it => cancelChecked.has(it.id || '')).reduce((s, it) => s + (it.amount || 0), 0);
    await logCardChange('매입취소', `${detailEvent.purchase.company} ${detailEvent.purchase.purchase_vendor || ''}`,
      `부분취소 ${cancelChecked.size}건 -${amt.toLocaleString()}원 · 환불예정 ${cancelRefundDate}`, me?.name || '');
    setDetailEvent(null);
    await loadPurchases();
  }

  const cardTypeOf = (id: string) => cards.find(c => c.id === id)?.card_type || '';
  // 사업자(카드종류)별로 사용되는 종류 목록 (CARD_TYPES 지정 순서대로)
  const usedTypes = CARD_TYPES.filter(t => cards.some(c => c.card_type === t));
  const filteredEvents = typeFilter === 'all' ? events : events.filter(e => cardTypeOf(e.cardId) === typeFilter);
  // 기간 조회 결과
  const rangeEvents = (rangeFrom && rangeTo)
    ? filteredEvents.filter(e => e.date >= rangeFrom && e.date <= rangeTo).slice().sort((a, b) => a.date.localeCompare(b.date))
    : [];
  const rangeTotal = rangeEvents.reduce((s, e) => s + e.amount, 0);

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
  // 담당자(홀더) + 카드명 — 어떤 담당자의 어떤 카드인지 명확히
  const cardLabel = (id: string) => {
    const c = cards.find(x => x.id === id);
    if (!c) return '(삭제된 카드)';
    return `${c.holder_name ? c.holder_name + ' · ' : ''}${c.card_name}`;
  };
  const todayStr = ymd(new Date());

  // ── 한도 현황 계산 ──
  // 카드별 미결제 = (결제일 안 지난 매입 − 취소금액) − 선결제(승인 즉시 한도 복구).
  function cardOutstanding(cardId: string): number {
    return purchases
      .filter(p => p.card_id === cardId)
      .reduce((s, p) => {
        if (p.is_card_payment) return s - (p.total_amount || 0); // 선결제 = 한도 복구(크레딧), 즉시 반영
        if (p.payment_due_date && p.payment_due_date >= todayStr) return s + (p.total_amount - (canceledAmtByPurchase[p.id] || 0)); // 미결제 매입
        return s;
      }, 0);
  }
  // 한도 그룹 묶기 (limit_group 같으면 한도 공유, 없으면 카드 단독)
  const limitGroups = (() => {
    const seen = new Set<string>();
    const groups: { key: string; limit: number; cards: Card[] }[] = [];
    for (const c of cards) {
      const key = c.limit_group || c.id;
      if (seen.has(key)) {
        groups.find(g => g.key === key)!.cards.push(c);
      } else {
        seen.add(key);
        groups.push({ key, limit: c.limit_amount, cards: [c] });
      }
    }
    return groups.map(g => {
      const erpUsed = g.cards.reduce((s, c) => s + cardOutstanding(c.id), 0);
      const hasOpening = g.cards.some(c => c.opening_balance != null);
      const opening = g.cards.reduce((s, c) => s + (c.opening_balance || 0), 0);
      // 사용액 = (전체한도 − 6/30 실잔여) + ERP 미결제분.
      // 잔여한도는 6/30 실잔여에서 출발해 결재가 쌓일수록 더 차감됨.
      const pastUsed = hasOpening ? Math.max(0, g.limit - opening) : 0;
      const used = Math.max(0, Math.min(g.limit, pastUsed + erpUsed)); // 선결제 크레딧으로 음수 되면 0(=전액 복구)

      return { ...g, used, erpUsed, opening, hasOpening, remaining: g.limit - used };
    });
  })();
  // 상단 요약은 선택한 사업자 필터(typeFilter)에 맞춰 집계
  const visibleGroups = limitGroups.filter(g => typeFilter === 'all' || g.cards.some(c => c.card_type === typeFilter));
  const totalLimit = visibleGroups.reduce((s, g) => s + g.limit, 0);
  const totalUsed = visibleGroups.reduce((s, g) => s + g.used, 0);

  // 폰에서 엑셀 없이 바로 보는 표 뷰 (엑셀 앱 호환 문제 회피 — 화면 + 인쇄/PDF)
  const [tableView, setTableView] = useState<{ title: string; subtitle?: string; headers: string[]; rows: string[][] } | null>(null);
  const fmtWon = (n: number) => (Number(n) || 0).toLocaleString('ko-KR') + '원';

  function exportExcel() {
    const rows = filteredEvents
      .slice()
      .sort((a, b) => a.date.localeCompare(b.date))
      .map(e => ({
        결제예정일: e.date,
        구분: e.type === 'charge' ? '매입' : e.type === 'prepay' ? '선결제' : '환불',
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

  // 세무사 전달용 — 카드 구매내역 전체 엑셀 (결재로 등록된 카드구매)
  function exportPurchaseExcel() {
    const rows = purchases
      .slice()
      .sort((a, b) => (a.spend_date || '').localeCompare(b.spend_date || ''))
      .map(p => ({
        구매일: p.spend_date || '',
        사업자: p.company,
        카드: cardName(p.card_id),
        구매처: p.purchase_vendor || '',
        담당: p.organizer || '',
        금액: p.total_amount,
        결제예정일: p.payment_due_date || '',
        상태: p.purchase_status === 'canceled' ? '취소' : p.purchase_status === 'partial' ? '부분취소' : '정상',
      }));
    if (!rows.length) { alert('내보낼 카드 구매내역이 없습니다.'); return; }
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '카드구매내역');
    XLSX.writeFile(wb, `카드구매내역_세무_${todayStr}.xlsx`);
  }

  // 📄 보기 — 카드 결제예정을 폰에서 바로 (엑셀 앱 불필요)
  function viewSchedule() {
    const rows = filteredEvents.slice().sort((a, b) => a.date.localeCompare(b.date)).map(e => [
      e.date,
      e.type === 'charge' ? '매입' : e.type === 'prepay' ? '선결제' : '환불',
      cardName(e.cardId),
      e.purchase.company,
      e.purchase.organizer,
      e.purchase.purchase_vendor || '',
      fmtWon(e.amount),
    ]);
    if (!rows.length) { alert('해당 월 결제예정 내역이 없습니다.'); return; }
    setTableView({ title: `카드 결제예정 · ${year}년 ${month + 1}월`, subtitle: `${rows.length}건`, headers: ['결제예정일', '구분', '카드', '사업자', '담당', '구매처', '금액'], rows });
  }

  // 📄 보기 — 카드 구매내역(세무)을 폰에서 바로
  function viewPurchase() {
    const rows = purchases.slice().sort((a, b) => (a.spend_date || '').localeCompare(b.spend_date || '')).map(p => [
      p.spend_date || '',
      p.company,
      cardName(p.card_id),
      p.purchase_vendor || '',
      p.organizer || '',
      fmtWon(p.total_amount),
      p.payment_due_date || '',
      p.purchase_status === 'canceled' ? '취소' : p.purchase_status === 'partial' ? '부분취소' : '정상',
    ]);
    if (!rows.length) { alert('카드 구매내역이 없습니다.'); return; }
    setTableView({ title: '카드 구매내역 (세무)', subtitle: `${rows.length}건 · ${todayStr}`, headers: ['구매일', '사업자', '카드', '구매처', '담당', '금액', '결제예정일', '상태'], rows });
  }

  // 폰에서 바로 보이는 표 모달 (+ 인쇄/PDF). 엑셀이 안 열리는 기기 대응.
  const tableViewModal = tableView && (
    <div className="fixed inset-0 bg-black/40 z-[60] flex items-end sm:items-center justify-center sm:p-4">
      <div className="bg-white w-full sm:max-w-3xl rounded-t-2xl sm:rounded-2xl shadow-xl max-h-[92vh] flex flex-col">
        <div className="no-print flex items-center justify-between gap-2 px-4 py-3 border-b border-gray-100">
          <div className="min-w-0">
            <div className="font-bold text-gray-800 truncate">{tableView.title}</div>
            {tableView.subtitle && <div className="text-xs text-gray-400">{tableView.subtitle}</div>}
          </div>
          <div className="flex gap-2 flex-shrink-0">
            <button onClick={() => window.print()} className="px-3 py-1.5 text-sm bg-slate-700 hover:bg-slate-800 text-white rounded-lg whitespace-nowrap">🖨️ 인쇄·PDF</button>
            <button onClick={() => setTableView(null)} className="px-3 py-1.5 text-sm border border-gray-200 text-gray-600 rounded-lg">닫기</button>
          </div>
        </div>
        <div id="card-view-print" className="overflow-auto p-4">
          <div className="hidden print:block text-lg font-bold mb-2">{tableView.title} <span className="text-sm font-normal text-gray-500">{tableView.subtitle}</span></div>
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-gray-50">
                {tableView.headers.map(h => <th key={h} className="border border-gray-300 px-2 py-1.5 text-left whitespace-nowrap font-semibold text-gray-600">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {tableView.rows.map((r, i) => (
                <tr key={i}>
                  {r.map((c, j) => <td key={j} className={`border border-gray-200 px-2 py-1.5 whitespace-nowrap text-gray-700 ${tableView.headers[j] === '금액' ? 'text-right tabular-nums' : ''}`}>{c}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <style>{`@media print { body * { visibility: hidden !important; } #card-view-print, #card-view-print * { visibility: visible !important; } #card-view-print { position: absolute; left: 0; top: 0; width: 100%; padding: 0 !important; } .no-print { display: none !important; } }`}</style>
    </div>
  );

  // ── 선결제 처리 ── 미결제 매입(결제일 안 지난 카드구매)을 골라 앞당겨 결제 → 결제예정일을 선결제일로 → 한도 복구
  const prepayCandidates = purchases.filter(p =>
    !p.is_card_payment
    && !!p.payment_due_date && p.payment_due_date >= todayStr
    && p.purchase_status !== 'canceled'
    && (typeFilter === 'all' || cardTypeOf(p.card_id) === typeFilter),
  ).sort((a, b) => (a.payment_due_date || '').localeCompare(b.payment_due_date || ''));
  const prepayTotal = prepayCandidates.filter(p => prepayChecked.has(p.id)).reduce((s, p) => s + (p.total_amount || 0), 0);
  const togglePrepay = (id: string) => setPrepayChecked(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  async function processPrepay() {
    if (!prepayDate || prepayChecked.size === 0) return;
    setPrepaySaving(true);
    try {
      for (const id of prepayChecked) {
        await supabaseFetch(`/approvals?id=eq.${id}`, {
          method: 'PATCH', headers: { Prefer: 'return=minimal' },
          body: JSON.stringify({ payment_due_date: prepayDate, updated_at: new Date().toISOString() }),
        });
      }
      await logCardChange('선결제처리', `${prepayChecked.size}건 · ${won(prepayTotal)}원`, `결제예정일 → ${prepayDate} 로 앞당겨 결제(한도복구)`, me?.name || '').catch(() => {});
      setPrepayOpen(false);
      setPrepayChecked(new Set());
      await loadPurchases();
    } catch (e) { alert('선결제 처리 중 오류: ' + ((e as Error)?.message || e)); }
    finally { setPrepaySaving(false); }
  }
  const prepayModal = prepayOpen && (
    <div className="fixed inset-0 bg-black/40 z-[60] flex items-end sm:items-center justify-center sm:p-4">
      <div className="bg-white w-full sm:max-w-2xl rounded-t-2xl sm:rounded-2xl shadow-xl max-h-[92vh] flex flex-col">
        <div className="px-5 py-4 border-b border-gray-100">
          <h3 className="text-lg font-bold text-gray-800">💚 선결제 처리 (한도 복구)</h3>
          <p className="text-sm text-gray-400 mt-0.5">앞당겨 결제한 매입 건을 골라 결제일을 넣으면, 그 날짜로 결제 처리되어 <b>잔여한도가 복구</b>됩니다. (별도 선결제 결재 안 올려도 됨 — 이중복구 없음)</p>
        </div>
        <div className="px-5 py-3 border-b border-gray-100 flex items-center gap-2 flex-wrap">
          <label className="text-sm font-medium text-gray-600">선결제일(실제 결제일)</label>
          <input type="date" value={prepayDate} onChange={e => setPrepayDate(e.target.value)}
            className="px-3 py-2 border border-gray-200 rounded-lg text-base" />
          <span className="text-sm text-gray-500 ml-auto">선택 <b className="text-green-600">{prepayChecked.size}</b>건 · {won(prepayTotal)}원</span>
        </div>
        <div className="overflow-auto flex-1 divide-y divide-gray-50">
          {prepayCandidates.length === 0 ? (
            <div className="text-center py-12 text-gray-400">선결제할 미결제 매입이 없습니다</div>
          ) : prepayCandidates.map(p => (
            <label key={p.id} className="flex items-center gap-3 px-5 py-3 cursor-pointer hover:bg-green-50/40">
              <input type="checkbox" checked={prepayChecked.has(p.id)} onChange={() => togglePrepay(p.id)} className="w-4 h-4 accent-green-600 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-base text-gray-800 font-medium truncate">{cardName(p.card_id)} · {p.purchase_vendor || '구매'}</div>
                <div className="text-xs text-gray-400">결제예정 {p.payment_due_date} · {p.company}</div>
              </div>
              <div className="text-base font-semibold text-gray-700 tabular-nums flex-shrink-0">{won(p.total_amount)}원</div>
            </label>
          ))}
        </div>
        <div className="px-5 py-4 border-t border-gray-100 flex gap-2">
          <button onClick={processPrepay} disabled={prepaySaving || prepayChecked.size === 0 || !prepayDate}
            className="flex-1 px-5 py-2.5 bg-green-600 hover:bg-green-700 disabled:bg-green-300 text-white rounded-xl text-base font-bold">{prepaySaving ? '처리 중...' : `선결제 처리 (${prepayChecked.size}건)`}</button>
          <button onClick={() => setPrepayOpen(false)} className="px-5 py-2.5 border border-gray-200 text-gray-600 rounded-xl text-base hover:bg-gray-50">닫기</button>
        </div>
      </div>
    </div>
  );

  // ── 카드 폼 모달 ──
  const cardFormModal = showForm && (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-6 my-8">
        <h3 className="text-lg font-bold text-gray-800 mb-5">{editId ? '카드 수정' : '카드 등록'}</h3>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-500 mb-1">카드 별칭 *</label>
            <input value={form.card_name} onChange={e => setForm({ ...form, card_name: e.target.value })}
              placeholder="예: 현대 법인카드"
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-base focus:outline-none focus:ring-2 focus:ring-blue-400" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-500 mb-1">종류</label>
              <select value={form.card_type} onChange={e => setForm({ ...form, card_type: e.target.value })}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-base focus:outline-none">
                {CARD_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-500 mb-1">담당자</label>
              <input value={form.holder_name} onChange={e => setForm({ ...form, holder_name: e.target.value })}
                placeholder="예: 방성훈"
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-base focus:outline-none focus:ring-2 focus:ring-blue-400" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-500 mb-1">카드사</label>
              <select value={form.card_company} onChange={e => setForm({ ...form, card_company: e.target.value })}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-base focus:outline-none">
                {CARD_COMPANIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-500 mb-1">끝 4자리</label>
              <input value={form.last4} maxLength={4} onChange={e => setForm({ ...form, last4: e.target.value.replace(/\D/g, '') })}
                placeholder="1234"
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-base focus:outline-none focus:ring-2 focus:ring-blue-400" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-500 mb-1">전체 한도 (원)</label>
              <input type="number" value={form.limit_amount || ''} onChange={e => setForm({ ...form, limit_amount: Number(e.target.value) })}
                placeholder="50000000"
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-base focus:outline-none focus:ring-2 focus:ring-blue-400" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-500 mb-1">6/30 잔여한도 (참고)</label>
              <input type="number" value={form.opening_balance || ''} onChange={e => setForm({ ...form, opening_balance: Number(e.target.value) })}
                placeholder="15000000"
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-base focus:outline-none focus:ring-2 focus:ring-blue-400" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-500 mb-1">결제일 (매월)</label>
              <input type="number" min={1} max={31} value={form.billing_day} onChange={e => setForm({ ...form, billing_day: Number(e.target.value) })}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-base focus:outline-none focus:ring-2 focus:ring-blue-400" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-500 mb-1">사용 마감일 (31=말일)</label>
              <input type="number" min={1} max={31} value={form.close_day} onChange={e => setForm({ ...form, close_day: Number(e.target.value) })}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-base focus:outline-none focus:ring-2 focus:ring-blue-400" />
            </div>
          </div>
          <p className="text-sm text-gray-400">
            {formatBillingCycle({ ...form, id: '', is_active: true } as Card)}
          </p>
          <div>
            <label className="block text-sm font-medium text-gray-500 mb-1">주요 혜택 / 제휴 메모</label>
            <input value={form.benefit_memo} onChange={e => setForm({ ...form, benefit_memo: e.target.value })}
              placeholder="예: GS홈쇼핑 7% 할인"
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-base focus:outline-none focus:ring-2 focus:ring-blue-400" />
          </div>
          <label className="flex items-center gap-2 text-base text-gray-600">
            <input type="checkbox" checked={form.is_active} onChange={e => setForm({ ...form, is_active: e.target.checked })} className="accent-blue-600" />
            사용 중인 카드
          </label>
        </div>
        <div className="flex gap-3 mt-6">
          <button onClick={saveCard} disabled={saving}
            className="flex-1 px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-base font-medium disabled:opacity-50">
            {saving ? '저장 중...' : '저장'}
          </button>
          <button onClick={() => { setShowForm(false); setEditId(null); setForm({ ...EMPTY_CARD }); }}
            className="px-5 py-2.5 border border-gray-200 text-gray-600 rounded-xl text-base hover:bg-gray-50">취소</button>
        </div>
      </div>
    </div>
  );

  if (!canView) {
    return (
      <div className="text-center py-20 text-gray-400">
        <div className="text-3xl mb-2">🔒</div>
        <div className="text-base">카드·매입은 대표·실장·영업 담당자만 열람할 수 있습니다.</div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* 탭 */}
      <div className="flex items-center gap-2 border-b border-gray-200 pb-3 overflow-x-auto">
        <button onClick={() => setTab('calendar')}
          className={`px-4 py-2 rounded-t-lg text-base font-medium border-b-2 whitespace-nowrap ${tab === 'calendar' ? 'border-blue-600 text-blue-600 bg-white' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
          결제 캘린더
        </button>
        <button onClick={() => setTab('limit')}
          className={`px-4 py-2 rounded-t-lg text-base font-medium border-b-2 whitespace-nowrap ${tab === 'limit' ? 'border-blue-600 text-blue-600 bg-white' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
          한도 현황
        </button>
        <button onClick={() => setTab('cards')}
          className={`px-4 py-2 rounded-t-lg text-base font-medium border-b-2 whitespace-nowrap ${tab === 'cards' ? 'border-blue-600 text-blue-600 bg-white' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
          카드 목록
        </button>
        {canManage && (
          <button onClick={() => setTab('log')}
            className={`px-4 py-2 rounded-t-lg text-base font-medium border-b-2 ${tab === 'log' ? 'border-blue-600 text-blue-600 bg-white' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
            변경 로그
          </button>
        )}
      </div>

      {loading ? (
        <div className="text-center py-12 text-gray-400">불러오는 중...</div>
      ) : tab === 'limit' ? (
        // ─────────── 한도 현황 ───────────
        <div className="space-y-4">
          {/* 전체 요약 */}
          <div className="bg-gradient-to-r from-slate-800 to-slate-600 rounded-2xl p-5 text-white">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div>
                <div className="text-sm text-slate-300">{typeFilter === 'all' ? '전체' : typeFilter} · 한도 / 사용중 / 잔여</div>
                <div className="text-2xl font-bold mt-1">
                  잔여 {won(totalLimit - totalUsed)}원
                  <span className="text-base font-normal text-slate-300"> · 사용 {won(totalUsed)} / 한도 {won(totalLimit)}</span>
                </div>
              </div>
              <div className="text-xs text-slate-300 text-right">미결제 = 결제일 안 지난 매입<br />결제일 지나면 자동 회복</div>
            </div>
            {totalLimit > 0 && (
              <div className="mt-3">
                <div className="h-3 bg-slate-900/40 rounded-full overflow-hidden">
                  <div className="h-full rounded-full bg-gradient-to-r from-blue-400 to-cyan-300"
                    style={{ width: `${Math.min(100, Math.round(totalUsed / totalLimit * 100))}%` }} />
                </div>
                <div className="text-xs text-slate-300 mt-1 text-right">전체 사용률 {Math.round(totalUsed / totalLimit * 100)}%</div>
              </div>
            )}
          </div>
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <p className="text-xs text-gray-400">💡 잔여한도(실시간) = 6/30 잔여 기준값에서 시작 · 카드구매 결재 −차감 / 선결제 결재 +복구. (6/30 기준값은 카드 수정에서 확인·변경)</p>
            {canManage && (
              <button onClick={() => { setPrepayDate(todayStr); setPrepayChecked(new Set()); setPrepayOpen(true); }}
                className="px-4 py-2 text-sm font-medium bg-green-600 hover:bg-green-700 text-white rounded-lg whitespace-nowrap">💚 선결제 처리</button>
            )}
            <button onClick={viewPurchase}
              className="px-4 py-2 text-sm font-medium bg-blue-600 hover:bg-blue-700 text-white rounded-lg whitespace-nowrap">📄 카드 구매내역 보기</button>
            <button onClick={exportPurchaseExcel}
              className="text-xs text-gray-400 hover:text-gray-600 underline whitespace-nowrap">엑셀 다운로드(세무용)</button>
          </div>

          {/* 사업자 필터 */}
          <div className="flex gap-2 flex-wrap">
            <button onClick={() => setTypeFilter('all')}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium ${typeFilter === 'all' ? 'bg-slate-700 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'}`}>전체</button>
            {usedTypes.map(t => (
              <button key={t} onClick={() => setTypeFilter(t)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium ${typeFilter === t ? 'bg-slate-700 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'}`}>{t}</button>
            ))}
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {visibleGroups
              .map(g => {
                const pct = g.limit > 0 ? Math.min(100, Math.round(g.used / g.limit * 100)) : 0;
                const shared = g.cards.length > 1;
                return (
                  <div key={g.key} className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <span className={`text-xs px-2 py-0.5 rounded-md font-medium ${CARD_TYPE_COLORS[g.cards[0].card_type] || 'bg-gray-100 text-gray-600'}`}>{g.cards[0].card_type}</span>
                      {shared && <span className="text-xs text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded">한도공유 {g.cards.length}장</span>}
                    </div>
                    <div className="font-bold text-gray-800">{g.cards.map(c => c.card_name).join(' / ')}</div>
                    <div className="text-xs text-gray-400 mt-0.5">{g.cards[0].holder_name}</div>
                    <div className="border-t border-gray-100 mt-3 pt-3">
                      <div className="flex justify-between items-baseline">
                        <span className="text-xs text-gray-400">잔여한도 (실시간)</span>
                        <span className={`text-xl font-bold ${g.remaining <= 0 ? 'text-red-500' : pct >= 80 ? 'text-orange-500' : 'text-green-600'}`}>{won(g.remaining)}원</span>
                      </div>
                      <div className="flex justify-between text-xs text-gray-400 mt-1">
                        <span>사용 {won(g.used)}</span>
                        <span>전체한도 {g.limit > 0 ? won(g.limit) : '미설정'}</span>
                      </div>
                      {g.limit > 0 && (
                        <div className="mt-2">
                          <div className="flex justify-between text-xs mb-1">
                            <span className="text-gray-400">사용률</span>
                            <span className={`font-semibold ${pct >= 90 ? 'text-red-500' : pct >= 80 ? 'text-orange-500' : 'text-blue-500'}`}>{pct}%</span>
                          </div>
                          <div className="h-2.5 bg-gray-100 rounded-full overflow-hidden">
                            <div className={`h-full rounded-full transition-all ${pct >= 90 ? 'bg-red-400' : pct >= 80 ? 'bg-orange-400' : 'bg-blue-400'}`} style={{ width: `${pct}%` }} />
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
          </div>
        </div>
      ) : tab === 'cards' ? (
        // ─────────── 카드 목록 ───────────
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <p className="text-base text-gray-500">사업자(담당자)별 카드와 결제 주기를 관리합니다.</p>
            {canManage && (
              <button onClick={() => { setForm({ ...EMPTY_CARD }); setEditId(null); setShowForm(true); }}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-base font-medium">+ 카드 등록</button>
            )}
          </div>

          {/* 사업자(카드종류)별 필터 */}
          <div className="flex gap-2 flex-wrap">
            <button onClick={() => setTypeFilter('all')}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium ${typeFilter === 'all' ? 'bg-slate-700 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'}`}>전체</button>
            {usedTypes.map(t => (
              <button key={t} onClick={() => setTypeFilter(t)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium ${typeFilter === t ? 'bg-slate-700 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'}`}>{t}</button>
            ))}
          </div>

          {cards.length === 0 ? (
            <div className="text-center py-12 text-gray-400 bg-white rounded-2xl border border-gray-100">등록된 카드가 없습니다</div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {cards.filter(c => typeFilter === 'all' || c.card_type === typeFilter).map(c => {
                const monthTot = cardMonthTotal(c.id);
                const usePct = c.limit_amount > 0 ? Math.min(100, Math.round(monthTot / c.limit_amount * 100)) : 0;
                return (
                  <div key={c.id} className={`bg-white rounded-2xl shadow-sm border p-5 ${c.is_active ? 'border-gray-100' : 'border-gray-100 opacity-60'}`}>
                    <div className="flex items-start justify-between mb-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className={`text-sm px-2 py-0.5 rounded-md font-medium ${CARD_TYPE_COLORS[c.card_type] || 'bg-gray-100 text-gray-600'}`}>{c.card_type}</span>
                          {!c.is_active && <span className="text-sm text-gray-400">(미사용)</span>}
                        </div>
                        <div className="font-bold text-gray-800 mt-1.5">{c.card_name}</div>
                        <div className="text-sm text-gray-400 mt-0.5">
                          {c.card_company} {c.last4 && `****${c.last4}`} {c.holder_name && `· ${c.holder_name}`}
                        </div>
                      </div>
                      {canManage && (
                        <div className="flex gap-1">
                          <button onClick={() => openEdit(c)} className="text-sm text-gray-400 hover:text-blue-600 px-1">수정</button>
                          <button onClick={() => deleteCard(c.id)} className="text-sm text-gray-400 hover:text-red-500 px-1">삭제</button>
                        </div>
                      )}
                    </div>
                    <div className="text-sm text-gray-500 mb-2">{formatBillingCycle(c)}</div>
                    {c.benefit_memo && <div className="text-sm text-blue-600 bg-blue-50 rounded-lg px-2 py-1 mb-3">💳 {c.benefit_memo}</div>}
                    <div className="border-t border-gray-100 pt-3">
                      <div className="flex justify-between text-sm text-gray-400 mb-1">
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
                    <span className={`text-sm px-2 py-0.5 rounded-md font-medium flex-shrink-0 ${color}`}>{l.action}</span>
                    <div className="flex-1 min-w-0">
                      <div className="text-base font-medium text-gray-800">{l.target}</div>
                      {l.detail && <div className="text-sm text-gray-500 mt-0.5">{l.detail}</div>}
                      <div className="text-sm text-gray-400 mt-0.5">
                        {l.actor} · {new Date(l.created_at).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      </div>
                    </div>
                    {canManage && (
                      <button onClick={() => deleteLog(l)} className="text-sm text-gray-400 hover:text-red-500 flex-shrink-0">삭제</button>
                    )}
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
                className="ml-1 px-2 py-1 text-sm border border-gray-200 rounded-lg text-gray-500 hover:bg-gray-50">오늘</button>
            </div>
            <div className="flex items-center gap-3">
              <button onClick={viewSchedule} className="px-4 py-2 text-sm font-medium bg-blue-600 hover:bg-blue-700 text-white rounded-lg whitespace-nowrap">📄 결제예정 보기</button>
              <button onClick={exportExcel} className="text-xs text-gray-400 hover:text-gray-600 underline whitespace-nowrap">엑셀 다운로드</button>
            </div>
          </div>

          {/* 사업자(카드종류)별 필터 */}
          <div className="flex gap-2 flex-wrap">
            <button onClick={() => setTypeFilter('all')}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium ${typeFilter === 'all' ? 'bg-slate-700 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'}`}>전체</button>
            {usedTypes.map(t => (
              <button key={t} onClick={() => setTypeFilter(t)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium ${typeFilter === t ? 'bg-slate-700 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'}`}>{t}</button>
            ))}
          </div>

          {/* 기간 조회 */}
          <div className="flex items-center gap-2 flex-wrap bg-white border border-gray-100 rounded-xl px-3 py-2">
            <span className="text-sm font-medium text-gray-500">📅 기간 조회</span>
            <input type="date" value={rangeFrom} onChange={e => setRangeFrom(e.target.value)}
              className="px-2 py-1 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
            <span className="text-gray-400">~</span>
            <input type="date" value={rangeTo} onChange={e => setRangeTo(e.target.value)}
              className="px-2 py-1 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
            {(rangeFrom || rangeTo) && (
              <button onClick={() => { setRangeFrom(''); setRangeTo(''); }} className="text-xs text-gray-400 hover:text-gray-600">초기화</button>
            )}
          </div>

          {/* 이번 달 합계 */}
          <div className="bg-gradient-to-r from-slate-700 to-slate-600 rounded-2xl p-5 text-white flex items-center justify-between">
            <div>
              <div className="text-sm text-slate-300">{year}년 {month + 1}월 결제 예정 합계 {typeFilter !== 'all' && `· ${typeFilter}`}</div>
              <div className="text-2xl font-bold mt-1">{won(monthTotalAll)}원</div>
            </div>
            <div className="text-sm text-slate-300 text-right">매입 − 취소환불<br />상계 금액</div>
          </div>

          {/* 기간 조회 결과 */}
          {rangeFrom && rangeTo && (
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-bold text-gray-800">{rangeFrom} ~ {rangeTo} 결제 내역 {typeFilter !== 'all' && `· ${typeFilter}`}</h3>
                <span className="text-sm font-bold text-gray-700">합계 {won(rangeTotal)}원</span>
              </div>
              {rangeEvents.length === 0 ? (
                <div className="text-center py-6 text-sm text-gray-400">해당 기간 결제 내역이 없습니다</div>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-gray-400 border-b border-gray-100">
                      <th className="py-2 text-left font-medium">결제일</th>
                      <th className="py-2 text-left font-medium">구분</th>
                      <th className="py-2 text-left font-medium">카드</th>
                      <th className="py-2 text-left font-medium">사업자</th>
                      <th className="py-2 text-right font-medium">금액</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {rangeEvents.map((e, i) => (
                      <tr key={i} onClick={() => openPurchaseDetail(e)} className="cursor-pointer hover:bg-blue-50/40">
                        <td className="py-2 text-gray-600 whitespace-nowrap">{e.date}</td>
                        <td className="py-2">
                          <span className={`text-xs px-2 py-0.5 rounded-md font-medium ${e.type === 'refund' ? 'bg-red-50 text-red-500' : e.type === 'prepay' ? 'bg-green-50 text-green-600' : 'bg-blue-50 text-blue-600'}`}>{e.type === 'refund' ? '환불' : e.type === 'prepay' ? '선결제' : '매입'}</span>
                        </td>
                        <td className="py-2 text-gray-600">{cardLabel(e.cardId)}</td>
                        <td className="py-2 text-gray-500">{e.purchase.company}</td>
                        <td className={`py-2 text-right font-medium ${e.amount < 0 ? 'text-red-500' : 'text-gray-700'}`}>{won(e.amount)}원</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {/* 달력 */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="grid grid-cols-7 border-b border-gray-100">
              {WEEKDAYS.map((w, i) => (
                <div key={w} className={`py-2 text-center text-sm font-medium ${i === 0 ? 'text-red-400' : i === 6 ? 'text-blue-400' : 'text-gray-400'}`}>{w}</div>
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
                    <div className={`text-sm font-medium ${isToday ? 'bg-blue-600 text-white rounded-full w-5 h-5 flex items-center justify-center' : dow === 0 ? 'text-red-400' : dow === 6 ? 'text-blue-400' : 'text-gray-500'}`}>{dayNum}</div>
                    {dayEvents.length > 0 && (
                      <div className="mt-1 space-y-0.5">
                        <div className={`text-sm font-bold ${dayTotal < 0 ? 'text-red-500' : 'text-gray-700'}`}>{won(dayTotal)}</div>
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
                <button onClick={() => setSelectedDay(null)} className="text-gray-400 text-base">✕</button>
              </div>
              <table className="w-full text-base">
                <thead>
                  <tr className="text-sm text-gray-400 border-b border-gray-100">
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
                    <tr key={idx} onClick={() => openPurchaseDetail(e)} className="cursor-pointer hover:bg-blue-50/40">
                      <td className="py-2">
                        <span className={`text-sm px-2 py-0.5 rounded-md font-medium ${e.type === 'refund' ? 'bg-red-50 text-red-500' : e.type === 'prepay' ? 'bg-green-50 text-green-600' : 'bg-blue-50 text-blue-600'}`}>
                          {e.type === 'refund' ? '환불' : e.type === 'prepay' ? '선결제' : '매입'}
                        </span>
                      </td>
                      <td className="py-2 text-gray-600">{cardLabel(e.cardId)}</td>
                      <td className="py-2 text-gray-500">{e.purchase.company}</td>
                      <td className="py-2 text-gray-500">{e.purchase.organizer}</td>
                      <td className="py-2 text-gray-500">{e.purchase.purchase_vendor || '-'}</td>
                      <td className={`py-2 text-right font-medium ${e.amount < 0 ? 'text-red-500' : 'text-gray-700'}`}>{won(e.amount)}원 ›</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t border-gray-200 font-bold">
                    <td colSpan={5} className="py-2 text-sm text-gray-400">합계 (상계)</td>
                    <td className="py-2 text-right text-gray-800">{won(byDate[selectedDay].reduce((s, e) => s + e.amount, 0))}원</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}

          {cards.length === 0 && (
            <div className="text-center py-6 text-base text-gray-400">
              먼저 <button onClick={() => setTab('cards')} className="text-blue-600 underline">카드 목록</button>에서 카드를 등록하세요.
            </div>
          )}
        </div>
      )}

      {cardFormModal}
      {tableViewModal}
      {prepayModal}

      {/* 결제 내역 상세 모달 */}
      {detailEvent && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-start justify-center p-4 overflow-y-auto" onClick={() => setDetailEvent(null)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-6 my-6 max-h-[92vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-start justify-between mb-4">
              <div>
                <span className={`text-xs px-2 py-0.5 rounded-md font-medium ${detailEvent.type === 'refund' ? 'bg-red-50 text-red-500' : detailEvent.type === 'prepay' ? 'bg-green-50 text-green-600' : 'bg-blue-50 text-blue-600'}`}>
                  {detailEvent.type === 'refund' ? '환불' : detailEvent.type === 'prepay' ? '선결제(한도복구)' : '카드 매입'}
                </span>
                <h3 className="text-lg font-bold text-gray-800 mt-2">{detailEvent.purchase.purchase_vendor || '구매 내역'}</h3>
              </div>
              <button onClick={() => setDetailEvent(null)} className="text-gray-400 text-lg">✕</button>
            </div>

            <div className="grid grid-cols-2 gap-3 text-sm mb-4">
              {[
                { l: '결제카드', v: cardLabel(detailEvent.cardId) },
                { l: '사업자', v: detailEvent.purchase.company },
                { l: '담당', v: detailEvent.purchase.organizer },
                { l: '구매처', v: detailEvent.purchase.purchase_vendor || '-' },
                { l: '구매일', v: detailEvent.purchase.spend_date || '-' },
                { l: detailEvent.type === 'refund' ? '환불예정일' : detailEvent.type === 'prepay' ? '선결제일' : '결제예정일', v: detailEvent.date },
              ].map((row, i) => (
                <div key={i} className="bg-gray-50 rounded-lg px-3 py-2">
                  <div className="text-xs text-gray-400">{row.l}</div>
                  <div className="font-medium text-gray-700">{row.v}</div>
                </div>
              ))}
            </div>

            <div className="border border-gray-200 rounded-xl overflow-hidden">
              <div className="flex bg-gray-50 border-b border-gray-200 text-xs font-medium text-gray-500">
                {canManage && detailEvent.type === 'charge' && <div className="w-8 px-2 py-2" />}
                <div className="flex-1 px-3 py-2">구매상품</div>
                <div className="w-16 px-2 py-2 text-right">수량</div>
                <div className="w-28 px-3 py-2 text-right">금액</div>
              </div>
              <div className="max-h-[42vh] overflow-y-auto">
              {detailItems.length === 0 ? (
                <div className="text-center py-4 text-sm text-gray-400">상세 품목이 없습니다</div>
              ) : detailItems.map((it, i) => (
                <div key={i} className={`flex border-t border-gray-100 text-sm ${it.canceled ? 'bg-red-50/50' : ''}`}>
                  {canManage && detailEvent.type === 'charge' && (
                    <div className="w-8 px-2 py-2 flex items-center justify-center">
                      {it.canceled ? <span className="text-[10px] text-red-500">취소</span> : (
                        <input type="checkbox" checked={cancelChecked.has(it.id || '')}
                          onChange={() => setCancelChecked(prev => { const n = new Set(prev); const k = it.id || ''; n.has(k) ? n.delete(k) : n.add(k); return n; })}
                          className="w-4 h-4 rounded border-gray-300 text-red-600 cursor-pointer" />
                      )}
                    </div>
                  )}
                  <div className={`flex-1 px-3 py-2 ${it.canceled ? 'text-red-400 line-through' : 'text-gray-700'}`}>{it.description || '-'}</div>
                  <div className="w-16 px-2 py-2 text-right text-gray-600">{it.quantity ? it.quantity.toLocaleString() : '-'}</div>
                  <div className="w-28 px-3 py-2 text-right text-gray-700">{it.amount ? it.amount.toLocaleString() : '-'}</div>
                </div>
              ))}
              </div>
              <div className="flex border-t border-gray-200 bg-gray-50 text-sm font-bold">
                {canManage && detailEvent.type === 'charge' && <div className="w-8 px-2 py-2" />}
                <div className="flex-1 px-3 py-2 text-gray-600">합계</div>
                <div className="w-16 px-2 py-2 text-right text-gray-600">{detailItems.reduce((s, it) => s + (Number(it.quantity) || 0), 0).toLocaleString()}</div>
                <div className="w-28 px-3 py-2 text-right text-gray-800">{won(detailEvent.purchase.total_amount)}원</div>
              </div>
            </div>

            {/* 부분 취소 (체크 후 처리) */}
            {canManage && detailEvent.type === 'charge' && cancelChecked.size > 0 && (
              <div className="mt-3 bg-orange-50 border border-orange-200 rounded-xl p-3">
                <div className="text-sm font-medium text-orange-700 mb-2">선택 {cancelChecked.size}건 취소 (환불 −{detailItems.filter(it => cancelChecked.has(it.id || '')).reduce((s, it) => s + (it.amount || 0), 0).toLocaleString()}원)</div>
                <div className="flex items-center gap-2 flex-wrap">
                  <label className="text-xs text-gray-500">환불 예정일</label>
                  <input type="date" value={cancelRefundDate} onChange={e => setCancelRefundDate(e.target.value)}
                    className="px-2 py-1 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" />
                  <button onClick={cancelSelectedItems}
                    className="px-4 py-1.5 bg-orange-500 hover:bg-orange-600 text-white rounded-lg text-sm font-medium">취소 확정</button>
                </div>
              </div>
            )}

            {(detailEvent.purchase.purchase_status === 'canceled' || detailEvent.purchase.purchase_status === 'partial') && (
              <div className="mt-3 text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">
                ⚠️ {detailEvent.purchase.purchase_status === 'canceled' ? '전체 취소됨' : '일부 항목 취소됨'} (위 취소 표시 항목 참고)
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
