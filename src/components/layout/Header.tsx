'use client';

import { usePathname } from 'next/navigation';
import { useRouter } from 'next/navigation';
import { getUser, clearUser } from '@/lib/auth';

const pageTitles: Record<string, string> = {
  '/dashboard': '대시보드',
  '/sales': '매출 현황',
  '/orders': '주문 변환',
  '/settlement': '정산 관리',
  '/sales-target': '매출 목표',
  '/inventory': '재고 관리',
  '/products': '상품 마스터',
  '/approval': '결재',
  '/worklog': '업무일지',
  '/calendar': '회사 캘린더',
  '/hr': '인사 관리',
  '/attendance': '출·퇴근',
  '/cards': '카드·매입',
  '/partners': '거래처 관리',
  '/accounts': '계정 관리',
  '/notices': '공지사항',
};

const roleLabels: Record<string, string> = {
  admin: '대표·실장',
  manager: '실장',
  sales: '매출 담당',
  inventory: '재고·주문 담당',
  md: 'MD',
};

interface HeaderProps {
  onMenuClick: () => void;
}

export default function Header({ onMenuClick }: HeaderProps) {
  const pathname = usePathname();
  const router = useRouter();
  const user = getUser();

  function handleLogout() {
    clearUser();
    router.push('/login');
  }

  const title = pageTitles[pathname] || '비앤케이넷 ERP';
  const today = new Date().toLocaleDateString('ko-KR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'short',
  });

  return (
    <header className="h-16 bg-white border-b border-gray-200 flex items-center justify-between px-6 flex-shrink-0">
      <div className="flex items-center gap-4">
        {/* 모바일 메뉴 버튼 */}
        <button
          onClick={onMenuClick}
          className="lg:hidden text-gray-500 hover:text-gray-700"
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>

        <div>
          <h1 className="text-xl font-bold text-gray-800">{title}</h1>
          <p className="text-xs text-gray-400 hidden sm:block">{today}</p>
        </div>
      </div>

      <div className="flex items-center gap-3">
        {/* 알림 버튼 (추후 기능 추가) */}
        <button className="relative p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
          </svg>
        </button>

        {/* 사용자 정보 */}
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-blue-600 rounded-full flex items-center justify-center text-sm font-semibold text-white">
            {user?.name?.[0] || '?'}
          </div>
          <div className="hidden sm:block">
            <div className="text-sm font-medium text-gray-700">{user?.name}</div>
            <div className="text-xs text-gray-400">{user?.role ? (roleLabels[user.role] || user.role) : ''}</div>
          </div>
        </div>

        {/* 로그아웃 버튼 */}
        <button
          onClick={handleLogout}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-500 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors border border-gray-200 hover:border-red-200"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
          </svg>
          <span className="hidden sm:inline">로그아웃</span>
        </button>
      </div>
    </header>
  );
}
