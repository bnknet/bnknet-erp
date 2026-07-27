// ⚠️ 서버 전용. 쿠팡 OpenAPI Secret Key(민감)를 사용하므로 절대 클라이언트 컴포넌트에서 import 금지.
// API 라우트(route.ts)에서만 사용한다. 키는 Vercel 환경변수로만 주입한다.
//
// 쿠팡 OpenAPI 키는 판매자(사업자) 계정마다 별도 → 로켓그로스 하는 사업자별로 키 세트를 둔다.
//   SJ글로벌:  COUPANG_SJ_ACCESS_KEY / COUPANG_SJ_SECRET_KEY / COUPANG_SJ_VENDOR_ID
//   IX글로벌:  COUPANG_IX_ACCESS_KEY / COUPANG_IX_SECRET_KEY / COUPANG_IX_VENDOR_ID
//
// 서명 규격(CEA): message = signed-date + METHOD + path + query, HMAC-SHA256(secret) → hex.
//   signed-date = 'yyMMdd'T'HHmmss'Z'' (GMT). 문서: developers.coupangcorp.com 'Creating HMAC Signature'.
import crypto from 'crypto';

const HOST = 'https://api-gateway.coupang.com';

export type CoupangAccount = { company: string; accessKey: string; secretKey: string; vendorId: string };

// 사업자별 계정 목록 (환경변수 세트가 다 있는 사업자만 포함)
export function coupangAccounts(): CoupangAccount[] {
  const out: CoupangAccount[] = [];
  const add = (company: string, a?: string, s?: string, v?: string) => {
    if (a && s && v) out.push({ company, accessKey: a, secretKey: s, vendorId: v });
  };
  add('SJ글로벌', process.env.COUPANG_SJ_ACCESS_KEY, process.env.COUPANG_SJ_SECRET_KEY, process.env.COUPANG_SJ_VENDOR_ID);
  add('IX글로벌', process.env.COUPANG_IX_ACCESS_KEY, process.env.COUPANG_IX_SECRET_KEY, process.env.COUPANG_IX_VENDOR_ID);
  return out;
}

export function coupangConfigured(): boolean {
  return coupangAccounts().length > 0;
}

// GMT 기준 signed-date (예: 260727T051530Z)
function signedDate(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${String(d.getUTCFullYear()).slice(2)}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}T${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
}

/**
 * 쿠팡 OpenAPI 호출. 특정 사업자 계정(acc)의 키로 서명한다.
 * path=쿼리 제외 경로, query='?' 없는 쿼리스트링(서명 message와 요청 URL이 정확히 같아야 함).
 */
export async function coupangCall(acc: CoupangAccount, method: string, path: string, query = ''): Promise<Response> {
  const datetime = signedDate();
  const message = datetime + method + path + query;
  const signature = crypto.createHmac('sha256', acc.secretKey).update(message).digest('hex');
  const authorization = `CEA algorithm=HmacSHA256, access-key=${acc.accessKey}, signed-date=${datetime}, signature=${signature}`;
  const url = `${HOST}${path}${query ? `?${query}` : ''}`;
  return fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json;charset=UTF-8',
      Authorization: authorization,
      'X-Requested-By': acc.vendorId,
    },
  });
}
