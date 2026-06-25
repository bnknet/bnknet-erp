'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { clearUser, getUser } from '@/lib/auth';
import { supabaseFetch } from '@/lib/supabase';

type MenuItem = { href: string; label: string; icon: string; badge?: boolean; roles?: string[] };
type MenuGroup = { group: string; items: MenuItem[] };

const menuItems: MenuGroup[] = [
  {
    group: '홈',
    items: [
      { href: '/notices', label: '공지사항', icon: '📢' },
      { href: '/dashboard', label: '대시보드', icon: '📊' },
    ],
  },
  {
    group: '매출 관리',
    items: [
      { href: '/sales', label: '매출 현황', icon: '💰' },
      { href: '/orders', label: '주문 변환', icon: '📦' },
      { href: '/sales-target', label: '매출 목표', icon: '🎯' },
    ],
  },
  {
    group: '재고·상품',
    items: [
      { href: '/inventory', label: '재고 관리', icon: '🏭' },
      { href: '/products', label: '상품 마스터', icon: '🛍️' },
    ],
  },
  {
    group: '결재·업무',
    items: [
      { href: '/approval', label: '결재', icon: '✍️', badge: true },
      { href: '/reports', label: '보고서', icon: '📋' },
      { href: '/worklog', label: '업무일지', icon: '📝' },
      { href: '/calendar', label: '행사 및 일정', icon: '📅' },
    ],
  },
  {
    group: '인사·조직',
    items: [
      { href: '/hr', label: '인사 관리', icon: '👥' },
      { href: '/attendance', label: '출·퇴근', icon: '⏰' },
    ],
  },
  {
    group: '관리',
    items: [
      { href: '/cards', label: '카드·매입', icon: '💳' },
      { href: '/partners', label: '거래처 관리', icon: '🤝' },
      { href: '/accounts', label: '계정 관리', icon: '🔑' },
    ],
  },
];

interface SidebarProps {
  mobileOpen: boolean;
  onClose: () => void;
}

export default function Sidebar({ mobileOpen, onClose }: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const user = getUser();
  const isCeo = user?.role === 'ceo';
  const isAdmin = user?.role === 'admin';
  const [pendingCount, setPendingCount] = useState(0);

  useEffect(() => {
    if (!isCeo && !isAdmin) return;
    async function fetchPending() {
      try {
        const res = await supabaseFetch('/approvals?status=eq.pending&select=id,company,approver1_status,approver2_status');
        const data = await res.json();
        if (!Array.isArray(data)) return;

        // BNKNET: admin=실장 1단계, ceo=대표 2단계
        // 나머지: ceo=대표 1단계
        const BNKNET_LINE_LEN = 3;
        const companiesWithStep2 = ['BNKNET'];

        let count = 0;
        for (const a of data) {
          const hasStep2 = companiesWithStep2.includes(a.company);
          if (hasStep2) {
            if (isAdmin && a.approver1_status === 'pending') count++;
            if (isCeo && a.approver1_status === 'approved' && a.approver2_status === 'pending') count++;
          } else {
            if (isCeo && a.approver1_status === 'pending') count++;
          }
        }
        setPendingCount(count);
      } catch { /* ignore */ }
    }
    fetchPending();
    const interval = setInterval(fetchPending, 60000); // 1분마다 갱신
    return () => clearInterval(interval);
  }, [isCeo, isAdmin]);

  function handleLogout() {
    clearUser();
    router.push('/login');
  }

  return (
    <>
      {mobileOpen && (
        <div className="fixed inset-0 bg-black/50 z-20 lg:hidden" onClick={onClose} />
      )}

      <aside
        className={`
          fixed top-0 left-0 h-full w-64 bg-slate-900 text-white z-30 flex flex-col
          transform transition-transform duration-300 ease-in-out
          ${mobileOpen ? 'translate-x-0' : '-translate-x-full'}
          lg:translate-x-0 lg:static lg:z-auto
        `}
      >
        {/* 로고 */}
        <div className="px-6 py-5 border-b border-slate-700">
          <Link href="/dashboard" className="flex items-center gap-3 hover:opacity-80 transition-opacity">
            <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center flex-shrink-0">
              <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-2 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
              </svg>
            </div>
            <div>
              <div className="font-bold text-base leading-tight">ERP</div>
            </div>
          </Link>
        </div>

        {/* 메뉴 */}
        <nav className="flex-1 overflow-y-auto py-4 px-3">
          {menuItems.map((group) => {
            const visibleItems = group.items.filter(
              (item) => !item.roles || item.roles.includes(user?.role || '')
            );
            if (visibleItems.length === 0) return null;
            return (
            <div key={group.group} className="mb-4">
              <div className="px-3 py-1 text-sm font-semibold text-slate-500 uppercase tracking-wider mb-1">
                {group.group}
              </div>
              {visibleItems.map((item) => {
                const isActive = pathname === item.href || pathname.startsWith(item.href + '/');
                const showBadge = item.badge && pendingCount > 0;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={onClose}
                    className={`
                      flex items-center gap-3 px-3 py-2 rounded-lg text-base transition-all mb-0.5
                      ${isActive
                        ? 'bg-blue-600 text-white font-medium'
                        : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                      }
                    `}
                  >
                    <span className="text-base w-5 flex-shrink-0 inline-flex items-center justify-center leading-none">{item.icon}</span>
                    <span className="flex-1">{item.label}</span>
                    {showBadge && (
                      <span className="bg-red-500 text-white text-sm font-bold rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1">
                        {pendingCount}
                      </span>
                    )}
                  </Link>
                );
              })}
            </div>
            );
          })}
        </nav>

        {/* 하단 사용자 정보 */}
        <div className="px-4 py-4 border-t border-slate-700">
          <div className="flex items-center gap-3">
            <Link href="/profile" onClick={onClose} className="flex items-center gap-3 flex-1 min-w-0 hover:opacity-80 transition-opacity">
              <div className="w-8 h-8 bg-blue-600 rounded-full flex items-center justify-center text-base font-semibold flex-shrink-0">
                {user?.name?.[0] || '?'}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-base font-medium text-white truncate">{user?.name || '사용자'}</div>
                <div className="text-sm text-slate-400 truncate">내 정보 · 비밀번호 변경</div>
              </div>
            </Link>
            <button
              onClick={handleLogout}
              className="text-slate-400 hover:text-white transition-colors p-1"
              title="로그아웃"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}
