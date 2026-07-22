import { NextRequest, NextResponse } from 'next/server';
import { adminFetch, adminConfigured } from '@/lib/supabaseAdmin';

// 본인 비밀번호 변경 — 현재 비밀번호 검증 후 employee_secrets 갱신(upsert).
export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  if (!adminConfigured()) return NextResponse.json({ ok: false, error: '서버 설정 오류' }, { status: 500 });
  const { employeeId, currentPw, newPw } = await req.json().catch(() => ({}));
  if (!employeeId || !currentPw || !newPw) {
    return NextResponse.json({ ok: false, error: '입력이 누락되었습니다.' }, { status: 200 });
  }

  // 현재 비밀번호 확인
  const chk = await adminFetch(
    `/employee_secrets?employee_id=eq.${employeeId}&password_hash=eq.${encodeURIComponent(currentPw)}&select=employee_id`,
  );
  const chkRows = await chk.json().catch(() => []);
  if (!Array.isArray(chkRows) || chkRows.length === 0) {
    return NextResponse.json({ ok: false, error: '현재 비밀번호가 올바르지 않습니다.' }, { status: 200 });
  }

  // upsert(merge-duplicates) — employee_id가 PK라 있으면 갱신, 없으면 생성
  const up = await adminFetch('/employee_secrets', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ employee_id: employeeId, password_hash: newPw, updated_at: new Date().toISOString() }),
  });
  if (!up.ok) return NextResponse.json({ ok: false, error: '변경 저장 실패' }, { status: 200 });
  return NextResponse.json({ ok: true }, { status: 200 });
}
