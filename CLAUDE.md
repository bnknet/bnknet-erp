# CLAUDE.md — BNKNET ERP

Claude Code가 이 레포에서 작업할 때 따르는 규칙. 세션 시작 시 자동 로드된다.

## 프로젝트
- Next.js 16(App Router) · React 19 · TypeScript · Tailwind · Vercel 배포.
- 데이터: Supabase REST(PostgREST)를 `supabaseFetch`/`supabaseFetchAll`(anon key)로 호출. `src/lib/supabase.ts`.
- 권한은 클라이언트(sessionStorage) 기반(role: ceo/admin/sales/inventory/md). 서버 RLS는 장기 과제.

## 작업 4원칙 (Karpathy)
1. **생각 먼저** — 가정을 명시한다. 모호하면 멋대로 고르지 말고 되묻는다(AskUserQuestion). 더 단순한 길이 있으면 말한다. 헷갈리면 멈추고 질문한다.
2. **단순함 우선** — 문제를 푸는 최소한의 코드만. 투기적 추상화·미래 대비 코드 금지.
3. **외과적 수정** — 요청한 것만 건드린다. 내가 만든 흔적만 정리한다. 바뀐 모든 줄은 요청과 직접 연결돼야 한다.
4. **목표 기반 실행** — 성공 기준을 정하고, 검증(타입체크·빌드·동작 확인)될 때까지 반복한다.

## 이 레포 고유 규칙
- **데이터 우선, 추측 금지**: 버그·현상 진단은 먼저 실제 데이터(SQL 조회)로 확인한다. 원인을 추측해 고치지 않는다.
- **SQL 제공 방식**: 스키마 변경·데이터 수정이 필요하면 사용자가 Supabase에서 실행하도록 **복붙 가능한 SQL**을 제시하고, `db/*.sql`로도 남긴다. `if (not) exists`로 재실행에 안전하게.
- **배포 = PR 머지**: 브랜치 푸시만으론 운영 반영이 안 된다. 반드시 PR → main 스쿼시 머지 → 브랜치 재동기화(`git fetch origin main && git checkout -B <branch> origin/main` → force-with-lease). 머지·검증 후에만 "완료".
- **커밋 전 검증**: `npx tsc --noEmit`와 `npm run build` 통과 후 커밋.
- **계산 일관성**: 매출·공헌이익·영업이익 등 금액 계산은 공용 함수(`salesStats.computeOrderLines`)로 단일화한다. 화면마다 숫자가 달라지면 안 된다.
- **날짜는 KST**: `new Date(Date.now() + 9*3600*1000).toISOString().slice(0,10)`. `new Date().toISOString()`은 UTC라 오전 9시 이전이면 전날로 밀린다.
- **권한 게이팅**: 민감 화면(삭제·변경이력·영업이익 등)은 role로 제한한다(예: canDelete = ceo/admin).
- **보안**: 봇/코드가 `accounts`(비밀번호) 등 민감 테이블에 접근하지 않게 한다.

## 소통
- 한국어 존댓말, 따뜻하고 간결하게. 이모지 최소.
- 완료 보고는 사실대로: 실패는 실패라고, 검증된 것만 "완료".
- 커밋·PR·코드·문서에 AI 모델명(claude-*) 노출 금지.
