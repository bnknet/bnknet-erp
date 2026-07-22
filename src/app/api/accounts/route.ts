import { NextRequest, NextResponse } from 'next/server';
import { adminFetch, adminConfigured } from '@/lib/supabaseAdmin';

// 계정 관리(accounts: 외부 서비스 비밀번호) — 서버(service_role) 경유 전용.
// accounts 테이블은 RLS로 anon(외부) 직접 접근을 막고, 이 라우트로만 다룬다.
export const runtime = 'nodejs';

function notReady() {
  return NextResponse.json(
    { error: '서버 키(SUPABASE_SERVICE_ROLE_KEY)가 설정되지 않았습니다.' },
    { status: 500 },
  );
}

export async function GET() {
  if (!adminConfigured()) return notReady();
  const res = await adminFetch('/accounts?order=category.asc,service_name.asc');
  const data = await res.json().catch(() => []);
  return NextResponse.json(data, { status: res.ok ? 200 : res.status });
}

export async function POST(req: NextRequest) {
  if (!adminConfigured()) return notReady();
  const body = await req.json();
  const res = await adminFetch('/accounts', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify(body),
  });
  return NextResponse.json({ ok: res.ok }, { status: res.ok ? 200 : res.status });
}

export async function PATCH(req: NextRequest) {
  if (!adminConfigured()) return notReady();
  const { id, ...rest } = await req.json();
  if (!id) return NextResponse.json({ error: 'id 필요' }, { status: 400 });
  const res = await adminFetch(`/accounts?id=eq.${id}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify(rest),
  });
  return NextResponse.json({ ok: res.ok }, { status: res.ok ? 200 : res.status });
}

export async function DELETE(req: NextRequest) {
  if (!adminConfigured()) return notReady();
  const id = new URL(req.url).searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id 필요' }, { status: 400 });
  const res = await adminFetch(`/accounts?id=eq.${id}`, { method: 'DELETE' });
  return NextResponse.json({ ok: res.ok }, { status: res.ok ? 200 : res.status });
}
