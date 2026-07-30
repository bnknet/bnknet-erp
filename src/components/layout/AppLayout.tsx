'use client';

import { useState, useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Sidebar from './Sidebar';
import Header from './Header';
import { isLoggedIn, getUser, isPathAllowed } from '@/lib/auth';
import { ALL_MENUS } from '@/lib/menuConfig';
import { loadMenuPerms, isMenuAllowed } from '@/lib/menuPerms';

interface AppLayoutProps {
  children: React.ReactNode;
}

export default function AppLayout({ children }: AppLayoutProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!isLoggedIn()) { router.replace('/login'); return; }
      const u = getUser();
      if (u && !isPathAllowed(u.role, pathname)) {
        // 제한 역할(partner 등)이 허용되지 않은 메뉴로 직접 접근 → 거래처로 보냄
        router.replace('/partners');
        return;
      }
      // 역할·메뉴 접근권한: 숨긴 메뉴로 직접 URL 접근 시 대시보드로 보냄(대표·기본허용은 통과)
      if (u && u.role !== 'partner') {
        const perms = await loadMenuPerms();
        const item = ALL_MENUS.find((m) => pathname === m.href || pathname.startsWith(m.href + '/'));
        if (item && !isMenuAllowed(u.role, item.href, perms)) {
          router.replace('/dashboard');
          return;
        }
      }
      if (!cancelled) setChecked(true);
    })();
    return () => { cancelled = true; };
  }, [router, pathname]);

  if (!checked) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-gray-400">로딩 중...</div>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-gray-50 overflow-hidden">
      <Sidebar mobileOpen={mobileOpen} onClose={() => setMobileOpen(false)} />

      <div className="flex flex-col flex-1 min-w-0">
        <Header onMenuClick={() => setMobileOpen(true)} />
        <main className="flex-1 overflow-y-auto p-4 sm:p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
