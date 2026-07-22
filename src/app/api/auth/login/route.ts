import { NextRequest, NextResponse } from 'next/server';
import { adminFetch, adminConfigured } from '@/lib/supabaseAdmin';

// 서버 로그인 검증. 비밀번호는 RLS로 잠긴 employee_secrets에서 service_role로만 대조.
// 실패(인증실패/미설정)는 클라이언트가 기존 방식으로 폴백하도록 ok:false를 준다.
export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  if (!adminConfigured()) return NextResponse.json({ ok: false }, { status: 200 });
  let email = '', password = '';
  try {
    const body = await req.json();
    email = String(body.email || '');
    password = String(body.password || '');
  } catch { return NextResponse.json({ ok: false }, { status: 200 }); }
  if (!email || !password) return NextResponse.json({ ok: false }, { status: 200 });

  // 활성 직원 조회
  const empRes = await adminFetch(
    `/employees?email=eq.${encodeURIComponent(email)}&status=eq.active&select=id,name,email,role,company`,
  );
  if (!empRes.ok) return NextResponse.json({ ok: false }, { status: 200 });
  const rows = await empRes.json().catch(() => []);
  if (!Array.isArray(rows) || rows.length === 0) return NextResponse.json({ ok: false }, { status: 200 });
  const emp = rows[0];

  // 비밀번호 대조 (employee_secrets)
  const secRes = await adminFetch(
    `/employee_secrets?employee_id=eq.${emp.id}&password_hash=eq.${encodeURIComponent(password)}&select=employee_id`,
  );
  const secRows = await secRes.json().catch(() => []);
  if (!Array.isArray(secRows) || secRows.length === 0) return NextResponse.json({ ok: false }, { status: 200 });

  return NextResponse.json({ ok: true, user: emp }, { status: 200 });
}
