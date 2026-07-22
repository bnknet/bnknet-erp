'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { setUser } from '@/lib/auth';
import { supabaseFetch } from '@/lib/supabase';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // 기존(레거시) 방식 로그인 — 서버 로그인 전환기 폴백(락아웃 방지). 서버 인증이 안 될 때만 사용.
  async function legacyLogin(): Promise<boolean> {
    const res = await supabaseFetch(
      `/employees?email=eq.${encodeURIComponent(email)}&status=eq.active&select=id,name,email,role,company`,
    );
    if (!res.ok) return false;
    const rows = await res.json();
    if (!Array.isArray(rows) || rows.length === 0) return false;
    const employee = rows[0];
    const pwRes = await supabaseFetch(
      `/employees?id=eq.${employee.id}&password_hash=eq.${encodeURIComponent(password)}&select=id`,
    );
    const pwRows = await pwRes.json().catch(() => []);
    if (!Array.isArray(pwRows) || pwRows.length === 0) return false;
    setUser({ id: employee.id, name: employee.name, email: employee.email, role: employee.role, company: employee.company });
    return true;
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      // 1) 서버 보안 로그인 우선 (비밀번호는 서버에서만 대조)
      try {
        const r = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password }),
        });
        const data = await r.json().catch(() => null);
        if (data?.ok && data.user) {
          const u = data.user;
          setUser({ id: u.id, name: u.name, email: u.email, role: u.role, company: u.company });
          router.push('/dashboard');
          return;
        }
      } catch { /* 서버 라우트 예외 → 폴백 시도 */ }

      // 2) 폴백: 기존 방식(전환기 안전장치)
      if (await legacyLogin()) {
        router.push('/dashboard');
        return;
      }

      setError('이메일 또는 비밀번호가 올바르지 않습니다.');
    } catch {
      setError('로그인 중 오류가 발생했습니다. 다시 시도해주세요.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-950 to-slate-900 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* 로고 영역 */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-blue-600 rounded-2xl mb-4 shadow-lg shadow-blue-500/30">
            <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-2 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-white">비앤케이넷 ERP</h1>
          <p className="text-blue-300 text-base mt-1">BNKNET Enterprise Resource Planning</p>
        </div>

        {/* 로그인 카드 */}
        <div className="bg-white rounded-2xl shadow-2xl p-8">
          <h2 className="text-xl font-semibold text-gray-800 mb-6">로그인</h2>

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-base font-medium text-gray-700 mb-1.5">
                이메일
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="example@bnknet.co.kr"
                required
                className="w-full px-4 py-3 border border-gray-200 rounded-xl text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
              />
            </div>

            <div>
              <label className="block text-base font-medium text-gray-700 mb-1.5">
                비밀번호
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="비밀번호를 입력하세요"
                required
                className="w-full px-4 py-3 border border-gray-200 rounded-xl text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
              />
            </div>

            {error && (
              <div className="bg-red-50 border border-red-200 text-red-600 text-base px-4 py-3 rounded-xl">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white font-semibold py-3 rounded-xl transition-colors shadow-md shadow-blue-500/20 mt-2"
            >
              {loading ? '로그인 중...' : '로그인'}
            </button>
          </form>
        </div>

        <p className="text-center text-blue-400 text-sm mt-6">
          © 2026 BNKNET · IX글로벌. All rights reserved.
        </p>
      </div>
    </div>
  );
}
