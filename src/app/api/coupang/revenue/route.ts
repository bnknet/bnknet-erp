import { NextRequest, NextResponse } from 'next/server';
import { coupangCall, coupangConfigured, coupangVendorId } from '@/lib/coupang';

// 쿠팡 로켓그로스 매출내역(revenue-history) 조회 — 서버(HMAC 서명) 경유 전용.
// 정산은 제외, "몇 개 팔렸고 매출 얼마"만 확인하는 용도. 실제 응답 필드를 확인하기 위해
// 우선 raw 데이터를 그대로 돌려준다(키 주입 후 응답 스키마 확정 → 매출·수량·공헌이익 매핑/화면 붙임).
// 사용: GET /api/coupang/revenue?from=YYYY-MM-DD&to=YYYY-MM-DD
export const runtime = 'nodejs';

const kstToday = () => new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);

interface RawResp {
  data?: unknown;
  content?: unknown;
  nextToken?: string;
  code?: string | number;
  message?: string;
}

export async function GET(req: NextRequest) {
  if (!coupangConfigured()) {
    return NextResponse.json(
      { error: '쿠팡 키가 설정되지 않았습니다. Vercel 환경변수 COUPANG_ACCESS_KEY / COUPANG_SECRET_KEY / COUPANG_VENDOR_ID 를 확인해주세요.' },
      { status: 500 },
    );
  }
  const sp = new URL(req.url).searchParams;
  const to = sp.get('to') || kstToday();
  const from = sp.get('from') || to;
  const vendorId = coupangVendorId();
  const path = '/v2/providers/openapi/apis/api/v1/revenue-history';

  const items: unknown[] = [];
  let token = '';
  let pages = 0;
  let lastRaw: RawResp | null = null;
  try {
    do {
      const query =
        `vendorId=${encodeURIComponent(vendorId)}` +
        `&recognitionDateFrom=${from}&recognitionDateTo=${to}&maxPerPage=100` +
        (token ? `&token=${encodeURIComponent(token)}` : '');
      const res = await coupangCall('GET', path, query);
      const raw = (await res.json().catch(() => null)) as RawResp | null;
      if (!res.ok) {
        // 서명/권한/파라미터 문제 진단을 위해 쿠팡 응답 원문을 그대로 노출(민감정보 아님).
        return NextResponse.json({ ok: false, status: res.status, from, to, raw }, { status: 200 });
      }
      lastRaw = raw;
      const data = (raw?.data ?? raw?.content ?? raw) as unknown;
      const arr = Array.isArray(data)
        ? data
        : (data && typeof data === 'object' && Array.isArray((data as { items?: unknown[] }).items))
          ? (data as { items: unknown[] }).items
          : [];
      items.push(...arr);
      token = String(raw?.nextToken || (data as { nextToken?: string })?.nextToken || '');
      pages++;
    } while (token && pages < 50);

    return NextResponse.json({
      ok: true,
      from,
      to,
      count: items.length,
      pages,
      sample: items[0] ?? lastRaw, // 첫 항목(필드 확인용)
      items,
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 200 });
  }
}
