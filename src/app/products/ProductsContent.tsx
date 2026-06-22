'use client';

import { useState, useEffect } from 'react';
import { supabaseFetch } from '@/lib/supabase';
import { getUser } from '@/lib/auth';
import * as XLSX from 'xlsx';

interface Product {
  id: string;
  name: string;
  category?: string;
  brand?: string;
  company: string;
  sku?: string;
  barcode?: string;
  cost_price: number;
  sell_price: number;
  unit: string;
  memo?: string;
  is_active: boolean;
  created_at: string;
}

const COMPANIES = ['전체', '공통', '더블아이', 'BNKNET', 'SJ글로벌', 'IX글로벌'];
const CATEGORIES = ['전체', '뷰티', '건강기능식품', '식품', '생활용품', '기타'];
const UNITS = ['개', '박스', '세트', '포', '병', '팩'];

const EMPTY_FORM = {
  name: '', category: '건강기능식품', brand: '', company: 'BNKNET',
  sku: '', barcode: '', cost_price: 0, sell_price: 0,
  unit: '개', memo: '', is_active: true,
};

type View = 'list' | 'detail' | 'form';

export default function ProductsContent() {
  const me = getUser();
  // 상품 등록/수정 = 대표·실장·영업(강웅구)·재고담당(박정진/최영훈)
  const isAdmin = ['ceo', 'admin', 'sales', 'inventory'].includes(me?.role || '');

  const [view, setView] = useState<View>('list');
  const [products, setProducts] = useState<Product[]>([]);
  const [selected, setSelected] = useState<Product | null>(null);
  const [loading, setLoading] = useState(true);
  const [filterCompany, setFilterCompany] = useState('전체');
  const [filterCategory, setFilterCategory] = useState('전체');
  const [search, setSearch] = useState('');
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [editId, setEditId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => { loadProducts(); }, []);

  async function loadProducts() {
    setLoading(true);
    try {
      const res = await supabaseFetch('/products?order=category.asc,name.asc');
      const data = await res.json();
      setProducts(Array.isArray(data) ? data : []);
    } catch { setProducts([]); }
    finally { setLoading(false); }
  }

  async function handleSave() {
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      const payload = {
        ...form,
        cost_price: Number(form.cost_price) || 0,
        sell_price: Number(form.sell_price) || 0,
        updated_at: new Date().toISOString(),
      };
      let res;
      if (editId) {
        res = await supabaseFetch(`/products?id=eq.${editId}`, {
          method: 'PATCH',
          headers: { Prefer: 'return=minimal' },
          body: JSON.stringify(payload),
        });
      } else {
        res = await supabaseFetch('/products', {
          method: 'POST',
          headers: { Prefer: 'return=minimal' },
          body: JSON.stringify(payload),
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
      await loadProducts();
    } finally { setSaving(false); }
  }

  async function handleDelete(id: string) {
    if (!confirm('상품을 삭제하시겠습니까?')) return;
    await supabaseFetch(`/products?id=eq.${id}`, { method: 'DELETE' });
    setView('list');
    setSelected(null);
    await loadProducts();
  }

  function openForm(p?: Product) {
    if (p) {
      setForm({
        name: p.name, category: p.category || '건강기능식품',
        brand: p.brand || '', company: p.company,
        sku: p.sku || '', barcode: p.barcode || '',
        cost_price: p.cost_price, sell_price: p.sell_price,
        unit: p.unit || '개', memo: p.memo || '', is_active: p.is_active,
      });
      setEditId(p.id);
    } else {
      setForm({ ...EMPTY_FORM });
      setEditId(null);
    }
    setView('form');
  }

  function exportExcel() {
    const data = filtered.map((p) => ({
      상품명: p.name,
      카테고리: p.category || '',
      브랜드: p.brand || '',
      사업자: p.company,
      SKU: p.sku || '',
      바코드: p.barcode || '',
      원가: p.cost_price,
      단위: p.unit,
      상태: p.is_active ? '판매중' : '중단',
      메모: p.memo || '',
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '상품마스터');
    XLSX.writeFile(wb, `상품마스터_${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  const filtered = products.filter((p) => {
    const matchCompany = filterCompany === '전체' || p.company === filterCompany;
    const matchCategory = filterCategory === '전체' || p.category === filterCategory;
    const matchSearch = !search ||
      p.name.includes(search) ||
      (p.brand || '').includes(search) ||
      (p.sku || '').includes(search);
    return matchCompany && matchCategory && matchSearch;
  });

  // 목록
  if (view === 'list') return (
    <div className="space-y-4">
      {/* 필터 */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="space-y-2 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-gray-400 w-14">카테고리</span>
            {CATEGORIES.map((c) => (
              <button key={c} onClick={() => setFilterCategory(c)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${filterCategory === c ? 'bg-blue-600 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
                {c}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-gray-400 w-14">사업자</span>
            {COMPANIES.map((c) => (
              <button key={c} onClick={() => setFilterCompany(c)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${filterCompany === c ? 'bg-slate-700 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
                {c}
              </button>
            ))}
          </div>
        </div>
        <div className="flex gap-2 flex-shrink-0">
          <button onClick={exportExcel}
            className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-xl text-sm font-medium transition-colors">
            엑셀 다운로드
          </button>
          {isAdmin && (
            <button onClick={() => openForm()}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-medium transition-colors">
              + 상품 추가
            </button>
          )}
        </div>
      </div>

      {/* 검색 */}
      <div className="relative">
        <svg className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <input value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder="상품명, 브랜드, SKU 검색"
          className="w-full pl-10 pr-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white" />
      </div>

      {/* 통계 */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: '전체 상품', value: `${products.length}개` },
          { label: '필터 결과', value: `${filtered.length}개` },
          { label: '판매중', value: `${filtered.filter(p => p.is_active).length}개` },
          { label: '중단', value: `${filtered.filter(p => !p.is_active).length}개` },
        ].map((s) => (
          <div key={s.label} className="bg-white rounded-xl border border-gray-100 px-4 py-3">
            <div className="text-xs text-gray-400">{s.label}</div>
            <div className="text-lg font-bold text-gray-800 mt-0.5">{s.value}</div>
          </div>
        ))}
      </div>

      {/* 테이블 */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        {loading ? (
          <div className="text-center py-12 text-gray-400">불러오는 중...</div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-12 text-gray-400">등록된 상품이 없습니다</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>
                  {['상품명', '카테고리', '브랜드', '사업자', '원가', '상태'].map((h) => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-500">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filtered.map((p) => (
                  <tr key={p.id} onClick={() => { setSelected(p); setView('detail'); }}
                    className="hover:bg-blue-50/40 cursor-pointer transition-colors">
                    <td className="px-4 py-3 font-medium text-gray-800">{p.name}</td>
                    <td className="px-4 py-3 text-gray-500">{p.category || '-'}</td>
                    <td className="px-4 py-3 text-gray-500">{p.brand || '-'}</td>
                    <td className="px-4 py-3 text-gray-500">{p.company}</td>
                    <td className="px-4 py-3 text-gray-600">{p.cost_price ? p.cost_price.toLocaleString() + '원' : '-'}</td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded-md ${p.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                        {p.is_active ? '판매중' : '중단'}
                      </span>
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

  // 상세
  if (view === 'detail' && selected) return (
    <div className="space-y-4">
      <button onClick={() => setView('list')} className="text-sm text-blue-600 hover:text-blue-700">← 목록으로</button>
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
        <div className="flex items-start justify-between mb-6">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-xl font-bold text-gray-800">{selected.name}</h2>
              {selected.category && <span className="text-xs px-2 py-0.5 rounded-md bg-blue-100 text-blue-700">{selected.category}</span>}
              <span className="text-xs px-2 py-0.5 rounded-md bg-slate-100 text-slate-600">{selected.company}</span>
              <span className={`text-xs px-2 py-0.5 rounded-md ${selected.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                {selected.is_active ? '판매중' : '중단'}
              </span>
            </div>
            {selected.brand && <p className="text-gray-400 text-sm mt-1">브랜드: {selected.brand}</p>}
          </div>
          {isAdmin && (
            <div className="flex gap-2">
              <button onClick={() => openForm(selected)} className="px-3 py-1.5 text-sm text-blue-600 border border-blue-200 rounded-lg hover:bg-blue-50">수정</button>
              <button onClick={() => handleDelete(selected.id)} className="px-3 py-1.5 text-sm text-red-500 border border-red-200 rounded-lg hover:bg-red-50">삭제</button>
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          {[
            { label: '원가', value: selected.cost_price ? selected.cost_price.toLocaleString() + '원' : '-' },
            { label: '단위', value: selected.unit || '-' },
            { label: 'SKU', value: selected.sku || '-' },
            { label: '바코드', value: selected.barcode || '-' },
          ].map((item) => (
            <div key={item.label} className="bg-gray-50 rounded-xl px-4 py-3">
              <div className="text-xs text-gray-400 mb-1">{item.label}</div>
              <div className="text-sm font-medium text-gray-700">{item.value}</div>
            </div>
          ))}
        </div>

        {selected.memo && (
          <div className="mt-4 bg-gray-50 rounded-xl px-4 py-3">
            <div className="text-xs text-gray-400 mb-1">메모</div>
            <div className="text-sm text-gray-700 whitespace-pre-wrap">{selected.memo}</div>
          </div>
        )}
      </div>
    </div>
  );

  // 등록/수정 폼
  return (
    <div className="space-y-4">
      <button onClick={() => { setView('list'); setEditId(null); }} className="text-sm text-blue-600 hover:text-blue-700">← 목록으로</button>
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
        <h2 className="text-lg font-bold text-gray-800 mb-5">{editId ? '상품 수정' : '상품 추가'}</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="sm:col-span-2">
            <label className="block text-sm font-medium text-gray-700 mb-1.5">상품명 *</label>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="상품명" className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">카테고리</label>
            <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}
              className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
              {CATEGORIES.filter(c => c !== '전체').map((c) => <option key={c}>{c}</option>)}
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
              placeholder="브랜드명" className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">단위</label>
            <select value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })}
              className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
              {UNITS.map((u) => <option key={u}>{u}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">원가 (원)</label>
            <input type="number" value={form.cost_price} onChange={(e) => setForm({ ...form, cost_price: Number(e.target.value) })}
              placeholder="0" className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">SKU</label>
            <input value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })}
              placeholder="재고 관리 코드" className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">바코드</label>
            <input value={form.barcode} onChange={(e) => setForm({ ...form, barcode: e.target.value })}
              placeholder="바코드 번호" className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div className="sm:col-span-2 flex items-center gap-3">
            <label className="text-sm font-medium text-gray-700">판매 상태</label>
            <button type="button" onClick={() => setForm({ ...form, is_active: !form.is_active })}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${form.is_active ? 'bg-blue-600' : 'bg-gray-300'}`}>
              <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${form.is_active ? 'translate-x-6' : 'translate-x-1'}`} />
            </button>
            <span className="text-sm text-gray-500">{form.is_active ? '판매중' : '중단'}</span>
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
