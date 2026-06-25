const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

// Storage 저장 경로는 영문/숫자만 허용 (한글 등 비ASCII 파일명은 InvalidKey 오류)
// 원본 파일명은 화면 표시용으로 따로 보관할 것
export function safeStorageKey(originalName: string): string {
  const dot = originalName.lastIndexOf('.');
  const ext = dot >= 0 ? originalName.slice(dot + 1).replace(/[^a-zA-Z0-9]/g, '') : '';
  return `${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext ? '.' + ext : ''}`;
}

export async function supabaseUpload(bucket: string, path: string, file: File): Promise<string> {
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${bucket}/${path}`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': file.type,
      'x-upsert': 'true',
    },
    body: file,
  });
  if (!res.ok) {
    let detail = '';
    try { detail = await res.text(); } catch { /* ignore */ }
    throw new Error(`업로드 실패 (${res.status}) ${detail}`);
  }
  return `${SUPABASE_URL}/storage/v1/object/public/${bucket}/${path}`;
}

export const supabaseHeaders = (token?: string) => ({
  'Content-Type': 'application/json',
  apikey: SUPABASE_KEY,
  Authorization: `Bearer ${token || SUPABASE_KEY}`,
});

// 1000건 초과 데이터도 모두 가져오기 (PostgREST 기본 1000건 제한 우회)
// 집계/목록처럼 누락되면 안 되는 조회에 사용. 실패 시 throw (호출부에서 알림 처리).
export async function supabaseFetchAll<T = unknown>(path: string, token?: string): Promise<T[]> {
  const PAGE = 1000;
  const all: T[] = [];
  let start = 0;
  while (true) {
    const res = await supabaseFetch(path, { headers: { 'Range-Unit': 'items', Range: `${start}-${start + PAGE - 1}` } }, token);
    if (!res.ok) {
      let detail = '';
      try { detail = await res.text(); } catch { /* ignore */ }
      throw new Error(`데이터 조회 실패 (${res.status}) ${detail}`);
    }
    const chunk = await res.json();
    if (!Array.isArray(chunk) || chunk.length === 0) break;
    all.push(...chunk as T[]);
    if (chunk.length < PAGE) break;
    start += PAGE;
  }
  return all;
}

export async function supabaseFetch(
  path: string,
  options: RequestInit = {},
  token?: string
) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    ...options,
    headers: {
      ...supabaseHeaders(token),
      ...(options.headers || {}),
    },
  });
  return res;
}
