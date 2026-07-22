// ⚠️ 서버 전용. service_role 키(전권)를 사용하므로 절대 클라이언트 컴포넌트에서 import 금지.
// API 라우트('use server' / route.ts)에서만 사용한다. RLS를 우회해 접근하므로,
// 이 헬퍼로 다루는 테이블은 anon(외부) 직접 접근을 RLS로 막아 보호한다.
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

export function adminConfigured(): boolean {
  return !!SERVICE_KEY;
}

export async function adminFetch(path: string, options: RequestInit = {}): Promise<Response> {
  return fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      ...(options.headers || {}),
    },
  });
}
