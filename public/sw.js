// BNKnet ERP 서비스워커 — 설치형 PWA용 (동일 출처만 캐시, Supabase API는 통과)
const CACHE = 'bnknet-erp-v1';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // 외부(Supabase API 등)는 캐시하지 않고 그대로 통과 → 항상 최신 데이터
  if (url.origin !== self.location.origin) return;
  // 네트워크 우선, 실패 시 캐시 (오프라인 fallback)
  event.respondWith(
    fetch(req)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(req))
  );
});
