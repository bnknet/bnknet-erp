'use client';

import { useState, useEffect } from 'react';
import { supabaseFetch } from '@/lib/supabase';

interface Account {
  id: string;
  service_name: string;
  login_id: string;
  password: string;
  url?: string;
  memo?: string;
  category: string;
  company: string;
  created_at: string;
}

const CATEGORIES = ['전체', '쇼핑몰', '물류·배송', '정산·세무', 'ERP·업무툴', '기타'];
const COMPANIES = ['전체', '공통', '더블아이', 'BNKNET', 'SJ글로벌', 'IX글로벌'];

const CATEGORY_COLORS: Record<string, string> = {
  '쇼핑몰': 'bg-blue-100 text-blue-700',
  '물류·배송': 'bg-orange-100 text-orange-700',
  '정산·세무': 'bg-green-100 text-green-700',
  'ERP·업무툴': 'bg-purple-100 text-purple-700',
  '기타': 'bg-gray-100 text-gray-600',
};

const EMPTY_FORM = {
  service_name: '', login_id: '', password: '', url: '', memo: '', category: '기타', company: '공통',
};

export default function AccountsContent() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterCat, setFilterCat] = useState('전체');
  const [filterCompany, setFilterCompany] = useState('전체');
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [editId, setEditId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [visiblePw, setVisiblePw] = useState<Set<string>>(new Set());

  useEffect(() => { loadAccounts(); }, []);

  async function loadAccounts() {
    setLoading(true);
    try {
      const res = await supabaseFetch('/accounts?order=category.asc,service_name.asc');
      const data = await res.json();
      setAccounts(Array.isArray(data) ? data : []);
    } catch { setAccounts([]); }
    finally { setLoading(false); }
  }

  async function handleSave() {
    if (!form.service_name.trim() || !form.login_id.trim()) return;
    setSaving(true);
    try {
      if (editId) {
        await supabaseFetch(`/accounts?id=eq.${editId}`, {
          method: 'PATCH',
          body: JSON.stringify({ ...form, updated_at: new Date().toISOString() }),
        });
      } else {
        await supabaseFetch('/accounts', {
          method: 'POST',
          headers: { Prefer: 'return=minimal' },
          body: JSON.stringify(form),
        });
      }
      setShowForm(false);
      setEditId(null);
      setForm({ ...EMPTY_FORM });
      await loadAccounts();
    } finally { setSaving(false); }
  }

  async function handleDelete(id: string) {
    if (!confirm('계정 정보를 삭제하시겠습니까?')) return;
    await supabaseFetch(`/accounts?id=eq.${id}`, { method: 'DELETE' });
    await loadAccounts();
  }

  function openEdit(acc: Account) {
    setForm({
      service_name: acc.service_name, login_id: acc.login_id,
      password: acc.password, url: acc.url || '',
      memo: acc.memo || '', category: acc.category,
      company: acc.company || '',
    });
    setEditId(acc.id);
    setShowForm(true);
  }

  function togglePw(id: string) {
    setVisiblePw((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  async function copyToClipboard(text: string) {
    await navigator.clipboard.writeText(text);
  }

  const filtered = accounts.filter((a) => {
    const matchCat = filterCat === '전체' || a.category === filterCat;
    const matchCompany = filterCompany === '전체' || (a as Account & { company?: string }).company === filterCompany;
    const matchSearch = !search || a.service_name.includes(search) || a.login_id.includes(search);
    return matchCat && matchCompany && matchSearch;
  });

  return (
    <div className="space-y-4">
      {/* 상단 */}
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <span className="text-base font-semibold text-gray-700">계정 필터</span>
          <button
            onClick={() => { setShowForm(true); setEditId(null); setForm({ ...EMPTY_FORM }); }}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm sm:text-base font-medium transition-colors flex-shrink-0"
          >
            + 계정 추가
          </button>
        </div>
        {/* 사업자 필터 */}
        <div>
          <div className="text-xs font-medium text-gray-400 mb-1.5">사업자</div>
          <div className="grid grid-cols-3 gap-2 sm:flex sm:flex-wrap">
            {COMPANIES.map((c) => (
              <button
                key={c}
                onClick={() => setFilterCompany(c)}
                className={`px-3 py-2 rounded-lg text-sm sm:text-base font-medium whitespace-nowrap text-center transition-colors ${filterCompany === c ? 'bg-slate-700 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'}`}
              >
                {c}
              </button>
            ))}
          </div>
        </div>
        {/* 카테고리 필터 */}
        <div>
          <div className="text-xs font-medium text-gray-400 mb-1.5">카테고리</div>
          <div className="grid grid-cols-3 gap-2 sm:flex sm:flex-wrap">
            {CATEGORIES.map((c) => (
              <button
                key={c}
                onClick={() => setFilterCat(c)}
                className={`px-3 py-2 rounded-lg text-sm sm:text-base font-medium whitespace-nowrap text-center transition-colors ${filterCat === c ? 'bg-blue-600 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'}`}
              >
                {c}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* 검색 */}
      <div className="relative">
        <svg className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="서비스명 또는 아이디 검색"
          className="w-full pl-10 pr-4 py-3 border border-gray-200 rounded-xl text-base focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
        />
      </div>

      {/* 계정 목록 */}
      {loading ? (
        <div className="text-center py-12 text-gray-400">불러오는 중...</div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-100 text-center py-12 text-gray-400">
          등록된 계정이 없습니다
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map((acc) => (
            <div key={acc.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 hover:shadow-md transition-shadow">
              <div className="flex items-start justify-between mb-3">
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-gray-800">{acc.service_name}</span>
                    <span className={`text-sm px-2 py-0.5 rounded-md ${CATEGORY_COLORS[acc.category] || 'bg-gray-100 text-gray-600'}`}>
                      {acc.category}
                    </span>
                    <span className="text-sm px-2 py-0.5 rounded-md bg-slate-100 text-slate-600">
                      {(acc as Account & { company?: string }).company || '공통'}
                    </span>
                  </div>
                  {acc.url && (
                    <a href={acc.url} target="_blank" rel="noopener noreferrer" className="text-sm text-blue-500 hover:underline mt-0.5 block truncate max-w-[200px]">
                      {acc.url}
                    </a>
                  )}
                </div>
                <div className="flex gap-1.5">
                  <button onClick={() => openEdit(acc)} className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                  </button>
                  <button onClick={() => handleDelete(acc.id)} className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                {/* 아이디 */}
                <div className="flex items-center justify-between bg-gray-50 rounded-lg px-3 py-2">
                  <div>
                    <div className="text-sm text-gray-400">아이디</div>
                    <div className="text-base font-medium text-gray-700">{acc.login_id}</div>
                  </div>
                  <button onClick={() => copyToClipboard(acc.login_id)} className="text-sm text-gray-400 hover:text-blue-600 px-2 py-1 hover:bg-blue-50 rounded transition-colors">복사</button>
                </div>

                {/* 비밀번호 */}
                <div className="flex items-center justify-between bg-gray-50 rounded-lg px-3 py-2">
                  <div>
                    <div className="text-sm text-gray-400">비밀번호</div>
                    <div className="text-base font-medium text-gray-700 font-mono">
                      {visiblePw.has(acc.id) ? acc.password : '••••••••'}
                    </div>
                  </div>
                  <div className="flex gap-1">
                    <button onClick={() => togglePw(acc.id)} className="text-sm text-gray-400 hover:text-blue-600 px-2 py-1 hover:bg-blue-50 rounded transition-colors">
                      {visiblePw.has(acc.id) ? '숨기기' : '보기'}
                    </button>
                    <button onClick={() => copyToClipboard(acc.password)} className="text-sm text-gray-400 hover:text-blue-600 px-2 py-1 hover:bg-blue-50 rounded transition-colors">복사</button>
                  </div>
                </div>

                {acc.memo && (
                  <div className="text-sm text-gray-400 px-1">{acc.memo}</div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 등록/수정 모달 */}
      {showForm && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
            <h3 className="text-lg font-bold text-gray-800 mb-5">{editId ? '계정 수정' : '계정 추가'}</h3>
            <div className="space-y-3">
              <div>
                <label className="block text-base font-medium text-gray-700 mb-1.5">서비스명 *</label>
                <input value={form.service_name} onChange={(e) => setForm({ ...form, service_name: e.target.value })}
                  placeholder="예: 사방넷, 쿠팡 파트너스" className="w-full px-4 py-3 border border-gray-200 rounded-xl text-base focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-base font-medium text-gray-700 mb-1.5">사업자</label>
                <select value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })}
                  className="w-full px-4 py-3 border border-gray-200 rounded-xl text-base focus:outline-none focus:ring-2 focus:ring-blue-500">
                  {COMPANIES.filter((c) => c !== '전체').map((c) => <option key={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-base font-medium text-gray-700 mb-1.5">카테고리</label>
                <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}
                  className="w-full px-4 py-3 border border-gray-200 rounded-xl text-base focus:outline-none focus:ring-2 focus:ring-blue-500">
                  {CATEGORIES.filter((c) => c !== '전체').map((c) => <option key={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-base font-medium text-gray-700 mb-1.5">아이디 *</label>
                <input value={form.login_id} onChange={(e) => setForm({ ...form, login_id: e.target.value })}
                  placeholder="로그인 아이디" className="w-full px-4 py-3 border border-gray-200 rounded-xl text-base focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-base font-medium text-gray-700 mb-1.5">비밀번호</label>
                <input value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })}
                  placeholder="비밀번호" className="w-full px-4 py-3 border border-gray-200 rounded-xl text-base focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-base font-medium text-gray-700 mb-1.5">URL</label>
                <input value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })}
                  placeholder="https://" className="w-full px-4 py-3 border border-gray-200 rounded-xl text-base focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-base font-medium text-gray-700 mb-1.5">메모</label>
                <input value={form.memo} onChange={(e) => setForm({ ...form, memo: e.target.value })}
                  placeholder="추가 메모" className="w-full px-4 py-3 border border-gray-200 rounded-xl text-base focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
            </div>
            <div className="flex gap-3 mt-5">
              <button onClick={handleSave} disabled={saving || !form.service_name.trim() || !form.login_id.trim()}
                className="flex-1 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white rounded-xl font-medium text-base transition-colors">
                {saving ? '저장 중...' : editId ? '수정 완료' : '추가 완료'}
              </button>
              <button onClick={() => { setShowForm(false); setEditId(null); }}
                className="flex-1 py-3 bg-white border border-gray-200 text-gray-600 rounded-xl font-medium text-base hover:bg-gray-50">
                취소
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
