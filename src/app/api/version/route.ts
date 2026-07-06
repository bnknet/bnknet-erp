import { NextResponse } from 'next/server';

// 현재 배포된 버전(커밋 SHA) 반환. 항상 최신 배포가 응답하므로,
// 클라이언트에 심긴 NEXT_PUBLIC_BUILD_ID와 비교해 새 배포를 감지한다.
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export function GET() {
  const id = process.env.VERCEL_GIT_COMMIT_SHA || 'dev';
  return NextResponse.json({ id }, { headers: { 'Cache-Control': 'no-store' } });
}
