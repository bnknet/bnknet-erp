'use client';

import { useState } from 'react';
import { getUser } from '@/lib/auth';

const ROLE_LABEL: Record<string, string> = {
  ceo: '대표', admin: '실장', manager: '매니저', sales: '영업·재무', inventory: '재고', md: 'MD',
};

export default function ProfileContent() {
  const me = getUser();

  const [curPw, setCurPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [newPw2, setNewPw2] = useState('');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  async function changePassword(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);

    if (!curPw || !newPw || !newPw2) { setMsg({ type: 'err', text: '모든 항목을 입력해주세요.' }); return; }
    if (newPw.length < 4) { setMsg({ type: 'err', text: '새 비밀번호는 4자 이상이어야 합니다.' }); return; }
    if (newPw !== newPw2) { setMsg({ type: 'err', text: '새 비밀번호가 일치하지 않습니다.' }); return; }
    if (newPw === curPw) { setMsg({ type: 'err', text: '현재 비밀번호와 다른 비밀번호를 입력해주세요.' }); return; }
    if (!me?.id) { setMsg({ type: 'err', text: '로그인 정보를 찾을 수 없습니다. 다시 로그인해주세요.' }); return; }

    setSaving(true);
    try {
      // 서버(service_role)에서 현재 비밀번호 검증 후 employee_secrets 갱신
      const r = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employeeId: me.id, currentPw: curPw, newPw }),
      });
      const data = await r.json().catch(() => null);
      if (!data?.ok) {
        setMsg({ type: 'err', text: data?.error || '비밀번호 변경에 실패했습니다.' });
        setSaving(false);
        return;
      }

      setCurPw(''); setNewPw(''); setNewPw2('');
      setMsg({ type: 'ok', text: '비밀번호가 변경되었습니다.' });
    } catch {
      setMsg({ type: 'err', text: '변경 중 오류가 발생했습니다. 다시 시도해주세요.' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-xl mx-auto space-y-4">
      <h1 className="text-lg font-bold text-gray-800">내 정보</h1>

      {/* 기본 정보 */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 bg-blue-600 rounded-full flex items-center justify-center text-xl font-bold text-white">
            {me?.name?.[0] || '?'}
          </div>
          <div>
            <div className="text-lg font-bold text-gray-800">{me?.name}</div>
            <div className="text-base text-gray-400">{me?.email}</div>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 mt-5 text-base">
          <div className="bg-gray-50 rounded-xl px-4 py-3">
            <div className="text-sm text-gray-400 mb-0.5">소속</div>
            <div className="font-medium text-gray-700">{me?.company || '-'}</div>
          </div>
          <div className="bg-gray-50 rounded-xl px-4 py-3">
            <div className="text-sm text-gray-400 mb-0.5">권한</div>
            <div className="font-medium text-gray-700">{ROLE_LABEL[me?.role || ''] || me?.role || '-'}</div>
          </div>
        </div>
      </div>

      {/* 비밀번호 변경 */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
        <h2 className="font-bold text-gray-800 mb-1">비밀번호 변경</h2>
        <p className="text-sm text-gray-400 mb-5">보안을 위해 주기적으로 비밀번호를 변경해주세요.</p>

        <form onSubmit={changePassword} className="space-y-4">
          <div>
            <label className="block text-base font-medium text-gray-600 mb-1.5">현재 비밀번호</label>
            <input type="password" value={curPw} onChange={e => setCurPw(e.target.value)}
              autoComplete="current-password"
              className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-base focus:outline-none focus:ring-2 focus:ring-blue-400" />
          </div>
          <div>
            <label className="block text-base font-medium text-gray-600 mb-1.5">새 비밀번호</label>
            <input type="password" value={newPw} onChange={e => setNewPw(e.target.value)}
              autoComplete="new-password" placeholder="4자 이상"
              className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-base focus:outline-none focus:ring-2 focus:ring-blue-400" />
          </div>
          <div>
            <label className="block text-base font-medium text-gray-600 mb-1.5">새 비밀번호 확인</label>
            <input type="password" value={newPw2} onChange={e => setNewPw2(e.target.value)}
              autoComplete="new-password"
              className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-base focus:outline-none focus:ring-2 focus:ring-blue-400" />
          </div>

          {msg && (
            <div className={`text-base px-4 py-3 rounded-xl ${msg.type === 'ok' ? 'bg-green-50 border border-green-200 text-green-700' : 'bg-red-50 border border-red-200 text-red-600'}`}>
              {msg.text}
            </div>
          )}

          <button type="submit" disabled={saving}
            className="w-full px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-base font-medium disabled:opacity-50">
            {saving ? '변경 중...' : '비밀번호 변경'}
          </button>
        </form>
      </div>
    </div>
  );
}
