'use client';

import { useState, useEffect, useCallback } from 'react';
import { supabaseFetch, supabaseUpload, safeStorageKey, supabaseFetchAll } from '@/lib/supabase';
import { getUser } from '@/lib/auth';
import { Card, computePaymentDate, toISO, logCardChange } from '@/lib/cardBilling';

interface ApprovalItem {
  id?: string;
  item_date: string;
  description: string;
  quantity?: number;
  amount: number;
  note: string;
  sort_order: number;
  canceled?: boolean;
  refund_due_date?: string;
}

interface Approval {
  id: string;
  doc_type: string;
  company: string;
  issue_date: string;
  settle_date: string;
  spend_date: string;
  organizer: string;
  processor: string;
  account: string;
  total_amount: number;
  status: string;
  submitter_name: string;
  approver1_name: string;
  approver1_status: string;
  approver1_at?: string;
  approver2_name?: string;
  approver2_status?: string;
  approver2_at?: string;
  final_approver_name: string;
  final_approver_status: string;
  final_approver_at?: string;
  rejection_reason?: string;
  created_at: string;
  attachments?: { name: string; url: string }[];
  // 카드 매입 전용 필드 (지출결의서)
  card_id?: string;
  purchase_vendor?: string;
  is_card_payment?: boolean;
  payment_due_date?: string;
  purchase_status?: string;
  canceled_at?: string;
  refund_due_date?: string;
  // 휴가신청서 전용 필드
  vacation_type?: string;
  vacation_start?: string;
  vacation_end?: string;
  vacation_days?: number;
  vacation_reason?: string;
  items?: ApprovalItem[];
}

interface Employee {
  id: string;
  name: string;
  company: string;
  role?: string;
  hire_date?: string;
  annual_leave_total?: number;
}

const COMPANIES = ['더블아이', 'BNKNET', 'SJ글로벌', 'IX글로벌'];

const APPROVAL_LINES: Record<string, string[]> = {
  '더블아이': ['담당', '대표'],
  'BNKNET':   ['담당', '실장', '대표'],
  'SJ글로벌': ['담당', '대표'],
  'IX글로벌': ['담당', '대표'],
};

const STATUS_MAP: Record<string, { label: string; color: string }> = {
  draft:    { label: '임시저장', color: 'bg-gray-100 text-gray-600' },
  pending:  { label: '결재중',   color: 'bg-yellow-100 text-yellow-700' },
  approved: { label: '승인완료', color: 'bg-green-100 text-green-700' },
  rejected: { label: '반려',     color: 'bg-red-100 text-red-700' },
};

const VACATION_TYPES = [
  { value: 'annual',   label: '연차',       days: 1,   time: '09:30 ~ 18:30' },
  { value: 'half_am',  label: '반차 (오전)', days: 0.5, time: '09:30 ~ 13:30' },
  { value: 'half_pm',  label: '반차 (오후)', days: 0.5, time: '13:30 ~ 18:30' },
];

function today() {
  return new Date().toISOString().slice(0, 10);
}

function numberToKorean(n: number): string {
  if (!n) return '';
  const units = ['', '일', '이', '삼', '사', '오', '육', '칠', '팔', '구'];
  const tens = ['', '십', '백', '천'];
  const bigs = ['', '만', '억', '조'];
  let result = '';
  let str = String(n);
  let bigIdx = 0;
  while (str.length > 0) {
    const chunk = str.slice(-4);
    str = str.slice(0, -4);
    let chunkStr = '';
    for (let i = 0; i < chunk.length; i++) {
      const d = Number(chunk[i]);
      const t = chunk.length - 1 - i;
      if (d === 0) continue;
      chunkStr += (d === 1 && t > 0 ? '' : units[d]) + tens[t];
    }
    if (chunkStr) result = chunkStr + bigs[bigIdx] + result;
    bigIdx++;
  }
  return result + '원정';
}


// 두 날짜 사이 평일 수 (주말 제외)
function countWeekdays(start: string, end: string): number {
  const s = new Date(start);
  const e = new Date(end);
  let count = 0;
  const cur = new Date(s);
  while (cur <= e) {
    const day = cur.getDay();
    if (day !== 0 && day !== 6) count++;
    cur.setDate(cur.getDate() + 1);
  }
  return count;
}

// 입사일 기준 법정 연차(근로기준법) 계산
// · 1년 미만: 1개월 개근당 1일, 최대 11일
// · 1년 이상: 15일 + 3년차부터 2년마다 1일 가산, 최대 25일
function statutoryLeave(hireDate?: string): number | null {
  if (!hireDate) return null;
  const h = new Date(hireDate);
  if (isNaN(h.getTime())) return null;
  const now = new Date();
  let years = now.getFullYear() - h.getFullYear();
  const anniv = new Date(h); anniv.setFullYear(h.getFullYear() + years);
  if (now < anniv) years -= 1;
  if (years < 1) {
    let months = (now.getFullYear() - h.getFullYear()) * 12 + (now.getMonth() - h.getMonth());
    if (now.getDate() < h.getDate()) months -= 1;
    return Math.max(0, Math.min(11, months));
  }
  return Math.min(25, 15 + Math.floor((years - 1) / 2));
}

const EMPTY_ITEM: ApprovalItem = { item_date: '', description: '', quantity: 0, amount: 0, note: '', sort_order: 0 };

type View = 'list' | 'form' | 'detail' | 'leave';
type DocType = '지출결의서' | '카드구매' | '휴가신청서';
const DOC_TYPE_LABELS: Record<DocType, string> = {
  '지출결의서': '지출결의서',
  '카드구매': '매입품의서(카드구매)',
  '휴가신청서': '휴가신청서',
};

interface LeaveRow {
  id: string;
  name: string;
  company: string;
  hire_date?: string;
  annual_leave_total: number;
  used: number;
  remaining: number;
  history: Approval[];
}

export default function ApprovalContent() {
  const me = getUser();
  const isCeo = me?.role === 'ceo';
  const isAdmin = me?.role === 'admin';

  const [view, setView] = useState<View>('list');
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [selected, setSelected] = useState<Approval | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  // 승인권자(대표·실장)는 기본으로 '내 결재 대기'만 보이게 → 바로바로 연속 결재
  const [filterStatus, setFilterStatus] = useState(isCeo || isAdmin ? 'myturn' : 'all');

  // 연차 현황
  const [leaveRows, setLeaveRows] = useState<LeaveRow[]>([]);
  const [leaveLoading, setLeaveLoading] = useState(false);
  const [expandedEmp, setExpandedEmp] = useState<string | null>(null);
  const [editingLeave, setEditingLeave] = useState<string | null>(null); // 수정 중인 직원 id
  const [editLeaveVal, setEditLeaveVal] = useState<number>(0);

  // 반려 모달
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [rejectReason, setRejectReason] = useState('');

  // 문서 종류
  const [docType, setDocType] = useState<DocType>('지출결의서');

  // 지출결의서 폼
  const [company, setCompany] = useState(me?.company || 'BNKNET');
  const [issueDate, setIssueDate] = useState(today());
  const [settleDate, setSettleDate] = useState(today());
  const [spendDate, setSpendDate] = useState(today());
  const [organizer, setOrganizer] = useState(me?.name || '');
  const [processor, setProcessor] = useState('');
  const [account, setAccount] = useState('');
  const [cardId, setCardId] = useState('');
  const [purchaseVendor, setPurchaseVendor] = useState('');
  const [isPrepay, setIsPrepay] = useState(false); // 카드구매(false) / 선결제·한도복구(true)
  const [cards, setCards] = useState<Card[]>([]);
  const [attachments, setAttachments] = useState<{ name: string; url: string }[]>([]);
  const [uploading, setUploading] = useState(false);
  const [items, setItems] = useState<ApprovalItem[]>(
    [0,1,2,3,4].map(i => ({ ...EMPTY_ITEM, sort_order: i }))
  );

  // 취소(환불) 모달
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [refundDate, setRefundDate] = useState(today());
  const [cancelItemIds, setCancelItemIds] = useState<Set<string>>(new Set());

  // 휴가신청서 폼
  const [vacationType, setVacationType] = useState('annual');
  const [vacationStart, setVacationStart] = useState(today());
  const [vacationEnd, setVacationEnd] = useState(today());
  const [vacationReason, setVacationReason] = useState('');
  const [myEmployee, setMyEmployee] = useState<Employee | null>(null);
  const [usedLeave, setUsedLeave] = useState(0);

  const [editId, setEditId] = useState<string | null>(null);

  const approvalLine = APPROVAL_LINES[company] || ['담당', '대표'];
  const total = items.reduce((s, i) => s + (Number(i.amount) || 0), 0);

  const vacInfo = VACATION_TYPES.find(v => v.value === vacationType)!;
  const vacDays = vacationType === 'annual'
    ? countWeekdays(vacationStart, vacationEnd)
    : 0.5;

  const entitlement = myEmployee?.annual_leave_total ?? 0;
  const remaining = entitlement - usedLeave;

  const loadApprovals = useCallback(async () => {
    setLoading(true);
    try {
      // 전체 로드 후 화면에서 필터링 (상태 필터 + 내 결재 대기 필터)
      let query = '/approvals?order=created_at.desc';
      // 대표·실장은 전체, 일반 직원은 본인이 작성한 문서만
      if (!isCeo && !isAdmin && me?.name) {
        query += `&submitter_name=eq.${encodeURIComponent(me.name)}`;
      }
      const data = await supabaseFetchAll<Approval>(query);
      setApprovals(data);
    } catch { setApprovals([]); }
    finally { setLoading(false); }
  }, [isCeo, isAdmin, me?.name]);

  useEffect(() => { loadApprovals(); }, [loadApprovals]);

  // 카드 목록 로드 (지출결의서 결제카드 선택용)
  useEffect(() => {
    (async () => {
      const res = await supabaseFetch('/cards?is_active=eq.true&order=sort_order.asc');
      const data = await res.json();
      setCards(Array.isArray(data) ? data : []);
    })();
  }, []);

  const selectedCard = cards.find(c => c.id === cardId);
  // 카드구매는 발의일(구매일) 기준으로 결제예정일 계산, 일반 지출결의서는 지출일 기준
  const purchaseBaseDate = docType === '카드구매' ? issueDate : spendDate;
  const paymentDuePreview = selectedCard
    ? computePaymentDate(purchaseBaseDate, selectedCard.billing_day, selectedCard.close_day)
    : '';

  // 카드구매 선택 시 지출일을 해당 카드 결제일로 자동 설정
  useEffect(() => {
    if (docType === '카드구매' && paymentDuePreview && spendDate !== paymentDuePreview) {
      setSpendDate(paymentDuePreview);
    }
  }, [docType, paymentDuePreview]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleFileUpload(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploading(true);
    try {
      const uploaded: { name: string; url: string }[] = [];
      for (const file of Array.from(files)) {
        const url = await supabaseUpload('approvals', safeStorageKey(file.name), file);
        uploaded.push({ name: file.name, url }); // 화면 표시용 이름은 원본(한글) 유지
      }
      setAttachments(prev => [...prev, ...uploaded]);
    } catch (e) {
      alert(e instanceof Error ? e.message : '파일 업로드에 실패했습니다.');
    } finally { setUploading(false); }
  }

  const loadLeaveData = useCallback(async () => {
    if (!isCeo && !isAdmin) return;
    setLeaveLoading(true);
    try {
      const thisYear = new Date().getFullYear();
      const [empRes, vacRes] = await Promise.all([
        supabaseFetch('/employees?select=id,name,company,hire_date,role,annual_leave_total&order=company.asc,name.asc'),
        supabaseFetch(`/approvals?doc_type=eq.휴가신청서&status=eq.approved&vacation_start=gte.${thisYear}-01-01&vacation_start=lte.${thisYear}-12-31&select=submitter_name,vacation_type,vacation_start,vacation_end,vacation_days,vacation_reason,created_at`),
      ]);
      const emps: Employee[] = await empRes.json();
      const vacs: Approval[] = await vacRes.json();

      const rows: LeaveRow[] = (Array.isArray(emps) ? emps : [])
        .filter((emp: Employee) => emp.role !== 'ceo' && emp.role !== 'admin')
        .map((emp: Employee) => {
          const empVacs = Array.isArray(vacs) ? vacs.filter(v => v.submitter_name === emp.name) : [];
          const used = empVacs.reduce((s, v) => s + (v.vacation_days || 0), 0);
          const leaveTotal = emp.annual_leave_total ?? 0;
          return { id: emp.id, name: emp.name, company: emp.company, hire_date: emp.hire_date, annual_leave_total: leaveTotal, used, remaining: leaveTotal - used, history: empVacs };
        });
      setLeaveRows(rows);
    } finally { setLeaveLoading(false); }
  }, [isCeo, isAdmin]);

  async function saveLeaveTotal(empId: string) {
    await supabaseFetch(`/employees?id=eq.${empId}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ annual_leave_total: editLeaveVal }),
    });
    setEditingLeave(null);
    await loadLeaveData();
  }

  // 입사일 기준 법정 연차 일괄 적용 (대표·실장 제외 직원 전체)
  async function applyStatutoryLeave() {
    const targets = leaveRows
      .map(r => ({ id: r.id, name: r.name, hire: r.hire_date, law: statutoryLeave(r.hire_date) }))
      .filter(t => t.law !== null);
    const noHire = leaveRows.filter(r => !r.hire_date).map(r => r.name);
    if (!targets.length) { alert('입사일이 등록된 직원이 없습니다. 인사 관리에서 입사일을 먼저 등록하세요.'); return; }
    if (!confirm(`입사일 기준 법정 연차를 ${targets.length}명에게 적용합니다.\n${noHire.length ? `\n⚠️ 입사일 미등록(제외): ${noHire.join(', ')}` : ''}\n진행할까요?`)) return;
    for (const t of targets) {
      await supabaseFetch(`/employees?id=eq.${t.id}`, {
        method: 'PATCH', headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ annual_leave_total: t.law }),
      });
    }
    await loadLeaveData();
    alert(`✅ ${targets.length}명 법정 연차 적용 완료.${noHire.length ? ` (입사일 미등록 ${noHire.length}명 제외)` : ''}`);
  }

  // 내 직원 정보 + 사용한 연차 수 로드
  useEffect(() => {
    if (!me?.name) return;
    async function loadEmployee() {
      const res = await supabaseFetch(`/employees?name=eq.${encodeURIComponent(me!.name!)}&select=id,name,company,hire_date,annual_leave_total`);
      const data = await res.json();
      if (data?.[0]) setMyEmployee(data[0]);
    }
    async function loadUsedLeave() {
      const thisYear = new Date().getFullYear();
      const res = await supabaseFetch(
        `/approvals?submitter_name=eq.${encodeURIComponent(me!.name!)}&doc_type=eq.휴가신청서&status=eq.approved&vacation_start=gte.${thisYear}-01-01&vacation_start=lte.${thisYear}-12-31`
      );
      const data = await res.json();
      if (Array.isArray(data)) {
        const used = data.reduce((s: number, a: Approval) => s + (a.vacation_days || 0), 0);
        setUsedLeave(used);
      }
    }
    loadEmployee();
    loadUsedLeave();
  }, [me?.name]);

  async function loadDetail(id: string) {
    const [aRes, iRes] = await Promise.all([
      supabaseFetch(`/approvals?id=eq.${id}`),
      supabaseFetch(`/approval_items?approval_id=eq.${id}&order=sort_order.asc`),
    ]);
    const [aData, iData] = await Promise.all([aRes.json(), iRes.json()]);
    const approval = { ...aData[0], items: Array.isArray(iData) ? iData : [] };
    setSelected(approval);
    setView('detail');
  }

  async function handleSave(submitNow = false) {
    setSaving(true);
    try {
      const hasStep2 = APPROVAL_LINES[company]?.length === 3;
      const status = submitNow ? 'pending' : 'draft';

      let payload: Record<string, unknown>;

      if (docType === '휴가신청서') {
        if (vacDays > remaining && submitNow) {
          alert(`잔여 연차(${remaining}일)가 부족합니다. (신청: ${vacDays}일)`);
          setSaving(false); return;
        }
        payload = {
          doc_type: '휴가신청서', company: me?.company || 'BNKNET',
          issue_date: today(),
          settle_date: null, spend_date: null,
          organizer: me?.name || '', processor: null, account: null,
          total_amount: 0,
          status,
          submitter_name: me?.name || '',
          approver1_status: 'pending',
          approver2_name: APPROVAL_LINES[me?.company || 'BNKNET']?.length === 3 ? '실장' : null,
          approver2_status: APPROVAL_LINES[me?.company || 'BNKNET']?.length === 3 ? 'pending' : null,
          final_approver_status: 'pending',
          rejection_reason: null,
          vacation_type: vacationType,
          vacation_start: vacationStart,
          vacation_end: vacationType === 'annual' ? vacationEnd : vacationStart,
          vacation_days: vacDays,
          vacation_reason: vacationReason,
          updated_at: new Date().toISOString(),
        };
      } else {
        if (docType === '카드구매' && !cardId) {
          alert('카드구매는 결제 카드를 선택해야 합니다.');
          setSaving(false); return;
        }
        const card = cards.find(c => c.id === cardId);
        const baseDate = docType === '카드구매' ? issueDate : spendDate;
        const paymentDue = card ? computePaymentDate(baseDate, card.billing_day, card.close_day) : null;
        payload = {
          doc_type: docType, company,
          issue_date: issueDate, settle_date: settleDate, spend_date: spendDate,
          organizer, processor, account,
          total_amount: total,
          status,
          submitter_name: me?.name || '',
          approver1_status: 'pending',
          approver2_name: hasStep2 ? '실장' : null,
          approver2_status: hasStep2 ? 'pending' : null,
          final_approver_status: 'pending',
          rejection_reason: null,
          card_id: cardId || null,
          purchase_vendor: purchaseVendor || null,
          payment_due_date: paymentDue,
          purchase_status: 'normal',
          is_card_payment: docType === '카드구매' ? isPrepay : false,
          canceled_at: null, refund_due_date: null,
          attachments,
          vacation_type: null, vacation_start: null, vacation_end: null,
          vacation_days: null, vacation_reason: null,
          updated_at: new Date().toISOString(),
        };
      }

      let approvalId = editId;
      if (editId) {
        await supabaseFetch(`/approvals?id=eq.${editId}`, {
          method: 'PATCH', headers: { Prefer: 'return=minimal' },
          body: JSON.stringify(payload),
        });
        if (docType !== '휴가신청서') {
          await supabaseFetch(`/approval_items?approval_id=eq.${editId}`, { method: 'DELETE' });
        }
      } else {
        const res = await supabaseFetch('/approvals', {
          method: 'POST', headers: { Prefer: 'return=representation' },
          body: JSON.stringify(payload),
        });
        const data = await res.json();
        approvalId = data[0]?.id;
      }

      if (approvalId && docType !== '휴가신청서') {
        const validItems = items.filter(i => i.description || i.amount);
        if (validItems.length > 0) {
          await supabaseFetch('/approval_items', {
            method: 'POST', headers: { Prefer: 'return=minimal' },
            body: JSON.stringify(validItems.map((i, idx) => ({
              ...i, id: undefined, approval_id: approvalId, sort_order: idx,
            }))),
          });
        }
      }

      resetForm();
      setView('list');
      await loadApprovals();
    } finally { setSaving(false); }
  }

  // IX글로벌은 실장(admin)이 대표 자격으로 최종 결재 (세무증빙: 대표 명의, 실장 표기 없음)
  function canFinalApprove(approval: Approval): boolean {
    return isCeo || (approval.company === 'IX글로벌' && isAdmin);
  }

  async function handleApprove(approval: Approval) {
    const now = new Date().toISOString();
    const hasStep2 = APPROVAL_LINES[approval.company]?.length === 3;
    let patch: Record<string, unknown> = {};

    if (hasStep2) {
      if (isAdmin && approval.approver1_status === 'pending') {
        patch = { approver1_status: 'approved', approver1_at: now };
      } else if (isCeo && approval.approver1_status === 'approved') {
        patch = { approver2_status: 'approved', approver2_at: now, final_approver_status: 'approved', final_approver_at: now, status: 'approved' };
      }
    } else if (canFinalApprove(approval) && approval.approver1_status === 'pending') {
      patch = { approver1_status: 'approved', approver1_at: now, final_approver_status: 'approved', final_approver_at: now, status: 'approved' };
    }

    if (Object.keys(patch).length === 0) return; // 권한 없음/이미 처리됨 → 무시(안전장치)
    await supabaseFetch(`/approvals?id=eq.${approval.id}`, {
      method: 'PATCH', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify(patch),
    });
    // 승인 후 상세로 빠지지 않고 목록으로 → '내 결재 대기'에서 다음 건 바로 처리
    setView('list');
    await loadApprovals();
  }

  // 목록에서 바로 승인 (상세 진입 없이 연속 결재)
  async function quickApprove(approval: Approval, e: React.MouseEvent) {
    e.stopPropagation();
    const label = approval.doc_type === '휴가신청서'
      ? `${VACATION_TYPES.find(v => v.value === approval.vacation_type)?.label || ''} ${approval.vacation_days}일`
      : `${approval.total_amount.toLocaleString()}원`;
    if (!confirm(`[${approval.company}] ${approval.doc_type} · ${approval.submitter_name}\n${label}\n\n승인하시겠습니까?`)) return;
    await handleApprove(approval);
  }

  async function handleReject(approval: Approval) {
    if (!rejectReason.trim()) { alert('반려 사유를 입력해주세요.'); return; }
    const now = new Date().toISOString();
    const hasStep2 = APPROVAL_LINES[approval.company]?.length === 3;
    let patch: Record<string, unknown> = { status: 'rejected', rejection_reason: rejectReason };

    if (hasStep2) {
      if (isAdmin && approval.approver1_status === 'pending') {
        patch = { ...patch, approver1_status: 'rejected', approver1_at: now };
      } else if (isCeo && approval.approver1_status === 'approved') {
        patch = { ...patch, approver2_status: 'rejected', approver2_at: now };
      }
    } else if (canFinalApprove(approval)) {
      patch = { ...patch, approver1_status: 'rejected', approver1_at: now };
    }

    await supabaseFetch(`/approvals?id=eq.${approval.id}`, {
      method: 'PATCH', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify(patch),
    });
    setShowRejectModal(false);
    setRejectReason('');
    setView('list');
    await loadApprovals();
  }

  function openResubmit(approval: Approval) {
    if (approval.doc_type === '휴가신청서') {
      setDocType('휴가신청서');
      setVacationType(approval.vacation_type || 'annual');
      setVacationStart(approval.vacation_start || today());
      setVacationEnd(approval.vacation_end || today());
      setVacationReason(approval.vacation_reason || '');
    } else {
      setDocType(approval.doc_type === '카드구매' ? '카드구매' : '지출결의서');
      setCompany(approval.company);
      setIssueDate(approval.issue_date || today());
      setSettleDate(approval.settle_date || today());
      setSpendDate(approval.spend_date || today());
      setOrganizer(approval.organizer || '');
      setProcessor(approval.processor || '');
      setAccount(approval.account || '');
      setCardId(approval.card_id || '');
      setPurchaseVendor(approval.purchase_vendor || '');
      setIsPrepay(!!approval.is_card_payment);
      setAttachments(approval.attachments || []);
      const loaded = (approval.items || []).map((i, idx) => ({ ...i, sort_order: idx }));
      const padded = [...loaded, ...[0,1,2,3,4].map(i => ({ ...EMPTY_ITEM, sort_order: i }))].slice(0, Math.max(5, loaded.length));
      setItems(padded);
    }
    setEditId(approval.id);
    setView('form');
  }

  async function handleDelete(id: string) {
    if (!confirm('결재 문서를 삭제하시겠습니까?')) return;
    await supabaseFetch(`/approvals?id=eq.${id}`, { method: 'DELETE' });
    setView('list');
    await loadApprovals();
  }

  // 세무사 제출용: 승인완료된 지출결의서·매입품의서(카드구매)를 품목 단위로 엑셀 내보내기
  async function exportTaxExcel() {
    setExporting(true);
    try {
      const XLSX = await import('xlsx');
      const apps = await supabaseFetchAll<Approval>(
        '/approvals?status=eq.approved&doc_type=in.(지출결의서,카드구매)&select=id,doc_type,company,issue_date,spend_date,organizer,processor,account,total_amount,card_id,purchase_vendor,payment_due_date,purchase_status,attachments&order=issue_date.asc',
      );
      if (!apps.length) { alert('승인완료된 지출결의서/매입품의서가 없습니다.'); return; }
      const ids = apps.map(a => a.id);
      const items = await supabaseFetchAll<ApprovalItem & { approval_id: string }>(
        `/approval_items?approval_id=in.(${ids.join(',')})&order=sort_order.asc`,
      );
      const byApp = new Map<string, (ApprovalItem & { approval_id: string })[]>();
      for (const it of items) { const a = byApp.get(it.approval_id) || []; a.push(it); byApp.set(it.approval_id, a); }

      const rows: Record<string, string | number>[] = [];
      for (const a of apps) {
        const card = cards.find(c => c.id === a.card_id)?.card_name || '';
        const attach = (a.attachments || []).map(f => f.url).join(' | ');
        const base = {
          발의일: a.issue_date || '', 사업자: a.company || '',
          문서종류: DOC_TYPE_LABELS[a.doc_type as DocType] || a.doc_type,
          거래처: a.purchase_vendor || a.processor || '', 계정과목: a.account || '',
          결제카드: card, 결제예정일: a.payment_due_date || '',
          취소여부: a.purchase_status === 'canceled' ? '전체취소' : a.purchase_status === 'partial' ? '일부취소' : '',
        };
        const its = byApp.get(a.id) || [];
        if (!its.length) {
          rows.push({ ...base, 월일: '', 품목: '', 수량: '', 금액: a.total_amount || 0, 비고: '', 첨부URL: attach });
        } else {
          for (const it of its) {
            rows.push({
              ...base,
              월일: it.item_date || '', 품목: it.description || '',
              수량: it.quantity || '', 금액: it.amount || 0,
              비고: (it.canceled ? '[취소] ' : '') + (it.note || ''), 첨부URL: attach,
            });
          }
        }
      }
      const header = ['발의일', '사업자', '문서종류', '거래처', '계정과목', '결제카드', '결제예정일', '월일', '품목', '수량', '금액', '비고', '취소여부', '첨부URL'];
      const ws = XLSX.utils.json_to_sheet(rows, { header });
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, '지출결의서(승인)');
      XLSX.writeFile(wb, `세무제출_지출결의서_${today()}.xlsx`);
    } catch {
      alert('내보내기 중 오류가 발생했습니다.');
    } finally { setExporting(false); }
  }

  // 승인완료된 지출결의서·매입품의서 전체를 문서 양식으로 한 번에 인쇄/PDF (건별 페이지, 영수증 이미지 포함)
  async function printAllApproved() {
    setExporting(true);
    try {
      const apps = await supabaseFetchAll<Approval>(
        '/approvals?status=eq.approved&doc_type=in.(지출결의서,카드구매)&select=id,doc_type,company,issue_date,settle_date,spend_date,organizer,processor,account,total_amount,card_id,payment_due_date,attachments&order=issue_date.asc',
      );
      if (!apps.length) { alert('승인완료된 지출결의서/매입품의서가 없습니다.'); return; }
      const ids = apps.map(a => a.id);
      const items = await supabaseFetchAll<ApprovalItem & { approval_id: string }>(`/approval_items?approval_id=in.(${ids.join(',')})&order=sort_order.asc`);
      const byApp = new Map<string, (ApprovalItem & { approval_id: string })[]>();
      for (const it of items) { const a = byApp.get(it.approval_id) || []; a.push(it); byApp.set(it.approval_id, a); }
      const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] || c));
      const won = (n: number) => Number(n || 0).toLocaleString('ko-KR');

      const docs = apps.map(a => {
        const its = byApp.get(a.id) || [];
        const isCard = a.doc_type === '카드구매';
        const card = cards.find(c => c.id === a.card_id)?.card_name || '';
        const itemRows = its.map(it => `<tr><td>${esc(it.item_date)}</td><td class=l>${esc(it.description)}${it.canceled ? ' (취소)' : ''}</td>${isCard ? `<td class=r>${it.quantity ? won(it.quantity) : ''}</td>` : ''}<td class=r>${it.amount ? won(it.amount) : ''}</td><td>${esc(it.note)}</td></tr>`).join('');
        const imgs = (a.attachments || []).filter(f => /\.(png|jpe?g|gif|webp|heic)$/i.test(f.url)).map(f => `<img src="${esc(f.url)}" />`).join('');
        return `<div class="doc">
          <h2>〈 ${isCard ? '매 입 품 의 서 (카드구매)' : '지 출 결 의 서'} 〉</h2>
          <div class="meta">${esc(a.company)} · 승인완료 · 발의일 ${esc(a.issue_date)}</div>
          <table class="amt"><tr><td class="lbl">일금(정)</td><td class="r big">₩ ${won(a.total_amount)}</td></tr></table>
          <table><tr><td class="lbl">발의</td><td>${esc(a.issue_date)}</td><td class="lbl">정리인</td><td>${esc(a.organizer)}</td></tr>
          <tr><td class="lbl">결재</td><td>${esc(a.settle_date)}</td><td class="lbl">계정과목</td><td>${esc(a.account)}</td></tr>
          <tr><td class="lbl">지출</td><td>${esc(a.spend_date)}</td><td class="lbl">처리사항</td><td>${esc(a.processor)}</td></tr></table>
          <table class="items"><tr class="hd"><th>월/일</th><th>${isCard ? '구매상품' : '적 요'}</th>${isCard ? '<th>수량</th>' : ''}<th>금 액</th><th>비 고</th></tr>
          ${itemRows}
          <tr class="sum"><td></td><td class="l">합 계</td>${isCard ? '<td></td>' : ''}<td class="r">₩ ${won(a.total_amount)}</td><td></td></tr></table>
          ${a.card_id ? `<div class="card">💳 ${esc(card)}${a.payment_due_date ? ` · 결제예정일 ${esc(a.payment_due_date)}` : ''}</div>` : ''}
          <div class="foot">위 금액을 정히 영수(청구) 합니다. &nbsp;&nbsp; ${esc(a.issue_date)} &nbsp;&nbsp; 영수자 [ ${esc(a.organizer)} ]</div>
          ${imgs ? `<div class="atts">${imgs}</div>` : ''}
        </div>`;
      }).join('');

      const html = `<!doctype html><html><head><meta charset="utf-8"><title>승인 지출결의서 ${apps.length}건</title><style>
        *{box-sizing:border-box;font-family:'Noto Sans KR',Arial,sans-serif;}
        body{margin:0;} .doc{padding:14mm;page-break-after:always;}
        h2{text-align:center;letter-spacing:6px;font-size:19px;margin:0 0 6px;}
        .meta{text-align:center;color:#666;font-size:12px;margin-bottom:14px;}
        table{width:100%;border-collapse:collapse;margin-bottom:10px;font-size:13px;}
        td,th{border:1px solid #444;padding:6px 8px;}
        .lbl{background:#f3f3f3;text-align:center;width:76px;font-weight:600;}
        .r{text-align:right;} .l{text-align:left;} .big{font-weight:700;font-size:15px;}
        .items th{background:#f3f3f3;text-align:center;} .items td{text-align:center;}
        .items td.l{text-align:left;} .items td.r{text-align:right;}
        .items .sum td{background:#f8f8f8;font-weight:700;}
        .card{border:1px solid #bcd;background:#eef5ff;border-radius:6px;padding:8px;font-size:13px;margin-bottom:10px;}
        .foot{border:1px solid #444;text-align:center;padding:14px;font-size:13px;margin-top:6px;}
        .atts{margin-top:10px;} .atts img{width:100%;max-height:230mm;object-fit:contain;border:1px solid #eee;margin-top:6px;page-break-inside:avoid;}
        @page{margin:0;}
      </style></head><body>${docs}
      <script>window.onload=function(){var g=document.images,n=g.length,k=0;function d(){k++;if(k>=n)setTimeout(function(){window.print();},200);}if(n===0){window.print();return;}for(var i=0;i<n;i++){if(g[i].complete)d();else{g[i].onload=d;g[i].onerror=d;}}};<\/script>
      </body></html>`;
      const w = window.open('', '_blank');
      if (!w) { alert('팝업이 차단되었습니다. 브라우저에서 이 사이트의 팝업을 허용한 뒤 다시 눌러주세요.'); return; }
      w.document.write(html); w.document.close();
    } catch {
      alert('전체 인쇄 준비 중 오류가 발생했습니다.');
    } finally { setExporting(false); }
  }

  // 카드 매입 취소 → 환불(-) 처리 (항목별 부분취소 지원)
  function openCancelModal(approval: Approval) {
    const card = cards.find(c => c.id === approval.card_id);
    const def = card ? computePaymentDate(toISO(new Date()), card.billing_day, card.close_day) : today();
    setRefundDate(def);
    // 기본: 아직 취소 안 된 항목 전체 체크
    const ids = (approval.items || []).filter(i => !i.canceled && i.id).map(i => i.id as string);
    setCancelItemIds(new Set(ids));
    setShowCancelModal(true);
  }

  async function handleCancelPurchase(approval: Approval) {
    const items = approval.items || [];
    if (cancelItemIds.size === 0) { alert('취소할 항목을 선택하세요.'); return; }
    const nowIso = new Date().toISOString();
    for (const id of Array.from(cancelItemIds)) {
      await supabaseFetch(`/approval_items?id=eq.${id}`, {
        method: 'PATCH', headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ canceled: true, refund_due_date: refundDate, canceled_at: nowIso }),
      });
    }
    const canceledCnt = items.filter(i => i.canceled || cancelItemIds.has(i.id || '')).length;
    const status = canceledCnt >= items.length ? 'canceled' : 'partial';
    await supabaseFetch(`/approvals?id=eq.${approval.id}`, {
      method: 'PATCH', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ purchase_status: status, canceled_at: nowIso, refund_due_date: refundDate }),
    });
    const amt = items.filter(i => cancelItemIds.has(i.id || '')).reduce((s, i) => s + (i.amount || 0), 0);
    const cardName = cards.find(c => c.id === approval.card_id)?.card_name || '';
    await logCardChange('매입취소', `${approval.company} ${cardName}`,
      `${canceledCnt >= items.length ? '전체' : '부분'}취소 ${cancelItemIds.size}건 -${amt.toLocaleString()}원 · 환불예정 ${refundDate}`, me?.name || '');
    setShowCancelModal(false);
    await loadDetail(approval.id);
    await loadApprovals();
  }

  async function handleUncancelPurchase(approval: Approval) {
    if (!confirm('취소를 철회하고 정상 매입으로 되돌리시겠습니까? (취소된 항목 전체 복원)')) return;
    const nowIso = new Date().toISOString();
    for (const it of (approval.items || []).filter(i => i.canceled && i.id)) {
      await supabaseFetch(`/approval_items?id=eq.${it.id}`, {
        method: 'PATCH', headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ canceled: false, refund_due_date: null, canceled_at: null }),
      });
    }
    await supabaseFetch(`/approvals?id=eq.${approval.id}`, {
      method: 'PATCH', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ purchase_status: 'normal', canceled_at: null, refund_due_date: null }),
    });
    const cardName = cards.find(c => c.id === approval.card_id)?.card_name || '';
    await logCardChange('취소철회', `${approval.company} ${cardName}`, '정상 매입으로 복원', me?.name || '');
    await loadDetail(approval.id);
    await loadApprovals();
  }

  function resetForm() {
    setDocType('지출결의서');
    setCompany(me?.company || 'BNKNET');
    setIssueDate(today()); setSettleDate(today()); setSpendDate(today());
    setOrganizer(me?.name || ''); setProcessor(''); setAccount('');
    setCardId(''); setPurchaseVendor(''); setIsPrepay(false); setAttachments([]);
    setItems([0,1,2,3,4].map(i => ({ ...EMPTY_ITEM, sort_order: i })));
    setVacationType('annual');
    setVacationStart(today()); setVacationEnd(today()); setVacationReason('');
    setEditId(null);
  }

  function updateItem(idx: number, field: keyof ApprovalItem, value: string | number) {
    setItems(prev => prev.map((item, i) => i === idx ? { ...item, [field]: value } : item));
  }

  // 지출결의서 품목 엑셀 양식 다운로드 (인식 가능한 고정 열 구성)
  async function downloadItemTemplate() {
    const XLSX = await import('xlsx');
    const sample = [
      { '월/일': '07/01', '구매상품': '예시) 비타민C 1000mg', '구매수량': 2, '금액': 50000, '비고': '' },
      { '월/일': '', '구매상품': '', '구매수량': '', '금액': '', '비고': '' },
    ];
    const ws = XLSX.utils.json_to_sheet(sample, { header: ['월/일', '구매상품', '구매수량', '금액', '비고'] });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '품목');
    XLSX.writeFile(wb, '매입품의서_품목양식.xlsx');
  }

  // 엑셀 양식 업로드 → 품목으로 반영 (열 이름 유연 매칭)
  async function handleItemExcel(file: File | null) {
    if (!file) return;
    try {
      const XLSX = await import('xlsx');
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' });
      const num = (v: unknown) => Number(String(v).replace(/[^\d.-]/g, '')) || 0;
      const pick = (r: Record<string, unknown>, keys: string[]) => {
        for (const k of keys) if (r[k] !== undefined && r[k] !== '') return r[k];
        return '';
      };
      const parsed: ApprovalItem[] = rows.map((r, idx) => ({
        item_date: String(pick(r, ['월/일', '월일', '날짜', '일자'])).trim(),
        description: String(pick(r, ['구매상품', '적요', '상품', '품목', '내용'])).trim(),
        quantity: num(pick(r, ['구매수량', '수량'])),
        amount: num(pick(r, ['금액', '가격'])),
        note: String(pick(r, ['비고', '메모'])).trim(),
        sort_order: idx,
      })).filter(it => it.description || it.amount);
      if (!parsed.length) { alert('읽을 항목이 없습니다. 양식의 열 이름(월/일·구매상품·구매수량·금액·비고)을 확인하세요.'); return; }
      setItems(parsed.map((it, i) => ({ ...it, sort_order: i })));
      alert(`✅ ${parsed.length}건을 불러왔습니다. 내용 확인 후 상신하세요.`);
    } catch {
      alert('엑셀 읽기에 실패했습니다. 다운로드한 .xlsx 양식 파일인지 확인하세요.');
    }
  }

  function isMyTurn(approval: Approval): boolean {
    if (approval.status !== 'pending') return false;
    const hasStep2 = APPROVAL_LINES[approval.company]?.length === 3;
    if (hasStep2) {
      if (isAdmin && approval.approver1_status === 'pending') return true;
      if (isCeo && approval.approver1_status === 'approved' && approval.approver2_status === 'pending') return true;
    } else {
      // 2단계(담당·대표): 대표(CEO) 또는 IX글로벌은 실장(대표 자격)이 결재
      if (canFinalApprove(approval) && approval.approver1_status === 'pending') return true;
    }
    return false;
  }

  // ─── 상세 보기 ───
  if (view === 'detail' && selected) {
    const line = APPROVAL_LINES[selected.company] || [];
    const hasStep2 = line.length === 3;
    const approverSlots = hasStep2
      ? [
          { role: '담당', status: 'approved', at: selected.created_at },
          { role: '실장', status: selected.approver1_status, at: selected.approver1_at },
          { role: '대표', status: selected.approver2_status || selected.final_approver_status, at: selected.approver2_at || selected.final_approver_at },
        ]
      : [
          { role: '담당', status: 'approved', at: selected.created_at },
          { role: '대표', status: selected.approver1_status, at: selected.approver1_at },
        ];

    const myTurn = isMyTurn(selected);
    const canResubmit = selected.status === 'rejected' && selected.submitter_name === me?.name;
    const canDelete = (isCeo || selected.submitter_name === me?.name) && ['draft', 'rejected'].includes(selected.status);

    const isVacation = selected.doc_type === '휴가신청서';
    const vacTypeInfo = VACATION_TYPES.find(v => v.value === selected.vacation_type);

    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-2 no-print">
          <button onClick={() => setView('list')} className="text-base text-blue-600 hover:text-blue-700">← 목록으로</button>
          <button onClick={() => window.print()}
            className="px-4 py-2 bg-slate-700 hover:bg-slate-800 text-white rounded-xl text-sm font-medium">🖨️ 인쇄 / PDF 저장</button>
        </div>

        <div id="approval-print" className="bg-white rounded-2xl shadow-sm border border-gray-200 p-4 sm:p-8 max-w-3xl mx-auto">
          {/* 헤더 */}
          <div className="flex items-start justify-between gap-3 mb-6 flex-wrap">
            <div>
              <h2 className="text-xl sm:text-2xl font-bold text-gray-800 tracking-widest">
                〈 {isVacation ? '휴 가 신 청 서' : selected.doc_type === '카드구매' ? '매 입 품 의 서 (카드구매)' : '지 출 결 의 서'} 〉
              </h2>
              <div className="mt-2 flex items-center gap-2">
                <span className={`text-sm px-2 py-1 rounded-md font-medium ${STATUS_MAP[selected.status]?.color}`}>
                  {STATUS_MAP[selected.status]?.label}
                </span>
                <span className="text-sm text-gray-400">{selected.company}</span>
              </div>
            </div>
            <div className="border border-gray-400">
              <div className="flex">
                {approverSlots.map((a) => (
                  <div key={a.role} className="border-l border-gray-400 first:border-l-0 w-20 text-center">
                    <div className="text-sm py-1 border-b border-gray-400 bg-gray-50">{a.role}</div>
                    <div className="py-3 min-h-[48px] flex flex-col items-center justify-center">
                      {a.status === 'approved' && <span className="text-sm text-green-600 font-bold">승인</span>}
                      {a.status === 'rejected' && <span className="text-sm text-red-500 font-bold">반려</span>}
                      {a.at && a.status !== 'pending' && (
                        <span className="text-sm text-gray-400 mt-0.5">
                          {new Date(a.at).toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' })}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {selected.status === 'rejected' && selected.rejection_reason && (
            <div className="mb-4 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
              <div className="text-sm text-red-400 font-medium mb-1">반려 사유</div>
              <div className="text-base text-red-700">{selected.rejection_reason}</div>
            </div>
          )}

          {/* 휴가신청서 내용 */}
          {isVacation ? (
            <div className="border border-gray-400">
              {[
                { label: '신청자', value: selected.submitter_name },
                { label: '소속', value: selected.company },
                { label: '휴가 종류', value: vacTypeInfo?.label || selected.vacation_type },
                { label: '휴가 일자', value: selected.vacation_type === 'annual'
                    ? `${selected.vacation_start} ~ ${selected.vacation_end} (${selected.vacation_days}일)`
                    : `${selected.vacation_start} (0.5일) · ${vacTypeInfo?.time}` },
                { label: '사용 일수', value: `${selected.vacation_days}일` },
                { label: '신청 사유', value: selected.vacation_reason || '-' },
              ].map((row, i) => (
                <div key={i} className={`flex text-base ${i > 0 ? 'border-t border-gray-300' : ''}`}>
                  <div className="w-28 px-4 py-3 bg-gray-50 border-r border-gray-400 font-medium text-gray-600">{row.label}</div>
                  <div className="px-4 py-3 flex-1">{row.value}</div>
                </div>
              ))}
            </div>
          ) : (
            <>
              {/* 지출결의서 — 금액 */}
              <div className="border border-gray-400 mb-4">
                <div className="flex">
                  <div className="px-4 py-2 text-base font-medium bg-gray-50 border-r border-gray-400 w-28 text-center">일금(정)</div>
                  <div className="px-4 py-2 text-base flex-1">{numberToKorean(selected.total_amount)}</div>
                  <div className="px-4 py-2 text-base font-bold border-l border-gray-400 w-36 text-right">{selected.total_amount.toLocaleString()} 원</div>
                </div>
              </div>
              <div className="overflow-x-auto mb-4">
               <div className="border border-gray-400 min-w-[480px]">
                {[
                  { label: '발의', date: selected.issue_date, l2: '정리 인', v2: selected.organizer, l3: '처리사항', v3: selected.processor },
                  { label: '결재', date: selected.settle_date, l2: '인', v2: '', l3: '계정과목', v3: selected.account },
                  { label: '지출', date: selected.spend_date, l2: '인', v2: '', l3: '', v3: '' },
                ].map((row, i) => (
                  <div key={i} className={`flex text-base ${i > 0 ? 'border-t border-gray-400' : ''}`}>
                    <div className="w-12 px-2 py-2 bg-gray-50 border-r border-gray-400 text-center font-medium flex items-center justify-center">{row.label}</div>
                    <div className="px-3 py-2 border-r border-gray-400 w-36">{row.date}</div>
                    <div className="px-3 py-2 border-r border-gray-400 w-20 bg-gray-50 text-center">{row.l2}</div>
                    <div className="px-3 py-2 border-r border-gray-400 flex-1">{row.v2}</div>
                    <div className="px-3 py-2 border-r border-gray-400 w-20 bg-gray-50 text-center">{row.l3}</div>
                    <div className="px-3 py-2 flex-1">{row.v3}</div>
                  </div>
                ))}
               </div>
              </div>
              <div className="overflow-x-auto mb-4">
               <div className="border border-gray-400 min-w-[480px]">
                <div className="flex bg-gray-50 border-b border-gray-400 text-base font-medium text-center">
                  <div className="w-20 px-2 py-2 border-r border-gray-400">월/일</div>
                  <div className="flex-1 px-2 py-2 border-r border-gray-400">{selected.doc_type === '카드구매' ? '구매상품' : '적 요'}</div>
                  {selected.doc_type === '카드구매' && <div className="w-24 px-2 py-2 border-r border-gray-400">구매수량</div>}
                  <div className="w-32 px-2 py-2 border-r border-gray-400">금 액</div>
                  <div className="w-36 px-2 py-2">비 고</div>
                </div>
                {[...(selected.items || []), ...Array(Math.max(0, 5 - (selected.items?.length || 0))).fill(null)].map((item, i) => (
                  <div key={i} className={`flex border-t border-gray-200 text-base min-h-[36px] ${item?.canceled ? 'bg-red-50/50' : ''}`}>
                    <div className="w-20 px-2 py-2 border-r border-gray-400 text-center">{item?.item_date || ''}</div>
                    <div className={`flex-1 px-2 py-2 border-r border-gray-400 ${item?.canceled ? 'line-through text-red-400' : ''}`}>{item?.description || ''}{item?.canceled ? ' (취소)' : ''}</div>
                    {selected.doc_type === '카드구매' && <div className="w-24 px-2 py-2 border-r border-gray-400 text-right">{item?.quantity ? item.quantity.toLocaleString() : ''}</div>}
                    <div className="w-32 px-2 py-2 border-r border-gray-400 text-right">{item?.amount ? item.amount.toLocaleString() : ''}</div>
                    <div className="w-36 px-2 py-2">{item?.note || ''}</div>
                  </div>
                ))}
                <div className="flex border-t border-gray-400 text-base font-bold bg-gray-50">
                  <div className="w-20 px-2 py-2 border-r border-gray-400" />
                  <div className="flex-1 px-2 py-2 border-r border-gray-400 text-center">합 계</div>
                  {selected.doc_type === '카드구매' && <div className="w-24 px-2 py-2 border-r border-gray-400 text-right">{(selected.items || []).reduce((s, it) => s + (Number(it.quantity) || 0), 0).toLocaleString()}</div>}
                  <div className="w-32 px-2 py-2 border-r border-gray-400 text-right">₩{selected.total_amount.toLocaleString()}</div>
                  <div className="w-36 px-2 py-2" />
                </div>
               </div>
              </div>
              {/* 카드 매입 정보 */}
              {selected.card_id && (
                <div className={`border rounded-xl px-4 py-3 mb-4 ${selected.purchase_status === 'canceled' ? 'bg-red-50 border-red-200' : 'bg-blue-50 border-blue-100'}`}>
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <div className="text-base">
                      <span className="font-medium text-gray-700">💳 결제카드</span>
                      <span className="ml-2 text-gray-600">{cards.find(c => c.id === selected.card_id)?.card_name || '(삭제된 카드)'}</span>
                      {selected.purchase_vendor && <span className="ml-2 text-gray-400">· {selected.purchase_vendor}</span>}
                    </div>
                    {selected.payment_due_date && (
                      <div className="text-base text-blue-700">결제예정일 <span className="font-bold">{selected.payment_due_date}</span></div>
                    )}
                  </div>
                  {(selected.purchase_status === 'canceled' || selected.purchase_status === 'partial') && (
                    <div className="mt-2 text-base text-red-600 font-medium">
                      ⚠️ {selected.purchase_status === 'canceled' ? '전체 취소됨' : '일부 항목 취소됨'} · 환불예정일 {selected.refund_due_date}
                      {' '}(-{(selected.items || []).filter(i => i.canceled).reduce((s, i) => s + (i.amount || 0), 0).toLocaleString()}원)
                    </div>
                  )}
                </div>
              )}

              {/* 첨부파일 */}
              {selected.attachments && selected.attachments.length > 0 && (
                <div className="border border-gray-200 rounded-xl p-4 mb-4">
                  <div className="text-sm font-medium text-gray-600 mb-2">📎 첨부파일 (영수증·증빙)</div>
                  <div className="space-y-1.5 no-print">
                    {selected.attachments.map((f, i) => (
                      <a key={i} href={f.url} target="_blank" rel="noopener noreferrer"
                        className="flex items-center gap-2 text-sm text-blue-600 hover:underline">
                        <span>📄</span>{f.name}
                      </a>
                    ))}
                  </div>
                  {/* 이미지 증빙은 인쇄/화면에 그대로 표시 (세무 보관용) */}
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    {selected.attachments.filter(f => /\.(png|jpe?g|gif|webp|heic)$/i.test(f.url)).map((f, i) => (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img key={i} src={f.url} alt={f.name} className="w-full rounded-lg border border-gray-100 object-contain max-h-80" />
                    ))}
                  </div>
                </div>
              )}

              <div className="text-center text-base text-gray-600 border border-gray-400 py-4 mb-6">
                <p>위 금액을 정히 영수(청구) 합니다.</p>
                <p className="mt-1">{selected.issue_date} &nbsp;&nbsp; 영수자 [ {selected.organizer} ]</p>
              </div>
            </>
          )}

          {isVacation && (
            <div className="text-center text-base text-gray-600 border-t border-gray-200 pt-4 mt-4">
              <p>위와 같이 휴가를 신청합니다.</p>
              <p className="mt-1">{selected.issue_date} &nbsp;&nbsp; 신청자 [ {selected.submitter_name} ]</p>
            </div>
          )}

          <div className="flex gap-3 justify-end mt-6 flex-wrap no-print">
            {myTurn && (
              <>
                <button onClick={() => handleApprove(selected)}
                  className="px-5 py-2 bg-green-600 hover:bg-green-700 text-white rounded-xl text-base font-medium">승인</button>
                <button onClick={() => setShowRejectModal(true)}
                  className="px-5 py-2 bg-red-500 hover:bg-red-600 text-white rounded-xl text-base font-medium">반려</button>
              </>
            )}
            {canResubmit && (
              <button onClick={() => openResubmit(selected)}
                className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-base font-medium">수정 후 재상신</button>
            )}
            {/* 카드 매입 취소/철회 (승인된 카드 결제건, 항목별 부분취소) */}
            {selected.doc_type !== '휴가신청서' && selected.card_id && selected.status === 'approved' &&
              (isCeo || isAdmin || selected.submitter_name === me?.name) && (
                <>
                  {selected.purchase_status !== 'canceled' && (
                    <button onClick={() => openCancelModal(selected)}
                      className="px-5 py-2 border border-orange-200 text-orange-600 rounded-xl text-base hover:bg-orange-50">구매 취소(환불)</button>
                  )}
                  {(selected.purchase_status === 'canceled' || selected.purchase_status === 'partial') && (
                    <button onClick={() => handleUncancelPurchase(selected)}
                      className="px-5 py-2 border border-gray-200 text-gray-600 rounded-xl text-base hover:bg-gray-50">취소 철회</button>
                  )}
                </>
              )}
            {canDelete && (
              <button onClick={() => handleDelete(selected.id)}
                className="px-5 py-2 border border-red-200 text-red-500 rounded-xl text-base hover:bg-red-50">삭제</button>
            )}
          </div>
        </div>

        {/* 카드 매입 취소 모달 (항목별 부분취소) */}
        {showCancelModal && (
          <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4 overflow-y-auto">
            <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 my-8">
              <h3 className="text-lg font-bold text-gray-800 mb-1">구매 취소 (환불 처리)</h3>
              <p className="text-sm text-gray-500 mb-4">취소할 항목을 선택하세요. 일부만 선택하면 부분취소됩니다.</p>

              <div className="border border-gray-200 rounded-xl overflow-hidden mb-4">
                <div className="flex bg-gray-50 border-b border-gray-200 text-xs font-medium text-gray-500">
                  <div className="w-8 px-2 py-2" />
                  <div className="flex-1 px-2 py-2">구매상품</div>
                  <div className="w-16 px-2 py-2 text-right">수량</div>
                  <div className="w-24 px-2 py-2 text-right">금액</div>
                </div>
                {(selected.items || []).map((it, i) => {
                  const disabled = it.canceled;
                  const checked = cancelItemIds.has(it.id || '');
                  return (
                    <div key={i} className={`flex border-t border-gray-100 text-sm ${disabled ? 'bg-red-50/50' : ''}`}>
                      <div className="w-8 px-2 py-2 flex items-center justify-center">
                        {disabled ? <span className="text-[10px] text-red-500">취소됨</span> : (
                          <input type="checkbox" checked={checked}
                            onChange={() => setCancelItemIds(prev => { const n = new Set(prev); const k = it.id || ''; n.has(k) ? n.delete(k) : n.add(k); return n; })}
                            className="w-4 h-4 rounded border-gray-300 text-orange-600 cursor-pointer" />
                        )}
                      </div>
                      <div className={`flex-1 px-2 py-2 ${disabled ? 'line-through text-red-400' : 'text-gray-700'}`}>{it.description || '-'}</div>
                      <div className="w-16 px-2 py-2 text-right text-gray-600">{it.quantity ? it.quantity.toLocaleString() : '-'}</div>
                      <div className="w-24 px-2 py-2 text-right text-gray-700">{it.amount ? it.amount.toLocaleString() : '-'}</div>
                    </div>
                  );
                })}
              </div>

              <div className="bg-orange-50 rounded-lg px-3 py-2 mb-3 text-sm text-orange-700">
                선택 취소 금액: <span className="font-bold">−{(selected.items || []).filter(i => cancelItemIds.has(i.id || '')).reduce((s, i) => s + (i.amount || 0), 0).toLocaleString()}원</span>
              </div>

              <label className="block text-sm font-medium text-gray-500 mb-1">환불 예정일</label>
              <input type="date" value={refundDate} onChange={e => setRefundDate(e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-base focus:outline-none focus:ring-2 focus:ring-orange-400" />
              <p className="text-sm text-gray-400 mt-1.5">보통 다음 카드 명세서에 반영됩니다. (자동 계산됨, 수정 가능)</p>

              <div className="flex gap-3 mt-5">
                <button onClick={() => handleCancelPurchase(selected)}
                  className="flex-1 px-5 py-2.5 bg-orange-500 hover:bg-orange-600 text-white rounded-xl text-base font-medium">취소 확정</button>
                <button onClick={() => setShowCancelModal(false)}
                  className="px-5 py-2.5 border border-gray-200 text-gray-600 rounded-xl text-base hover:bg-gray-50">닫기</button>
              </div>
            </div>
          </div>
        )}

        {showRejectModal && (
          <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6">
              <h3 className="text-lg font-bold text-gray-800 mb-4">반려 사유</h3>
              <textarea value={rejectReason} onChange={(e) => setRejectReason(e.target.value)}
                placeholder="반려 사유를 입력해주세요" rows={4}
                className="w-full px-4 py-3 border border-gray-200 rounded-xl text-base focus:outline-none focus:ring-2 focus:ring-red-400 resize-none" />
              <div className="flex gap-3 mt-4">
                <button onClick={() => handleReject(selected)}
                  className="px-5 py-2.5 bg-red-500 hover:bg-red-600 text-white rounded-xl text-base font-medium flex-1">반려 확인</button>
                <button onClick={() => { setShowRejectModal(false); setRejectReason(''); }}
                  className="px-5 py-2.5 border border-gray-200 text-gray-600 rounded-xl text-base hover:bg-gray-50">취소</button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ─── 작성/수정 폼 ───
  if (view === 'form') return (
    <div className="space-y-4">
      <button onClick={() => { setView('list'); resetForm(); }} className="text-base text-blue-600 hover:text-blue-700">← 목록으로</button>

      {/* 문서 종류 선택 */}
      {!editId && (
        <div className="flex gap-2 flex-wrap">
          {(['지출결의서', '카드구매', '휴가신청서'] as DocType[]).map(dt => (
            <button key={dt} onClick={() => setDocType(dt)}
              className={`px-4 py-2 rounded-xl text-base font-medium transition-colors ${docType === dt ? 'bg-slate-700 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
              {DOC_TYPE_LABELS[dt]}
            </button>
          ))}
        </div>
      )}

      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-4 sm:p-8 max-w-3xl mx-auto">
        {/* ── 휴가신청서 폼 ── */}
        {docType === '휴가신청서' ? (
          <>
            <div className="flex items-start justify-between mb-6">
              <h2 className="text-2xl font-bold text-gray-800 tracking-widest">〈 휴 가 신 청 서 〉</h2>
              <div className="text-right">
                <div className="text-sm text-gray-400 mb-1">연차 현황</div>
                <div className="text-base font-bold text-gray-700">
                  {myEmployee?.hire_date ? (
                    <>부여 <span className="text-blue-600">{entitlement}일</span> · 사용 <span className="text-orange-500">{usedLeave}일</span> · 잔여 <span className={remaining < 0 ? 'text-red-500' : 'text-green-600'}>{remaining}일</span></>
                  ) : (
                    <span className="text-gray-400 text-sm">입사일 미등록</span>
                  )}
                </div>
              </div>
            </div>

            <div className="border border-gray-400">
              <div className="flex text-base border-b border-gray-300">
                <div className="w-28 px-4 py-3 bg-gray-50 border-r border-gray-400 font-medium text-gray-600">신청자</div>
                <div className="px-4 py-3 flex-1 text-gray-700">{me?.name}</div>
              </div>
              <div className="flex text-base border-b border-gray-300">
                <div className="w-28 px-4 py-3 bg-gray-50 border-r border-gray-400 font-medium text-gray-600">소속</div>
                <div className="px-4 py-3 flex-1 text-gray-700">{me?.company}</div>
              </div>
              <div className="flex text-base border-b border-gray-300">
                <div className="w-28 px-4 py-3 bg-gray-50 border-r border-gray-400 font-medium text-gray-600">휴가 종류</div>
                <div className="px-4 py-2 flex-1 flex gap-3 items-center flex-wrap">
                  {VACATION_TYPES.map(vt => (
                    <label key={vt.value} className="flex items-center gap-1.5 cursor-pointer">
                      <input type="radio" name="vacationType" value={vt.value}
                        checked={vacationType === vt.value}
                        onChange={() => setVacationType(vt.value)}
                        className="accent-blue-600" />
                      <span className="text-base text-gray-700">{vt.label}</span>
                      <span className="text-sm text-gray-400">({vt.time})</span>
                    </label>
                  ))}
                </div>
              </div>
              <div className="flex text-base border-b border-gray-300">
                <div className="w-28 px-4 py-3 bg-gray-50 border-r border-gray-400 font-medium text-gray-600">휴가 일자</div>
                <div className="px-4 py-2 flex-1 flex items-center gap-2 flex-wrap">
                  <input type="date" value={vacationStart} onChange={(e) => setVacationStart(e.target.value)}
                    className="text-base focus:outline-none border border-gray-200 rounded-lg px-2 py-1.5" />
                  {vacationType === 'annual' && (
                    <>
                      <span className="text-base text-gray-400">~</span>
                      <input type="date" value={vacationEnd} onChange={(e) => setVacationEnd(e.target.value)}
                        min={vacationStart}
                        className="text-base focus:outline-none border border-gray-200 rounded-lg px-2 py-1.5" />
                    </>
                  )}
                  <span className="text-base font-medium text-blue-600">({vacDays}일)</span>
                </div>
              </div>
              <div className="flex text-base">
                <div className="w-28 px-4 py-3 bg-gray-50 border-r border-gray-400 font-medium text-gray-600">신청 사유</div>
                <div className="px-4 py-2 flex-1">
                  <input value={vacationReason} onChange={(e) => setVacationReason(e.target.value)}
                    placeholder="사유를 입력하세요"
                    className="w-full text-base focus:outline-none border-b border-gray-200 pb-1 focus:border-blue-400 outline-none" />
                </div>
              </div>
            </div>

            <div className="text-center text-base text-gray-600 border border-gray-200 py-3 mt-4 mb-6 rounded-xl bg-gray-50">
              <p>위와 같이 휴가를 신청합니다.</p>
              <p className="mt-1">{today()} &nbsp;&nbsp; 신청자 [ {me?.name} ]</p>
            </div>

            {vacDays > remaining && remaining >= 0 && (
              <div className="mb-4 bg-orange-50 border border-orange-200 rounded-xl px-4 py-3 text-base text-orange-700">
                ⚠️ 신청 일수({vacDays}일)가 잔여 연차({remaining}일)를 초과합니다.
              </div>
            )}
          </>
        ) : (
          /* ── 지출결의서 폼 ── */
          <>
            <div className="flex items-center gap-3 mb-4">
              <span className="text-base font-medium text-gray-600">사업자</span>
              <div className="flex gap-2">
                {COMPANIES.map(c => (
                  <button key={c} onClick={() => setCompany(c)}
                    className={`px-3 py-1.5 rounded-lg text-base font-medium transition-colors ${company === c ? 'bg-slate-700 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
                    {c}
                  </button>
                ))}
              </div>
            </div>

            {/* 결제 카드 / 구매처 */}
            {docType === '카드구매' && (
              <div className="mb-3 flex gap-2">
                <button type="button" onClick={() => setIsPrepay(false)}
                  className={`px-4 py-2 rounded-lg text-base font-medium ${!isPrepay ? 'bg-amber-600 text-white' : 'bg-white border border-gray-200 text-gray-600'}`}>카드구매 (한도 차감)</button>
                <button type="button" onClick={() => setIsPrepay(true)}
                  className={`px-4 py-2 rounded-lg text-base font-medium ${isPrepay ? 'bg-green-600 text-white' : 'bg-white border border-gray-200 text-gray-600'}`}>선결제 (한도 복구)</button>
              </div>
            )}
            {docType === '카드구매' && isPrepay && (
              <p className="text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2 mb-3">💳 선결제: 기존 카드 사용분을 앞당겨 결제 → 승인되면 해당 카드 <b>잔여한도가 복구</b>되고 결제 캘린더에 −금액으로 기록됩니다.</p>
            )}
            <div className={`grid sm:grid-cols-2 gap-3 mb-6 border rounded-xl p-4 ${docType === '카드구매' ? (isPrepay ? 'bg-green-50/60 border-green-200' : 'bg-amber-50/60 border-amber-200') : 'bg-blue-50/50 border-blue-100'}`}>
              <div>
                <label className="block text-sm font-medium text-gray-500 mb-1">
                  결제 카드{docType === '카드구매' && <span className="text-red-500"> *</span>}
                </label>
                <select value={cardId} onChange={e => setCardId(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-base bg-white focus:outline-none focus:ring-2 focus:ring-blue-400">
                  <option value="">{docType === '카드구매' ? '카드를 선택하세요' : '선택 안 함 (현금/계좌이체 등)'}</option>
                  {cards.map(c => (
                    <option key={c.id} value={c.id}>[{c.card_type}] {c.card_name} {c.holder_name ? `· ${c.holder_name}` : ''}</option>
                  ))}
                </select>
                {selectedCard && paymentDuePreview && (
                  <p className="text-sm text-blue-600 mt-1.5">💳 결제예정일: <span className="font-bold">{paymentDuePreview}</span> (구매일 {spendDate} 기준)</p>
                )}
                {cards.length === 0 && (
                  <p className="text-sm text-gray-400 mt-1.5">카드·매입 메뉴에서 카드를 먼저 등록하세요.</p>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-500 mb-1">구매처 (홈쇼핑사 등)</label>
                <input value={purchaseVendor} onChange={e => setPurchaseVendor(e.target.value)}
                  placeholder="예: GS홈쇼핑, 롯데홈쇼핑"
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-base bg-white focus:outline-none focus:ring-2 focus:ring-blue-400" />
              </div>
            </div>

            <div className="flex items-start justify-between mb-6">
              <h2 className="text-xl sm:text-2xl font-bold text-gray-800 tracking-widest">〈 {docType === '카드구매' ? (isPrepay ? '카 드 선 결 제' : '매 입 품 의 서 (카드구매)') : '지 출 결 의 서'} 〉</h2>
              <div className="border border-gray-400">
                <div className="flex">
                  {approvalLine.map((role) => (
                    <div key={role} className="border-l border-gray-400 first:border-l-0 w-20 text-center">
                      <div className="text-sm py-1 border-b border-gray-400 bg-gray-50">{role}</div>
                      <div className="py-6" />
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="border border-gray-400 mb-4">
              <div className="flex">
                <div className="px-4 py-2 text-base font-medium bg-gray-50 border-r border-gray-400 w-28 text-center">일금(정)</div>
                <div className="px-4 py-2 text-base flex-1 text-gray-600">{total > 0 ? numberToKorean(total) : ''}</div>
                <div className="px-4 py-2 text-base font-bold border-l border-gray-400 w-36 text-right">{total > 0 ? `${total.toLocaleString()} 원` : ''}</div>
              </div>
            </div>

            <div className="border border-gray-400 mb-4">
              {[
                { label: '발의', date: issueDate, setDate: setIssueDate, l2: '정리 인', v2: organizer, sv2: setOrganizer, l3: '처리사항', v3: processor, sv3: setProcessor },
                { label: '결재', date: settleDate, setDate: setSettleDate, l2: '인', v2: null, sv2: null, l3: '계정과목', v3: account, sv3: setAccount },
                { label: '지출', date: spendDate, setDate: setSpendDate, l2: '인', v2: null, sv2: null, l3: '', v3: null, sv3: null },
              ].map((row, i) => (
                <div key={i} className={`flex text-base ${i > 0 ? 'border-t border-gray-400' : ''}`}>
                  <div className="w-12 px-2 py-1 bg-gray-50 border-r border-gray-400 text-center font-medium flex items-center justify-center">{row.label}</div>
                  <div className="px-1 py-1 border-r border-gray-400 w-36">
                    {row.label === '지출' && docType === '카드구매' ? (
                      <input type="date" value={row.date} readOnly disabled
                        className="w-full text-base px-1 bg-amber-50 text-amber-700 font-medium" title="카드 결제일로 자동 설정됨" />
                    ) : (
                      <input type="date" value={row.date} onChange={(e) => row.setDate(e.target.value)} className="w-full text-base focus:outline-none px-1" />
                    )}
                  </div>
                  <div className="px-2 py-2 border-r border-gray-400 w-20 bg-gray-50 text-center text-sm flex items-center justify-center">{row.l2}</div>
                  <div className="px-1 py-1 border-r border-gray-400 flex-1">
                    {row.sv2 && <input value={row.v2 ?? ''} onChange={(e) => row.sv2!(e.target.value)} className="w-full text-base focus:outline-none px-1" />}
                  </div>
                  <div className="px-2 py-2 border-r border-gray-400 w-20 bg-gray-50 text-center text-sm flex items-center justify-center">{row.l3}</div>
                  <div className="px-1 py-1 flex-1">
                    {row.sv3 && <input value={row.v3 ?? ''} onChange={(e) => row.sv3!(e.target.value)} className="w-full text-base focus:outline-none px-1" />}
                  </div>
                </div>
              ))}
            </div>

            <div className="border border-gray-400 mb-1">
              <div className="flex bg-gray-50 border-b border-gray-400 text-base font-medium text-center">
                <div className="w-20 px-2 py-2 border-r border-gray-400">월/일</div>
                <div className="flex-1 px-2 py-2 border-r border-gray-400">{docType === '카드구매' ? '구매상품' : '적 요'}</div>
                {docType === '카드구매' && <div className="w-24 px-2 py-2 border-r border-gray-400">구매수량</div>}
                <div className="w-32 px-2 py-2 border-r border-gray-400">금 액</div>
                <div className="w-36 px-2 py-2">비 고</div>
              </div>
              {items.map((item, i) => (
                <div key={i} className="flex border-t border-gray-200 text-base">
                  <div className="w-20 border-r border-gray-400">
                    <input value={item.item_date} onChange={(e) => updateItem(i, 'item_date', e.target.value)}
                      className="w-full px-2 py-2 text-center focus:outline-none focus:bg-blue-50 text-base" />
                  </div>
                  <div className="flex-1 border-r border-gray-400">
                    <input value={item.description} onChange={(e) => updateItem(i, 'description', e.target.value)}
                      className="w-full px-2 py-2 focus:outline-none focus:bg-blue-50 text-base" />
                  </div>
                  {docType === '카드구매' && (
                    <div className="w-24 border-r border-gray-400">
                      <input type="text" inputMode="numeric" value={item.quantity ? item.quantity.toLocaleString() : ''}
                        onChange={(e) => updateItem(i, 'quantity', Number(e.target.value.replace(/[^\d]/g, '')) || 0)}
                        className="w-full px-2 py-2 text-right focus:outline-none focus:bg-blue-50 text-base" />
                    </div>
                  )}
                  <div className="w-32 border-r border-gray-400">
                    <input type="text" inputMode="numeric" value={item.amount ? item.amount.toLocaleString() : ''}
                      onChange={(e) => updateItem(i, 'amount', Number(e.target.value.replace(/[^\d]/g, '')) || 0)}
                      className="w-full px-2 py-2 text-right focus:outline-none focus:bg-blue-50 text-base" />
                  </div>
                  <div className="w-36">
                    <input value={item.note} onChange={(e) => updateItem(i, 'note', e.target.value)}
                      className="w-full px-2 py-2 focus:outline-none focus:bg-blue-50 text-base" />
                  </div>
                </div>
              ))}
              <div className="flex border-t border-gray-400 text-base font-bold bg-gray-50">
                <div className="w-20 px-2 py-2 border-r border-gray-400" />
                <div className="flex-1 px-2 py-2 border-r border-gray-400 text-center">합 계</div>
                {docType === '카드구매' && <div className="w-24 px-2 py-2 border-r border-gray-400 text-right">{items.reduce((s, it) => s + (Number(it.quantity) || 0), 0).toLocaleString()}</div>}
                <div className="w-32 px-2 py-2 border-r border-gray-400 text-right">₩{total.toLocaleString()}</div>
                <div className="w-36 px-2 py-2" />
              </div>
            </div>
            <div className="flex items-center gap-3 flex-wrap mb-4">
              <button onClick={() => setItems(p => [...p, { ...EMPTY_ITEM, sort_order: p.length }])}
                className="text-sm text-blue-500 hover:underline">+ 항목 추가</button>
              <span className="text-gray-300">|</span>
              <button onClick={downloadItemTemplate} className="text-sm text-green-600 hover:underline">⬇️ 엑셀 양식 다운로드</button>
              <label className="text-sm text-blue-600 hover:underline cursor-pointer">
                📤 엑셀로 품목 불러오기
                <input type="file" accept=".xlsx" className="hidden"
                  onChange={e => { handleItemExcel(e.target.files?.[0] || null); e.target.value = ''; }} />
              </label>
              <span className="text-xs text-gray-400">긴 구매 품목은 엑셀 양식에 작성해 한 번에 올리세요</span>
            </div>

            {/* 첨부파일 */}
            <div className="border border-gray-200 rounded-xl p-4 mb-6 bg-gray-50/50">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-gray-600">📎 첨부파일 <span className="text-xs text-gray-400">(영수증·견적서 등)</span></span>
                <label className="px-3 py-1.5 bg-white border border-gray-200 rounded-lg text-sm text-blue-600 cursor-pointer hover:bg-blue-50">
                  {uploading ? '업로드 중...' : '파일 선택'}
                  <input type="file" multiple className="hidden" disabled={uploading}
                    onChange={e => { handleFileUpload(e.target.files); e.target.value = ''; }} />
                </label>
              </div>
              {attachments.length === 0 ? (
                <div className="text-xs text-gray-400 py-2">첨부된 파일이 없습니다</div>
              ) : (
                <div className="space-y-1.5">
                  {attachments.map((f, i) => (
                    <div key={i} className="flex items-center justify-between bg-white border border-gray-100 rounded-lg px-3 py-2">
                      <a href={f.url} target="_blank" rel="noopener noreferrer" className="text-sm text-blue-600 hover:underline truncate">{f.name}</a>
                      <button onClick={() => setAttachments(prev => prev.filter((_, idx) => idx !== i))}
                        className="text-xs text-gray-400 hover:text-red-500 ml-2 flex-shrink-0">삭제</button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="text-center text-base text-gray-600 border border-gray-400 py-3 mb-6">
              <p>위 금액을 정히 영수(청구) 합니다.</p>
              <p className="mt-1">{issueDate} &nbsp;&nbsp; 영수자 [ {organizer} ]</p>
            </div>
          </>
        )}

        <div className="flex gap-3 justify-end">
          <button onClick={() => handleSave(false)} disabled={saving}
            className="px-5 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl text-base font-medium">
            임시저장
          </button>
          <button onClick={() => handleSave(true)} disabled={saving}
            className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-base font-medium disabled:opacity-50">
            {saving ? '저장 중...' : editId ? '재상신' : '상신'}
          </button>
        </div>
      </div>
    </div>
  );

  // ─── 연차 현황 뷰 ───
  if (view === 'leave') {
    const VTYPE_LABEL: Record<string, string> = { annual: '연차', half_am: '반차(오전)', half_pm: '반차(오후)' };
    return (
      <div className="space-y-4">
        {/* 상단 탭 */}
        <div className="flex items-center gap-3 flex-wrap">
          <button onClick={() => setView('list')}
            className="px-3 py-2 rounded-xl text-base font-medium bg-white border border-gray-200 text-gray-600 hover:bg-gray-50">
            ← 결재 목록
          </button>
          <h2 className="text-lg font-bold text-gray-800">직원 연차 현황 ({new Date().getFullYear()}년)</h2>
          <div className="ml-auto flex items-center gap-2 flex-wrap">
            <button onClick={applyStatutoryLeave}
              className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium">📅 입사일 기준 법정연차 자동적용</button>
            <button onClick={loadLeaveData}
              className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg text-gray-500 hover:bg-gray-50">새로고침</button>
          </div>
        </div>

        {leaveLoading ? (
          <div className="text-center py-12 text-gray-400">불러오는 중...</div>
        ) : (
          <div className="space-y-3">
            {leaveRows.map(row => (
              <div key={row.id} className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
                {/* 직원 요약 행 */}
                <div
                  className="flex items-center px-5 py-4 cursor-pointer hover:bg-gray-50"
                  onClick={() => setExpandedEmp(expandedEmp === row.id ? null : row.id)}
                >
                  <div className="flex-1">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center text-base font-bold text-blue-600">
                        {row.name[0]}
                      </div>
                      <div>
                        <div className="font-medium text-gray-800">{row.name}</div>
                        <div className="text-sm text-gray-400">{row.company} · 입사일: {row.hire_date || '미등록'}</div>
                      </div>
                    </div>
                  </div>
                  {/* 연차 현황 바 */}
                  <div className="flex items-center gap-6 mr-4">
                    <div className="text-center" onClick={e => e.stopPropagation()}>
                      {editingLeave === row.id ? (
                        <div className="flex items-center gap-1">
                          <input
                            type="number" value={editLeaveVal} min={0} max={99} step={0.5}
                            onChange={e => setEditLeaveVal(Number(e.target.value))}
                            onKeyDown={e => { if (e.key === 'Enter') saveLeaveTotal(row.id); if (e.key === 'Escape') setEditingLeave(null); }}
                            className="w-14 text-center border border-blue-400 rounded-lg text-base font-bold px-1 py-0.5 focus:outline-none"
                            autoFocus
                          />
                          <button onClick={() => saveLeaveTotal(row.id)} className="text-sm text-blue-600 font-medium hover:underline">저장</button>
                          <button onClick={() => setEditingLeave(null)} className="text-sm text-gray-400 hover:underline">취소</button>
                        </div>
                      ) : (
                        <div
                          className="text-lg font-bold text-gray-700 cursor-pointer hover:text-blue-600 group relative"
                          title="클릭하여 수정"
                          onClick={() => { setEditingLeave(row.id); setEditLeaveVal(row.annual_leave_total); }}
                        >
                          {row.annual_leave_total}
                          <span className="text-sm text-blue-400 ml-0.5 opacity-0 group-hover:opacity-100">✏️</span>
                        </div>
                      )}
                      <div className="text-sm text-gray-400">부여</div>
                      {statutoryLeave(row.hire_date) != null && (
                        <div className={`text-[10px] ${statutoryLeave(row.hire_date) === row.annual_leave_total ? 'text-gray-300' : 'text-blue-400'}`}>법정 {statutoryLeave(row.hire_date)}</div>
                      )}
                    </div>
                    <div className="text-center">
                      <div className="text-lg font-bold text-orange-500">{row.used}</div>
                      <div className="text-sm text-gray-400">사용</div>
                    </div>
                    <div className="text-center">
                      <div className={`text-lg font-bold ${row.remaining < 0 ? 'text-red-500' : row.remaining <= 3 ? 'text-orange-500' : 'text-green-600'}`}>
                        {row.remaining}
                      </div>
                      <div className="text-sm text-gray-400">잔여</div>
                    </div>
                  </div>
                  {/* 진행 바 */}
                  <div className="w-32 hidden sm:block">
                    <div className="text-sm text-gray-400 mb-1 text-right">{row.annual_leave_total > 0 ? Math.round(row.used / row.annual_leave_total * 100) : 0}% 사용</div>
                    <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-orange-400 rounded-full transition-all"
                        style={{ width: `${row.annual_leave_total > 0 ? Math.min(100, row.used / row.annual_leave_total * 100) : 0}%` }}
                      />
                    </div>
                  </div>
                  <div className="ml-4 text-gray-400 text-base">{expandedEmp === row.id ? '▲' : '▼'}</div>
                </div>

                {/* 사용 내역 (펼치기) */}
                {expandedEmp === row.id && (
                  <div className="border-t border-gray-100 px-5 pb-4">
                    {row.history.length === 0 ? (
                      <div className="text-center py-6 text-base text-gray-400">사용 내역 없음</div>
                    ) : (
                      <table className="w-full text-base mt-3">
                        <thead>
                          <tr className="text-sm text-gray-400 border-b border-gray-100">
                            <th className="py-2 text-left font-medium">일자</th>
                            <th className="py-2 text-left font-medium">종류</th>
                            <th className="py-2 text-left font-medium">사유</th>
                            <th className="py-2 text-right font-medium">사용일수</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-50">
                          {row.history.map((h, i) => (
                            <tr key={i}>
                              <td className="py-2 text-gray-600">
                                {h.vacation_start}{h.vacation_end && h.vacation_end !== h.vacation_start ? ` ~ ${h.vacation_end}` : ''}
                              </td>
                              <td className="py-2">
                                <span className="text-sm px-2 py-0.5 rounded-md bg-blue-50 text-blue-600 font-medium">
                                  {VTYPE_LABEL[h.vacation_type || ''] || h.vacation_type}
                                </span>
                              </td>
                              <td className="py-2 text-gray-500">{h.vacation_reason || '-'}</td>
                              <td className="py-2 text-right font-medium text-orange-500">{h.vacation_days}일</td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot>
                          <tr className="border-t border-gray-200">
                            <td colSpan={3} className="py-2 text-sm text-gray-400">합계</td>
                            <td className="py-2 text-right font-bold text-orange-500">{row.used}일</td>
                          </tr>
                        </tfoot>
                      </table>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // ─── 목록 ───
  const myTurnCount = approvals.filter(isMyTurn).length;
  const shown = filterStatus === 'myturn'
    ? approvals.filter(isMyTurn)
    : filterStatus === 'all'
      ? approvals
      : approvals.filter((a) => a.status === filterStatus);
  return (
    <div className="space-y-4">
      {/* 상단 탭 */}
      <div className="flex items-center gap-2 border-b border-gray-200 pb-3">
        <button
          className="px-4 py-2 rounded-t-lg text-base font-medium border-b-2 border-blue-600 text-blue-600 bg-white"
        >
          결재 문서
        </button>
        {(isCeo || isAdmin) && (
          <button
            onClick={() => { setView('leave'); loadLeaveData(); }}
            className="px-4 py-2 rounded-t-lg text-base font-medium border-b-2 border-transparent text-gray-500 hover:text-gray-700"
          >
            연차 현황
          </button>
        )}
      </div>

      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex gap-2 flex-wrap">
          {(isCeo || isAdmin) && (
            <button onClick={() => setFilterStatus('myturn')}
              className={`px-3 py-2 rounded-xl text-base font-medium transition-colors border ${filterStatus === 'myturn' ? 'bg-yellow-500 text-white border-yellow-500' : 'bg-yellow-50 border-yellow-200 text-yellow-700 hover:bg-yellow-100'}`}>
              ⏳ 내 결재 대기{myTurnCount > 0 ? ` (${myTurnCount})` : ''}
            </button>
          )}
          {[['all','전체'], ['draft','임시저장'], ['pending','결재중'], ['approved','승인완료'], ['rejected','반려']].map(([v, l]) => (
            <button key={v} onClick={() => setFilterStatus(v)}
              className={`px-3 py-2 rounded-xl text-base font-medium transition-colors ${filterStatus === v ? 'bg-slate-700 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
              {l}
            </button>
          ))}
        </div>
        <div className="flex gap-2 flex-wrap">
          {(isCeo || isAdmin) && (
            <>
              <button onClick={exportTaxExcel} disabled={exporting}
                className="px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-green-300 text-white rounded-xl text-base font-medium">
                {exporting ? '처리 중...' : '🧾 세무용 엑셀'}
              </button>
              <button onClick={printAllApproved} disabled={exporting}
                className="px-4 py-2 bg-slate-700 hover:bg-slate-800 disabled:bg-slate-400 text-white rounded-xl text-base font-medium">
                🖨️ 승인건 전체 PDF
              </button>
            </>
          )}
          <button onClick={() => { resetForm(); setView('form'); }}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-base font-medium">
            + 문서 작성
          </button>
        </div>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        {loading ? (
          <div className="text-center py-12 text-gray-400">불러오는 중...</div>
        ) : shown.length === 0 ? (
          <div className="text-center py-12 text-gray-400">
            {filterStatus === 'myturn' ? '내가 결재할 문서가 없습니다' : '결재 문서가 없습니다'}
          </div>
        ) : (
          <>
            {/* 데스크탑: 표 */}
            <div className="overflow-x-auto hidden sm:block">
              <table className="w-full text-base">
                <thead className="bg-gray-50 border-b border-gray-100">
                  <tr>
                    {['문서종류', '사업자', '발의일', '내용', '작성자', '상태', ''].map(h => (
                      <th key={h} className="px-4 py-3 text-left text-sm font-medium text-gray-500">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {shown.map(a => (
                    <tr key={a.id} onClick={() => loadDetail(a.id)} className="hover:bg-blue-50/40 cursor-pointer">
                      <td className="px-4 py-3 font-medium text-gray-800">{a.doc_type}</td>
                      <td className="px-4 py-3 text-gray-500">{a.company}</td>
                      <td className="px-4 py-3 text-gray-500">{a.issue_date}</td>
                      <td className="px-4 py-3 text-gray-500 text-sm">
                        {a.doc_type === '휴가신청서'
                          ? `${VACATION_TYPES.find(v => v.value === a.vacation_type)?.label || a.vacation_type} ${a.vacation_days}일`
                          : `${a.total_amount.toLocaleString()}원`}
                      </td>
                      <td className="px-4 py-3 text-gray-500">{a.submitter_name}</td>
                      <td className="px-4 py-3">
                        <span className={`text-sm px-2 py-0.5 rounded-md font-medium ${STATUS_MAP[a.status]?.color}`}>
                          {STATUS_MAP[a.status]?.label}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right" onClick={e => e.stopPropagation()}>
                        {isMyTurn(a) && (
                          <button onClick={(e) => quickApprove(a, e)}
                            className="px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm font-medium">✓ 승인</button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* 모바일: 카드형 */}
            <div className="sm:hidden divide-y divide-gray-100">
              {shown.map(a => (
                <div key={a.id} onClick={() => loadDetail(a.id)} className="px-4 py-3.5 active:bg-blue-50/40">
                  <div className="flex items-center justify-between gap-2 mb-1.5">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="font-bold text-gray-800 text-[15px]">{a.doc_type}</span>
                      <span className="text-sm text-gray-400 truncate">{a.company}</span>
                    </div>
                    <span className={`text-sm px-2 py-0.5 rounded-md font-medium flex-shrink-0 ${STATUS_MAP[a.status]?.color}`}>
                      {STATUS_MAP[a.status]?.label}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-base text-gray-600 font-medium">
                      {a.doc_type === '휴가신청서'
                        ? `${VACATION_TYPES.find(v => v.value === a.vacation_type)?.label || a.vacation_type} ${a.vacation_days}일`
                        : `${a.total_amount.toLocaleString()}원`}
                    </div>
                    <div className="text-sm text-gray-400">{a.submitter_name} · {a.issue_date}</div>
                  </div>
                  {isMyTurn(a) && (
                    <div className="mt-2.5 flex items-center gap-2" onClick={e => e.stopPropagation()}>
                      <button onClick={(e) => quickApprove(a, e)}
                        className="flex-1 px-3 py-2 bg-green-600 active:bg-green-700 text-white rounded-lg text-base font-bold">✓ 승인</button>
                      <span className="text-sm text-gray-400">탭하면 상세</span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
