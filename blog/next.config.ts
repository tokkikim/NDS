import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 정적 HTML로 내보내서 Cloudflare Pages 무료 요금제에 올립니다 (결과물: out/).
  output: "export",
  images: { unoptimized: true },
  // 상위 폴더(NDS 앱)와 별개의 프로젝트임을 명시합니다.
  turbopack: { root: import.meta.dirname },
};

export default nextConfig;
