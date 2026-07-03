'use client';

import { useState, useEffect } from 'react';
import { supabaseFetch } from '@/lib/supabase';
import { getUser } from '@/lib/auth';

interface Employee {
  id: string;
  name: string;
  email: string;
  role: string;
  company: string;
  phone?: string;
  birth_date?: string;
  hire_date?: string;
  status: string;
  salary?: number;
  pay_day?: string;      // 급여일 (예: '25', '10', '말일')
  salary_bank?: string;  // 급여 통장 (은행 + 계좌)
}

const ROLE_LABELS: Record<string, string> = {
  ceo: '대표',
  admin: '실장',
  manager: '실장',
  sales: '매출 담당',
  inventory: '재고·주문 담당',
  md: 'MD',
};

const ROLE_COLORS: Record<string, string> = {
  ceo: 'bg-red-100 text-red-700',
  admin: 'bg-purple-100 text-purple-700',
  manager: 'bg-blue-100 text-blue-700',
  sales: 'bg-green-100 text-green-700',
  inventory: 'bg-orange-100 text-orange-700',
  md: 'bg-pink-100 text-pink-700',
};

const COMPANIES = ['더블아이', 'BNKNET', 'SJ글로벌', 'IX글로벌'];
const ROLES = ['ceo', 'admin', 'manager', 'sales', 'inventory', 'md'];

const EMPTY_FORM = {
  name: '', email: '', password_hash: 'bnknet1234',
  role: 'inventory', company: 'BNKNET',
  phone: '', birth_date: '', hire_date: '', status: 'active', position: '', salary: '',
  pay_day: '', salary_bank: '',
};

type View = 'list' | 'detail' | 'form';

export default function HrContent() {
  const me = getUser();
  const isAdmin = me?.role === 'admin' || me?.role === 'ceo';

  const [view, setView] = useState<View>('list');
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [selected, setSelected] = useState<Employee | null>(null);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [editId, setEditId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => { loadEmployees(); }, []);

  async function loadEmployees() {
    setLoading(true);
    try {
      const res = await supabaseFetch('/employees?order=created_at.asc&select=id,name,email,role,company,phone,birth_date,hire_date,status,salary,pay_day,salary_bank');
      const data = await res.json();
      setEmployees(Array.isArray(data) ? data : []);
    } catch { setEmployees([]); }
    finally { setLoading(false); }
  }

  async function handleSave() {
    if (!form.name.trim() || !form.email.trim()) return;
    setSaving(true);
    try {
      let res;
      if (editId) {
        res = await supabaseFetch(`/employees?id=eq.${editId}`, {
          method: 'PATCH',
          headers: { Prefer: 'return=minimal' },
          body: JSON.stringify({
            name: form.name, email: form.email, role: form.role,
            company: form.company, phone: form.phone || null,
            birth_date: form.birth_date || null, hire_date: form.hire_date || null,
            position: (form as any).position || null,
            salary: form.salary ? Number(String(form.salary).replace(/[^0-9]/g, '')) : null,
            pay_day: form.pay_day || null, salary_bank: form.salary_bank || null,
            status: form.status, updated_at: new Date().toISOString(),
          }),
        });
      } else {
        res = await supabaseFetch('/employees', {
          method: 'POST',
          headers: { Prefer: 'return=minimal' },
          body: JSON.stringify({
            name: form.name, email: form.email,
            password_hash: form.password_hash,
            role: form.role, company: form.company,
            phone: form.phone || null,
            birth_date: form.birth_date || null,
            hire_date: form.hire_date || null,
            salary: form.salary ? Number(String(form.salary).replace(/[^0-9]/g, '')) : null,
            pay_day: form.pay_day || null, salary_bank: form.salary_bank || null,
            status: form.status,
          }),
        });
      }
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert(`저장 실패: ${(err as any).message || res.status}`);
        return;
      }
      setView('list');
      setEditId(null);
      setForm({ ...EMPTY_FORM });
      await loadEmployees();
    } finally { setSaving(false); }
  }

  async function handleToggleStatus(emp: Employee) {
    const next = emp.status === 'active' ? 'inactive' : 'active';
    await supabaseFetch(`/employees?id=eq.${emp.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: next, updated_at: new Date().toISOString() }),
    });
    await loadEmployees();
    if (selected?.id === emp.id) setSelected({ ...emp, status: next });
  }

  function openForm(emp?: Employee) {
    if (emp) {
      setForm({
        name: emp.name, email: emp.email, password_hash: '',
        role: emp.role, company: emp.company,
        phone: emp.phone || '', birth_date: emp.birth_date || '',
        hire_date: emp.hire_date || '', status: emp.status,
        position: (emp as any).position || '',
        salary: emp.salary != null ? String(emp.salary) : '',
        pay_day: emp.pay_day || '', salary_bank: emp.salary_bank || '',
      });
      setEditId(emp.id);
    } else {
      setForm({ ...EMPTY_FORM });
      setEditId(null);
    }
    setView('form');
  }

  function formatDate(s?: string) {
    if (!s) return '-';
    return new Date(s).toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' });
  }

  function calcTenure(hireDate?: string) {
    if (!hireDate) return '-';
    const months = Math.floor((Date.now() - new Date(hireDate).getTime()) / (1000 * 60 * 60 * 24 * 30));
    const y = Math.floor(months / 12);
    const m = months % 12;
    return y > 0 ? `${y}년 ${m}개월` : `${m}개월`;
  }

  const active = employees.filter((e) => e.status === 'active');
  const inactive = employees.filter((e) => e.status === 'inactive');

  const won = (n?: number) => (n != null ? `${Number(n).toLocaleString('ko-KR')}원` : '-');

  // 접근 제한 — 인사 관리는 대표·실장만
  if (!isAdmin) return (
    <div className="bg-amber-50 border border-amber-200 rounded-2xl px-5 py-8 text-center">
      <div className="text-lg font-semibold text-amber-700">🔒 접근 권한이 없습니다</div>
      <div className="text-sm text-amber-600 mt-1">인사 관리는 대표·실장만 이용할 수 있습니다.</div>
    </div>
  );

  // 목록
  if (view === 'list') return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-base text-gray-400">재직 {active.length}명 · 퇴사 {inactive.length}명</p>
        {isAdmin && (
          <button onClick={() => openForm()} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-base font-medium transition-colors">
            + 직원 등록
          </button>
        )}
      </div>

      {/* 재직자 */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100 bg-gray-50">
          <span className="text-base font-semibold text-gray-600">재직자</span>
        </div>
        {loading ? (
          <div className="text-center py-10 text-gray-400">불러오는 중...</div>
        ) : (
          <div className="divide-y divide-gray-50">
            {active.map((emp) => (
              <div
                key={emp.id}
                onClick={() => { setSelected(emp); setView('detail'); }}
                className="flex items-center gap-4 px-5 py-4 hover:bg-blue-50/40 cursor-pointer transition-colors"
              >
                <div className="w-10 h-10 bg-blue-600 rounded-full flex items-center justify-center text-white font-semibold flex-shrink-0">
                  {emp.name[0]}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-gray-800">{emp.name}</span>
                    <span className={`text-sm px-2 py-0.5 rounded-md ${ROLE_COLORS[emp.role] || 'bg-gray-100 text-gray-600'}`}>
                      {ROLE_LABELS[emp.role] || emp.role}
                    </span>
                  </div>
                  <div className="text-base text-gray-400 mt-0.5">{emp.company} · {emp.email}</div>
                </div>
                <div className="text-base text-gray-400 hidden sm:block">{calcTenure(emp.hire_date)}</div>
              </div>
            ))}
            {active.length === 0 && <div className="text-center py-10 text-gray-400">재직자가 없습니다</div>}
          </div>
        )}
      </div>

      {/* 퇴사자 */}
      {inactive.length > 0 && (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-100 bg-gray-50">
            <span className="text-base font-semibold text-gray-400">퇴사자</span>
          </div>
          <div className="divide-y divide-gray-50">
            {inactive.map((emp) => (
              <div
                key={emp.id}
                onClick={() => { setSelected(emp); setView('detail'); }}
                className="flex items-center gap-4 px-5 py-4 hover:bg-gray-50 cursor-pointer opacity-60"
              >
                <div className="w-10 h-10 bg-gray-400 rounded-full flex items-center justify-center text-white font-semibold flex-shrink-0">
                  {emp.name[0]}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-gray-600">{emp.name}</span>
                    <span className="text-sm px-2 py-0.5 rounded-md bg-gray-100 text-gray-500">퇴사</span>
                  </div>
                  <div className="text-base text-gray-400">{emp.company}</div>
                </div>
              </div>
            ))}
          </div>
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
          <div className="flex items-center gap-4">
            <div className={`w-16 h-16 rounded-2xl flex items-center justify-center text-white text-2xl font-bold ${selected.status === 'active' ? 'bg-blue-600' : 'bg-gray-400'}`}>
              {selected.name[0]}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-xl font-bold text-gray-800">{selected.name}</h2>
                <span className={`text-sm px-2 py-0.5 rounded-md ${ROLE_COLORS[selected.role] || 'bg-gray-100 text-gray-600'}`}>
                  {ROLE_LABELS[selected.role] || selected.role}
                </span>
                {selected.status === 'inactive' && (
                  <span className="text-sm px-2 py-0.5 rounded-md bg-gray-100 text-gray-500">퇴사</span>
                )}
              </div>
              <p className="text-gray-400 text-base mt-1">{selected.company}</p>
            </div>
          </div>
          {isAdmin && (
            <div className="flex gap-2">
              <button onClick={() => openForm(selected)} className="px-3 py-1.5 text-base text-blue-600 border border-blue-200 rounded-lg hover:bg-blue-50">수정</button>
              <button
                onClick={() => handleToggleStatus(selected)}
                className={`px-3 py-1.5 text-base rounded-lg border transition-colors ${selected.status === 'active' ? 'text-red-500 border-red-200 hover:bg-red-50' : 'text-green-600 border-green-200 hover:bg-green-50'}`}
              >
                {selected.status === 'active' ? '퇴사 처리' : '복직 처리'}
              </button>
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {[
            { label: '이메일', value: selected.email },
            { label: '연락처', value: selected.phone || '-' },
            { label: '생년월일', value: formatDate(selected.birth_date) },
            { label: '입사일', value: formatDate(selected.hire_date) },
            { label: '근속 기간', value: calcTenure(selected.hire_date) },
            { label: '소속 사업자', value: selected.company },
            { label: '연봉', value: won(selected.salary) },
            { label: '급여일', value: selected.pay_day ? (/^\d+$/.test(selected.pay_day) ? `${selected.pay_day}일` : selected.pay_day) : '-' },
            { label: '급여 통장', value: selected.salary_bank || '-' },
          ].map((item) => (
            <div key={item.label} className="bg-gray-50 rounded-xl px-4 py-3">
              <div className="text-sm text-gray-400 mb-1">{item.label}</div>
              <div className="text-base font-medium text-gray-700">{item.value}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  // 등록/수정 폼
  return (
    <div className="space-y-4">
      <button onClick={() => { setView('list'); setEditId(null); }} className="text-base text-blue-600 hover:text-blue-700">← 목록으로</button>
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
        <h2 className="text-lg font-bold text-gray-800 mb-5">{editId ? '직원 정보 수정' : '직원 등록'}</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {[
            { label: '이름 *', key: 'name', type: 'text', placeholder: '홍길동' },
            { label: '이메일 *', key: 'email', type: 'email', placeholder: 'hong@bnknet.co.kr' },
            { label: '연락처', key: 'phone', type: 'tel', placeholder: '010-0000-0000' },
            { label: '생년월일', key: 'birth_date', type: 'date', placeholder: '' },
            { label: '입사일', key: 'hire_date', type: 'date', placeholder: '' },
          ].map((f) => (
            <div key={f.key}>
              <label className="block text-base font-medium text-gray-700 mb-1.5">{f.label}</label>
              <input
                type={f.type}
                value={form[f.key as keyof typeof form] as string}
                onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
                placeholder={f.placeholder}
                className="w-full px-4 py-3 border border-gray-200 rounded-xl text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          ))}

          <div>
            <label className="block text-base font-medium text-gray-700 mb-1.5">소속 사업자</label>
            <select
              value={form.company}
              onChange={(e) => setForm({ ...form, company: e.target.value })}
              className="w-full px-4 py-3 border border-gray-200 rounded-xl text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {COMPANIES.map((c) => <option key={c}>{c}</option>)}
            </select>
          </div>

          <div>
            <label className="block text-base font-medium text-gray-700 mb-1.5">역할</label>
            <select
              value={form.role}
              onChange={(e) => setForm({ ...form, role: e.target.value })}
              className="w-full px-4 py-3 border border-gray-200 rounded-xl text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
            </select>
          </div>

          <div>
            <label className="block text-base font-medium text-gray-700 mb-1.5">연봉 (원)</label>
            <input
              type="text"
              inputMode="numeric"
              value={form.salary ? Number(String(form.salary).replace(/[^0-9]/g, '')).toLocaleString('ko-KR') : ''}
              onChange={(e) => setForm({ ...form, salary: e.target.value.replace(/[^0-9]/g, '') })}
              placeholder="예: 42,000,000"
              className="w-full px-4 py-3 border border-gray-200 rounded-xl text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-base font-medium text-gray-700 mb-1.5">급여일</label>
            <input
              type="text"
              value={form.pay_day}
              onChange={(e) => setForm({ ...form, pay_day: e.target.value })}
              placeholder="예: 25 또는 말일"
              className="w-full px-4 py-3 border border-gray-200 rounded-xl text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div className="sm:col-span-2">
            <label className="block text-base font-medium text-gray-700 mb-1.5">급여 통장 (은행 + 계좌)</label>
            <input
              type="text"
              value={form.salary_bank}
              onChange={(e) => setForm({ ...form, salary_bank: e.target.value })}
              placeholder="예: 국민은행 818502-04-202430"
              className="w-full px-4 py-3 border border-gray-200 rounded-xl text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {!editId && (
            <div>
              <label className="block text-base font-medium text-gray-700 mb-1.5">초기 비밀번호</label>
              <input
                type="text"
                value={form.password_hash}
                onChange={(e) => setForm({ ...form, password_hash: e.target.value })}
                className="w-full px-4 py-3 border border-gray-200 rounded-xl text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          )}
        </div>

        <div className="flex gap-3 mt-6">
          <button
            onClick={handleSave}
            disabled={saving || !form.name.trim() || !form.email.trim()}
            className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white rounded-xl font-medium text-base transition-colors"
          >
            {saving ? '저장 중...' : editId ? '수정 완료' : '등록 완료'}
          </button>
          <button
            onClick={() => { setView('list'); setEditId(null); }}
            className="px-6 py-2.5 bg-white border border-gray-200 text-gray-600 rounded-xl font-medium text-base hover:bg-gray-50"
          >
            취소
          </button>
        </div>
      </div>
    </div>
  );
}
