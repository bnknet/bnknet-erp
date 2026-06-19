'use client';

import { useState, useEffect, useRef } from 'react';
import { supabaseFetch, supabaseUpload } from '@/lib/supabase';

interface Partner {
  id: string;
  name: string;
  type: string;
  manager_name?: string;
  manager_phone?: string;
  manager_email?: string;
  brand?: string;
  company: string;
  contract_url?: string;
  memo?: string;
  created_at: string;
}

const TYPES = ['전체', '브랜드사', '홈쇼핑채널', '물류사', '기타'];
const COMPANIES = ['전체', '공통', '더블아이', 'BNKNET', 'SJ글로벌', 'IX글로벌'];

const TYPE_COLORS: Record<string, string> = {
  '브랜드사': 'bg-blue-100 text-blue-700',
  '홈쇼핑채널': 'bg-purple-100 text-purple-700',
  '물류사': 'bg-orange-100 text-orange-700',
  '기타': 'bg-gray-100 text-gray-600',
};

const EMPTY_FORM = {
  name: '', type: '브랜드사', manager_name: '', manager_phone: '',
  manager_email: '', brand: '', company: '공통', contract_url: '', memo: '',
};

type View = 'list' | 'detail' | 'form';

interface ManagerGroup {
  manager_name: string;
  manager_phone: string;
  manager_email: string;
  items: Partner[];
}

export default function PartnersContent() {
  const [view, setView] = useState<View>('list');
  const [partners, setPartners] = useState<Partner[]>([]);
  const [selected, setSelected] = useState<Partner | null>(null);
  const [selectedGroup, setSelectedGroup] = useState<ManagerGroup | null>(null);
  const [loading, setLoading] = useState(true);
  const [filterType, setFilterType] = useState('전체');
  const [filterCompany, setFilterCompany] = useState('전체');
  const [search, setSearch] = useState('');
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [editId, setEditId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [contractFile, setContractFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { loadPartners(); }, []);

  async function loadPartners() {
    setLoading(true);
    try {
      const res = await supabaseFetch('/partners?order=type.asc,name.asc');
      const data = await res.json();
      setPartners(Array.isArray(data) ? data : []);
    } catch { setPartners([]); }
    finally { setLoading(false); }
  }

  async function handleSave() {
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      let contractUrl = form.contract_url;
      if (contractFile) {
        const ext = contractFile.name.split('.').pop();
        const path = `${Date.now()}_${form.name.replace(/\s/g, '_')}.${ext}`;
        contractUrl = await supabaseUpload('contracts', path, contractFile);
      }
      const payload = { ...form, contract_url: contractUrl };
      if (editId) {
        await supabaseFetch(`/partners?id=eq.${editId}`, {
          method: 'PATCH',
          body: JSON.stringify({ ...payload, updated_at: new Date().toISOString() }),
        });
      } else {
        await supabaseFetch('/partners', {
          method: 'POST',
          headers: { Prefer: 'return=minimal' },
          body: JSON.stringify(payload),
        });
      }
      setView('list');
      setEditId(null);
      setForm({ ...EMPTY_FORM });
      setContractFile(null);
      await loadPartners();
    } finally { setSaving(false); }
  }

  async function handleDelete(id: string) {
    if (!confirm('거래처를 삭제하시겠습니까?')) return;
    await supabaseFetch(`/partners?id=eq.${id}`, { method: 'DELETE' });
    setView('list');
    setSelected(null);
    await loadPartners();
  }

  function openForm(p?: Partner) {
    if (p) {
      setForm({
        name: p.name, type: p.type, manager_name: p.manager_name || '',
        manager_phone: p.manager_phone || '', manager_email: p.manager_email || '',
        brand: p.brand || '', company: p.company, contract_url: p.contract_url || '',
        memo: p.memo || '',
      });
      setEditId(p.id);
    } else {
      setForm({ ...EMPTY_FORM });
      setEditId(null);
    }
    setView('form');
  }

  const filtered = partners.filter((p) => {
    const matchType = filterType === '전체' || p.type === filterType;
    const matchCompany = filterCompany === '전체' || p.company === filterCompany;
    const matchSearch = !search || p.name.includes(search) || (p.manager_name || '').includes(search) || (p.brand || '').includes(search);
    return matchType && matchCompany && matchSearch;
  });

  // 담당자별 그룹핑
  const grouped: ManagerGroup[] = [];
  const seenManagers: Record<string, ManagerGroup> = {};

  filtered.forEach((p) => {
    const key = p.manager_name?.trim() || '';
    if (key) {
      if (!seenManagers[key]) {
        seenManagers[key] = { manager_name: key, manager_phone: p.manager_phone || '', manager_email: p.manager_email || '', items: [] };
        grouped.push(seenManagers[key]);
      }
      seenManagers[key].items.push(p);
      if (!seenManagers[key].manager_phone && p.manager_phone) seenManagers[key].manager_phone = p.manager_phone;
    } else {
      grouped.push({ manager_name: '', manager_phone: '', manager_email: '', items: [p] });
    }
  });

  // 목록
  if (view === 'list') return (
    <div className="space-y-4">
      {/* 필터 */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="space-y-2 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-gray-400 w-12">유형</span>
            {TYPES.map((t) => (
              <button key={t} onClick={() => setFilterType(t)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${filterType === t ? 'bg-blue-600 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
                {t}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-gray-400 w-12">사업자</span>
            {COMPANIES.map((c) => (
              <button key={c} onClick={() => setFilterCompany(c)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${filterCompany === c ? 'bg-slate-700 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
                {c}
              </button>
            ))}
          </div>
        </div>
        <button onClick={() => openForm()}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-medium transition-colors flex-shrink-0">
          + 거래처 추가
        </button>
      </div>

      {/* 검색 */}
      <div className="relative">
        <svg className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <input value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder="담당자명, 거래처명, 브랜드 검색"
          className="w-full pl-10 pr-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white" />
      </div>

      {/* 목록 */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        {loading ? (
          <div className="text-center py-12 text-gray-400">불러오는 중...</div>
        ) : grouped.length === 0 ? (
          <div className="text-center py-12 text-gray-400">등록된 거래처가 없습니다</div>
        ) : (
          <div className="divide-y divide-gray-50">
            {grouped.map((g, idx) => {
              const first = g.items[0];
              const displayName = g.manager_name || first.name;
              const brandList = g.items.map(p => p.name + (p.brand ? ` (${p.brand})` : '')).join(' · ');
              return (
                <div key={idx} onClick={() => { setSelectedGroup(g); setSelected(g.items[0]); setView('detail'); }}
                  className="flex items-center gap-4 px-5 py-4 hover:bg-blue-50/40 cursor-pointer transition-colors"
                  data-group-idx={idx}>
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-lg flex-shrink-0 ${
                    first.type === '브랜드사' ? 'bg-blue-100' : first.type === '홈쇼핑채널' ? 'bg-purple-100' : first.type === '물류사' ? 'bg-orange-100' : 'bg-gray-100'
                  }`}>
                    {first.type === '브랜드사' ? '🏢' : first.type === '홈쇼핑채널' ? '📺' : first.type === '물류사' ? '🚚' : '🤝'}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-gray-800">{displayName}</span>
                      <span className={`text-xs px-2 py-0.5 rounded-md ${TYPE_COLORS[first.type] || 'bg-gray-100 text-gray-600'}`}>{first.type}</span>
                      <span className="text-xs px-2 py-0.5 rounded-md bg-slate-100 text-slate-600">{first.company}</span>
                      {g.items.length > 1 && (
                        <span className="text-xs px-2 py-0.5 rounded-md bg-green-100 text-green-600">{g.items.length}개 브랜드</span>
                      )}
                    </div>
                    <div className="text-sm text-gray-400 mt-0.5 truncate">{brandList}</div>
                  </div>
                  {g.manager_phone && (
                    <div className="text-sm text-gray-400 hidden sm:block flex-shrink-0">{g.manager_phone}</div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );

  // 상세
  if (view === 'detail' && selectedGroup) {
    const g = selectedGroup;
    const displayName = g.manager_name || g.items[0].name;
    const first = g.items[0];
    return (
      <div className="space-y-4">
        <button onClick={() => setView('list')} className="text-sm text-blue-600 hover:text-blue-700">← 목록으로</button>
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
          {/* 담당자 헤더 */}
          <div className="flex items-start justify-between mb-6">
            <div className="flex items-center gap-4">
              <div className={`w-14 h-14 rounded-2xl flex items-center justify-center text-2xl ${
                first.type === '브랜드사' ? 'bg-blue-100' : first.type === '홈쇼핑채널' ? 'bg-purple-100' : first.type === '물류사' ? 'bg-orange-100' : 'bg-gray-100'
              }`}>
                {first.type === '브랜드사' ? '🏢' : first.type === '홈쇼핑채널' ? '📺' : first.type === '물류사' ? '🚚' : '🤝'}
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-xl font-bold text-gray-800">{displayName}</h2>
                  <span className={`text-xs px-2 py-0.5 rounded-md ${TYPE_COLORS[first.type] || 'bg-gray-100 text-gray-600'}`}>{first.type}</span>
                  <span className="text-xs px-2 py-0.5 rounded-md bg-slate-100 text-slate-600">{first.company}</span>
                </div>
                {g.manager_phone && <p className="text-gray-400 text-sm mt-1">{g.manager_phone}</p>}
              </div>
            </div>
          </div>

          {/* 담담 브랜드 목록 */}
          <div className="mt-2">
            <div className="text-xs text-gray-400 mb-3 font-medium uppercase tracking-wide">담당 브랜드 ({g.items.length}개)</div>
            <div className="space-y-3">
              {g.items.map((p) => (
                <div key={p.id} className="bg-gray-50 rounded-xl px-4 py-3">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="font-medium text-gray-800">{p.name}</div>
                      {p.brand && <div className="text-sm text-gray-400 mt-0.5">{p.brand}</div>}
                      {p.contract_url && (
                        <a href={p.contract_url} target="_blank" rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-xs text-blue-500 hover:underline mt-1">
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" /></svg>
                          첨부파일 보기
                        </a>
                      )}
                      {p.memo && <div className="text-xs text-gray-400 mt-1.5 whitespace-pre-wrap">{p.memo}</div>}
                    </div>
                    <div className="flex gap-2 ml-3 flex-shrink-0">
                      <button onClick={() => openForm(p)} className="px-2.5 py-1 text-xs text-blue-600 border border-blue-200 rounded-lg hover:bg-blue-50">수정</button>
                      <button onClick={() => handleDelete(p.id)} className="px-2.5 py-1 text-xs text-red-500 border border-red-200 rounded-lg hover:bg-red-50">삭제</button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // 등록/수정
  return (
    <div className="space-y-4">
      <button onClick={() => { setView('list'); setEditId(null); }} className="text-sm text-blue-600 hover:text-blue-700">← 목록으로</button>
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
        <h2 className="text-lg font-bold text-gray-800 mb-5">{editId ? '거래처 수정' : '거래처 추가'}</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">거래처명 *</label>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="거래처명" className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">유형</label>
            <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}
              className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
              {TYPES.filter(t => t !== '전체').map((t) => <option key={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">소속 사업자</label>
            <select value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })}
              className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
              {COMPANIES.filter(c => c !== '전체').map((c) => <option key={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">브랜드</label>
            <input value={form.brand} onChange={(e) => setForm({ ...form, brand: e.target.value })}
              placeholder="관련 브랜드명" className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">담당자명</label>
            <input value={form.manager_name} onChange={(e) => setForm({ ...form, manager_name: e.target.value })}
              placeholder="홍길동" className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">담당자 연락처</label>
            <input value={form.manager_phone} onChange={(e) => setForm({ ...form, manager_phone: e.target.value })}
              placeholder="010-0000-0000" className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">담당자 이메일</label>
            <input value={form.manager_email} onChange={(e) => setForm({ ...form, manager_email: e.target.value })}
              placeholder="hong@brand.co.kr" className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div className="sm:col-span-2">
            <label className="block text-sm font-medium text-gray-700 mb-1.5">계약서</label>
            <div className="space-y-2">
              <input value={form.contract_url} onChange={(e) => setForm({ ...form, contract_url: e.target.value })}
                placeholder="URL 직접 입력 (https://...)" className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              <div
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) setContractFile(f); }}
                className="flex items-center gap-3 px-4 py-3 border-2 border-dashed border-gray-200 rounded-xl cursor-pointer hover:border-blue-400 hover:bg-blue-50/40 transition-colors">
                <svg className="w-5 h-5 text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                </svg>
                {contractFile ? (
                  <span className="text-sm text-blue-600 font-medium">{contractFile.name}</span>
                ) : (
                  <span className="text-sm text-gray-400">파일 첨부 (클릭 또는 드래그) — PDF, 이미지, 엑셀 등</span>
                )}
                {contractFile && (
                  <button type="button" onClick={(e) => { e.stopPropagation(); setContractFile(null); }}
                    className="ml-auto text-gray-400 hover:text-red-500 text-xs">✕ 취소</button>
                )}
              </div>
              <input ref={fileInputRef} type="file" className="hidden"
                accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) setContractFile(f); }} />
              {form.contract_url && !contractFile && (
                <a href={form.contract_url} target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-blue-500 hover:underline">
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
                  현재 첨부파일 보기
                </a>
              )}
            </div>
          </div>
          <div className="sm:col-span-2">
            <label className="block text-sm font-medium text-gray-700 mb-1.5">메모</label>
            <textarea value={form.memo} onChange={(e) => setForm({ ...form, memo: e.target.value })}
              placeholder="추가 메모" rows={3}
              className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" />
          </div>
        </div>
        <div className="flex gap-3 mt-5">
          <button onClick={handleSave} disabled={saving || !form.name.trim()}
            className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white rounded-xl font-medium text-sm transition-colors">
            {saving ? '저장 중...' : editId ? '수정 완료' : '추가 완료'}
          </button>
          <button onClick={() => { setView('list'); setEditId(null); }}
            className="px-6 py-2.5 bg-white border border-gray-200 text-gray-600 rounded-xl font-medium text-sm hover:bg-gray-50">
            취소
          </button>
        </div>
      </div>
    </div>
  );
}
