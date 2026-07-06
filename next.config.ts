import type { NextConfig } from "next";

// 배포 식별자 — Vercel 커밋 SHA(배포마다 바뀜). 클라이언트 번들에 심어 최신 배포 감지에 사용.
const BUILD_ID = process.env.VERCEL_GIT_COMMIT_SHA || "dev";

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_BUILD_ID: BUILD_ID,
  },
};

export default nextConfig;
