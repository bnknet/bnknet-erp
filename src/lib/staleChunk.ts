// 배포 직후 열려 있던 '옛 화면'이 새 배포의 코드 조각(chunk)을 못 불러오는 오류 감지.
// 증상: 엑셀 파싱 등 지연 로딩 시 "Failed to load chunk /_next/static/chunks/…" — 코드 버그가 아니라 새로고침이 해결책.
export const STALE_CHUNK_MSG = '새 버전이 배포되어 지금 열린 화면이 오래됐습니다. 페이지를 새로고침(F5)한 뒤 다시 시도해 주세요.';

export function isStaleChunkError(e: unknown): boolean {
  const msg = e instanceof Error ? `${e.name} ${e.message}` : String(e ?? '');
  return /ChunkLoadError|Failed to load chunk|Loading chunk [^ ]* failed|Failed to fetch dynamically imported module|Importing a module script failed/i.test(msg);
}

// 옛 화면 오류면 안내 후(확인 시) 새로고침. 반환값 true = 이 오류는 처리됨(다른 오류 메시지 띄우지 말 것).
export function promptReloadIfStale(e: unknown): boolean {
  if (!isStaleChunkError(e)) return false;
  if (typeof window !== 'undefined' && window.confirm(`${STALE_CHUNK_MSG}\n\n지금 새로고침할까요?`)) window.location.reload();
  return true;
}
