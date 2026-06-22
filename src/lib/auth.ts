export type UserRole = 'ceo' | 'admin' | 'manager' | 'sales' | 'inventory' | 'md';

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
