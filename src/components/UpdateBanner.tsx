'use client';

import { useEffect, useState } from 'react';

// 클라이언트 번들에 심긴 배포 버전 (빌드 시점 커밋 SHA)
const CURRENT = process.env.NEXT_PUBLIC_BUILD_ID || 'dev';

// 새 배포가 있으면 상단에 '새로고침' 배너를 띄운다.
// 서버 /api/version(항상 최신 배포)의 SHA와 현재 화면의 SHA를 비교.
export default function UpdateBanner() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!CURRENT || CURRENT === 'dev') return; // 로컬/미설정 환경은 감지 안 함
    let stopped = false;

    async function check() {
      try {
        const res = await fetch('/api/version', { cache: 'no-store' });
        if (!res.ok) return;
        const data = await res.json();
        if (!stopped && data?.id && data.id !== CURRENT) setShow(true);
      } catch { /* 오프라인 등은 무시 */ }
    }

    check();
    const onVis = () => { if (document.visibilityState === 'visible') check(); };
    document.addEventListener('visibilitychange', onVis);
    const iv = setInterval(check, 5 * 60 * 1000); // 5분마다 확인

    return () => {
      stopped = true;
      document.removeEventListener('visibilitychange', onVis);
      clearInterval(iv);
    };
  }, []);

  if (!show) return null;

  return (
    <div className="fixed top-0 inset-x-0 z-[100] bg-blue-600 text-white px-4 py-2.5 flex items-center justify-center gap-3 shadow-md">
      <span className="text-sm font-medium">새 버전이 있어요.</span>
      <button
        onClick={() => window.location.reload()}
        className="px-3 py-1 bg-white text-blue-700 rounded-lg text-sm font-bold hover:bg-blue-50 whitespace-nowrap"
      >
        새로고침
      </button>
      <button
        onClick={() => setShow(false)}
        aria-label="닫기"
        className="text-white/70 hover:text-white text-xl leading-none ml-1"
      >
        ×
      </button>
    </div>
  );
}
