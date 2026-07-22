import { NextRequest, NextResponse } from 'next/server';
import { adminFetch, adminConfigured } from '@/lib/supabaseAdmin';

// 관리자(인사)용 비밀번호 설정 — 직원 생성/초기화 시 employee_secrets에 저장(upsert).
export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  if (!adminConfigured()) return NextResponse.json({ ok: false, error: '서버 설정 오류' }, { status: 500 });
  const { employeeId, password } = await req.json().catch(() => ({}));
  if (!employeeId || !password) return NextResponse.json({ ok: false, error: '입력 누락' }, { status: 200 });

  const up = await adminFetch('/employee_secrets', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ employee_id: employeeId, password_hash: password, updated_at: new Date().toISOString() }),
  });
  if (!up.ok) return NextResponse.json({ ok: false, error: '저장 실패' }, { status: 200 });
  return NextResponse.json({ ok: true }, { status: 200 });
}
