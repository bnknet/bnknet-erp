'use client';

import { Fragment, useEffect, useState } from 'react';
import { getUser } from '@/lib/auth';
import { supabaseFetch, supabaseFetchAll } from '@/lib/supabase';
import { MENU_GROUPS, ALL_MENUS, EDITABLE_ROLES, ROLE_LABELS, ALWAYS_ALLOWED, defaultAllowed } from '@/lib/menuConfig';
import { loadMenuPerms, clearMenuPermsCache } from '@/lib/menuPerms';

const roleKeys = EDITABLE_ROLES as readonly string[];

export default function PermissionsContent() {
  const me = getUser();
  const canManage = me?.role === 'ceo' || me?.role === 'admin';

  const [sel, setSel] = useState<Record<string, Set<string>>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const perms = await loadMenuPerms();
      const s: Record<string, Set<string>> = {};
      for (const role of roleKeys) {
        s[role] = new Set<string>();
        for (const m of ALL_MENUS) {
          const allowed = perms.configured ? (perms.map[role]?.has(m.href) ?? false) : defaultAllowed(role, m.href);
          if (allowed) s[role].add(m.href);
        }
      }
      setSel(s);
      setLoading(false);
    })();
  }, []);

  // 고정(수정 불가) 셀 — 항상 허용/강제 규칙 안내
  const forcedState = (role: string, href: string): boolean | null => {
    if (ALWAYS_ALLOWED.includes(href)) return true;         // 항상 허용
    if (href === '/permissions') return role === 'admin';   // 권한관리 = 실장만(대표는 항상)
    return null;                                            // 편집 가능
  };

  function toggle(role: string, href: string) {
    setSel((prev) => {
      const next = { ...prev, [role]: new Set(prev[role]) };
      if (next[role].has(href)) next[role].delete(href); else next[role].add(href);
      return next;
    });
  }

  async function save() {
    setSaving(true);
    try {
      const desired: { role: string; href: string }[] = [];
      for (const role of roleKeys) {
        for (const m of ALL_MENUS) {
          if (forcedState(role, m.href) !== null) continue; // 고정 규칙은 저장하지 않음(코드가 처리)
          if (sel[role]?.has(m.href)) desired.push({ role, href: m.href });
        }
      }
      if (desired.length) {
        const res = await supabaseFetch('/menu_permissions?on_conflict=role,href', {
          method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
          body: JSON.stringify(desired),
        });
        if (!res.ok) throw new Error(String(res.status));
      }
      // 이번에 선택 안 된(편집 대상) 기존 행 삭제
      const existing = await supabaseFetchAll<{ role: string; href: string }>('/menu_permissions?select=role,href');
      const desiredSet = new Set(desired.map((d) => `${d.role}|${d.href}`));
      for (const e of existing) {
        if (!roleKeys.includes(e.role)) continue;
        if (!desiredSet.has(`${e.role}|${e.href}`)) {
          await supabaseFetch(`/menu_permissions?role=eq.${encodeURIComponent(e.role)}&href=eq.${encodeURIComponent(e.href)}`, { method: 'DELETE' });
        }
      }
      clearMenuPermsCache();
      alert('저장되었습니다. 각 직원이 새로고침(또는 재접속)하면 반영됩니다.');
    } catch (e) {
      alert(`저장 실패 (${e instanceof Error ? e.message : ''}). db/menu_permissions.sql 적용 여부를 확인해주세요.`);
    } finally { setSaving(false); }
  }

  function resetDefault() {
    if (!confirm('현재 화면을 기본값(역할 기본 접근)으로 되돌립니다. 저장을 눌러야 반영됩니다.')) return;
    const s: Record<string, Set<string>> = {};
    for (const role of roleKeys) {
      s[role] = new Set<string>();
      for (const m of ALL_MENUS) if (defaultAllowed(role, m.href)) s[role].add(m.href);
    }
    setSel(s);
  }

  if (!canManage) {
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-2xl px-5 py-8 text-center">
        <div className="text-lg font-semibold text-amber-700">🔒 접근 권한이 없습니다</div>
        <div className="text-sm text-amber-600 mt-1">권한 관리는 대표·실장만 이용할 수 있습니다.</div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-gray-800">권한 관리</h1>
          <p className="text-sm text-gray-400 mt-1">역할별로 어떤 메뉴를 볼 수 있는지 설정합니다. 체크된 메뉴만 해당 역할에게 보이고, 숨긴 메뉴는 주소로 직접 접근해도 대시보드로 이동됩니다.</p>
        </div>
        <div className="flex gap-2">
          <button onClick={resetDefault} className="px-3 py-2 rounded-lg border border-gray-200 text-sm text-gray-600 hover:bg-gray-50">기본값으로</button>
          <button onClick={save} disabled={saving || loading} className="px-5 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-base font-medium disabled:opacity-50">{saving ? '저장 중…' : '저장'}</button>
        </div>
      </div>

      <div className="text-xs text-gray-500 bg-gray-50 border border-gray-100 rounded-xl px-4 py-2.5 leading-relaxed">
        · <b>대표</b>는 항상 모든 메뉴에 접근합니다(표에서 제외). · <b>대시보드·공지·내정보</b>는 항상 허용(잠금 방지). · <b>권한 관리</b>는 대표·실장만.
      </div>

      {loading ? (
        <div className="text-center py-12 text-gray-400">불러오는 중…</div>
      ) : (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-x-auto">
          <table className="w-full text-base">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                <th className="text-left font-medium text-gray-500 px-4 py-3 sticky left-0 bg-gray-50 min-w-[160px]">메뉴</th>
                {roleKeys.map((r) => (
                  <th key={r} className="text-center font-medium text-gray-600 px-3 py-3 whitespace-nowrap">{ROLE_LABELS[r] || r}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {MENU_GROUPS.map((group) => (
                <Fragment key={group.group}>
                  <tr className="bg-gray-50/60">
                    <td colSpan={roleKeys.length + 1} className="px-4 py-1.5 text-xs font-semibold text-gray-400 uppercase tracking-wider">{group.group}</td>
                  </tr>
                  {group.items.map((m) => (
                    <tr key={m.href} className="border-t border-gray-50 hover:bg-blue-50/30">
                      <td className="px-4 py-2.5 text-gray-700 sticky left-0 bg-white">{m.icon} {m.label}</td>
                      {roleKeys.map((role) => {
                        const forced = forcedState(role, m.href);
                        const checked = forced !== null ? forced : (sel[role]?.has(m.href) ?? false);
                        return (
                          <td key={role} className="text-center px-3 py-2.5">
                            <input type="checkbox" checked={checked} disabled={forced !== null}
                              onChange={() => toggle(role, m.href)}
                              className={`w-4 h-4 rounded border-gray-300 text-blue-600 ${forced !== null ? 'opacity-40' : 'cursor-pointer'}`}
                              title={forced !== null ? '고정 규칙(수정 불가)' : ''} />
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-gray-400">저장 후, 각 직원 계정은 화면을 <b>새로고침</b>하면 바뀐 권한이 적용됩니다.</p>
    </div>
  );
}
