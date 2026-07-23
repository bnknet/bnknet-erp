// ⚠️ 서버 전용. 쿠팡 OpenAPI Secret Key(민감)를 사용하므로 절대 클라이언트 컴포넌트에서 import 금지.
// API 라우트(route.ts)에서만 사용한다. 키는 Vercel 환경변수로만 주입한다.
//   COUPANG_ACCESS_KEY / COUPANG_SECRET_KEY / COUPANG_VENDOR_ID(업체코드)
// 서명 규격(CEA): message = signed-date + METHOD + path + query, HMAC-SHA256(secret) → hex.
//   signed-date = 'yyMMdd'T'HHmmss'Z'' (GMT). 자세한 규격: developers.coupangcorp.com 'Creating HMAC Signature'.
import crypto from 'crypto';

const HOST = 'https://api-gateway.coupang.com';
const ACCESS = process.env.COUPANG_ACCESS_KEY || '';
const SECRET = process.env.COUPANG_SECRET_KEY || '';
const VENDOR = process.env.COUPANG_VENDOR_ID || '';

export function coupangConfigured(): boolean {
  return !!(ACCESS && SECRET && VENDOR);
}
export function coupangVendorId(): string {
  return VENDOR;
}

// GMT 기준 signed-date (예: 260723T051530Z)
function signedDate(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${String(d.getUTCFullYear()).slice(2)}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}T${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
}

/**
 * 쿠팡 OpenAPI 호출. path=쿼리 제외 경로, query='?' 없는 쿼리스트링.
 * 서명 message와 실제 요청 URL이 정확히 같은 query를 쓰도록 한 곳에서 처리한다.
 */
export async function coupangCall(method: string, path: string, query = ''): Promise<Response> {
  const datetime = signedDate();
  const message = datetime + method + path + query;
  const signature = crypto.createHmac('sha256', SECRET).update(message).digest('hex');
  const authorization = `CEA algorithm=HmacSHA256, access-key=${ACCESS}, signed-date=${datetime}, signature=${signature}`;
  const url = `${HOST}${path}${query ? `?${query}` : ''}`;
  return fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json;charset=UTF-8',
      Authorization: authorization,
      'X-Requested-By': VENDOR,
    },
  });
}
