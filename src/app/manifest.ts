import type { MetadataRoute } from 'next';

// PWA 매니페스트 — 홈 화면 추가 시 앱처럼 동작(주소창 없는 풀스크린)
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: '비앤케이넷 ERP',
    short_name: 'BNKnet ERP',
    description: 'BNKNET 통합 ERP 시스템',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#ffffff',
    theme_color: '#6E5230',
    lang: 'ko',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
