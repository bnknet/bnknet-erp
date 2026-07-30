// 메뉴 정의 + 역할별 기본 접근 규칙 (사이드바·권한관리 공용)
export type MenuItem = { href: string; label: string; icon: string; badge?: boolean; roles?: string[] };
export type MenuGroup = { group: string; items: MenuItem[] };

export const MENU_GROUPS: MenuGroup[] = [
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
      { href: '/mall-fees', label: '몰 수수료', icon: '🧾', roles: ['ceo', 'admin', 'sales'] },
    ],
  },
  {
    group: '재고·상품',
    items: [
      { href: '/inventory', label: '재고 관리', icon: '🏭' },
      { href: '/purchasing', label: '발주·입고', icon: '🚚', roles: ['ceo', 'admin', 'sales', 'inventory'] },
      { href: '/products', label: '상품 마스터', icon: '🛍️' },
      { href: '/product-sets', label: '세트 구성', icon: '🎁', roles: ['ceo', 'admin', 'sales', 'inventory'] },
      { href: '/product-matches', label: '상품 매칭', icon: '🔗', roles: ['ceo', 'admin', 'sales', 'inventory'] },
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
      { href: '/hr', label: '인사 관리', icon: '👥', roles: ['ceo', 'admin'] },
      { href: '/attendance', label: '출·퇴근', icon: '⏰' },
    ],
  },
  {
    group: '관리',
    items: [
      { href: '/cards', label: '카드·매입', icon: '💳', roles: ['ceo', 'admin', 'manager', 'sales', 'inventory'] },
      { href: '/partners', label: '거래처 관리', icon: '🤝' },
      { href: '/accounts', label: '계정 관리', icon: '🔑' },
      { href: '/permissions', label: '권한 관리', icon: '🛡️', roles: ['ceo', 'admin'] },
    ],
  },
];

export const ALL_MENUS: MenuItem[] = MENU_GROUPS.flatMap((g) => g.items);

// 권한 관리에서 다루는 역할(대표=ceo는 항상 전체 접근이라 편집 대상에서 제외)
export const EDITABLE_ROLES = ['admin', 'manager', 'sales', 'inventory', 'md'] as const;
export const ROLE_LABELS: Record<string, string> = {
  ceo: '대표', admin: '실장', manager: '매니저', sales: '영업·재무', inventory: '재고', md: 'MD',
};

// 역할·설정과 무관하게 항상 접근 허용(잠금 사고 방지). /permissions는 별도(대표·실장만).
export const ALWAYS_ALLOWED = ['/dashboard', '/profile', '/notices'];

// 기본 허용(하드코딩) — 메뉴에 roles가 있으면 그 역할만, 없으면 전원.
export function defaultAllowed(role: string, href: string): boolean {
  const item = ALL_MENUS.find((m) => m.href === href);
  if (!item) return true;
  return !item.roles || item.roles.includes(role);
}
