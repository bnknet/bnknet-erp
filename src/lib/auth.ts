export type UserRole = 'ceo' | 'admin' | 'manager' | 'sales' | 'inventory' | 'md' | 'partner';

// 특정 역할은 지정한 경로만 접근 허용 (그 외 메뉴 숨김 + 직접 URL 차단)
// 예: 'partner' = 거래처 전용 (테스트/외부 협업용)
export const ROLE_ALLOWED_PATHS: Record<string, string[]> = {
  partner: ['/partners', '/profile'],
};

export function isPathAllowed(role: string | undefined, path: string): boolean {
  const allow = role ? ROLE_ALLOWED_PATHS[role] : undefined;
  if (!allow) return true;
  return allow.some((p) => path === p || path.startsWith(p + '/'));
}

export interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  company: string;
}

export function getUser(): User | null {
  if (typeof window === 'undefined') return null;
  const data = sessionStorage.getItem('erp_user');
  if (!data) return null;
  try {
    return JSON.parse(data) as User;
  } catch {
    return null;
  }
}

export function setUser(user: User) {
  sessionStorage.setItem('erp_user', JSON.stringify(user));
}

export function clearUser() {
  sessionStorage.removeItem('erp_user');
}

export function isLoggedIn(): boolean {
  return getUser() !== null;
}
