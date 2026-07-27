import { NextRequest, NextResponse } from 'next/server';
import { coupangCall, coupangConfigured, coupangAccounts, type CoupangAccount } from '@/lib/coupang';

// 쿠팡 로켓그로스 매출내역(revenue-history) 조회 — 서버(HMAC 서명) 경유 전용.
// 사업자(SJ글로벌·IX글로벌)별로 각각 호출해 회사 태깅. 정산 제외, "몇 개·매출 얼마"만 확인 용도.
// 실제 응답 필드 확정 전까지 raw 데이터를 그대로 돌려준다.
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

async function fetchAccount(acc: CoupangAccount, from: string, to: string) {
  const path = '/v2/providers/openapi/apis/api/v1/revenue-history';
  const items: unknown[] = [];
  let token = '';
  let pages = 0;
  let lastRaw: RawResp | null = null;
  try {
    do {
      const query =
        `vendorId=${encodeURIComponent(acc.vendorId)}` +
        `&recognitionDateFrom=${from}&recognitionDateTo=${to}&maxPerPage=100` +
        (token ? `&token=${encodeURIComponent(token)}` : '');
      const res = await coupangCall(acc, 'GET', path, query);
      const raw = (await res.json().catch(() => null)) as RawResp | null;
      if (!res.ok) {
        return { company: acc.company, vendorId: acc.vendorId, ok: false, status: res.status, raw };
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
    return { company: acc.company, vendorId: acc.vendorId, ok: true, count: items.length, pages, sample: items[0] ?? lastRaw, items };
  } catch (e) {
    return { company: acc.company, vendorId: acc.vendorId, ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function GET(req: NextRequest) {
  if (!coupangConfigured()) {
    return NextResponse.json(
      { error: '쿠팡 키가 설정되지 않았습니다. Vercel 환경변수 COUPANG_SJ_* / COUPANG_IX_* (ACCESS_KEY·SECRET_KEY·VENDOR_ID)를 확인해주세요.' },
      { status: 500 },
    );
  }
  const sp = new URL(req.url).searchParams;
  const to = sp.get('to') || kstToday();
  const from = sp.get('from') || to;

  const accounts = coupangAccounts();
  const results = [];
  for (const acc of accounts) {
    results.push(await fetchAccount(acc, from, to));
  }
  return NextResponse.json({ ok: true, from, to, accounts: results });
}
