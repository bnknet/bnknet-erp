// 역할·메뉴별 접근 권한 (menu_permissions 테이블) 로드·판정.
// 안전 규칙:
//  - 대표(ceo)는 항상 전체 접근.
//  - 설정이 하나도 없으면(configured=false) 기존 하드코딩 기본값을 그대로 사용(변화 없음).
//  - /permissions(권한 관리)는 대표·실장만.
//  - ALWAYS_ALLOWED(대시보드·내정보·공지)는 항상 허용해 잠금 사고 방지.
import { supabaseFetchAll } from './supabase';
import { ALWAYS_ALLOWED, defaultAllowed } from './menuConfig';

export type PermMap = { configured: boolean; map: Record<string, Set<string>> };

let cache: PermMap | null = null;

export async function loadMenuPerms(): Promise<PermMap> {
  if (cache) return cache;
  try {
    const rows = await supabaseFetchAll<{ role: string; href: string }>('/menu_permissions?select=role,href');
    const map: Record<string, Set<string>> = {};
    for (const r of Array.isArray(rows) ? rows : []) { (map[r.role] ??= new Set()).add(r.href); }
    cache = { configured: (Array.isArray(rows) ? rows.length : 0) > 0, map };
  } catch {
    cache = { configured: false, map: {} }; // 조회 실패 시 기본값(현행) 유지
  }
  return cache;
}

export function clearMenuPermsCache() { cache = null; }

export const EMPTY_PERMS: PermMap = { configured: false, map: {} };

export function isMenuAllowed(role: string, href: string, perms: PermMap): boolean {
  if (role === 'ceo') return true;                       // 대표는 항상 전체
  if (href === '/permissions') return role === 'admin';  // 권한 관리 = 대표·실장만
  if (ALWAYS_ALLOWED.includes(href)) return true;        // 잠금 사고 방지
  if (!perms.configured) return defaultAllowed(role, href);
  return perms.map[role]?.has(href) ?? false;
}
