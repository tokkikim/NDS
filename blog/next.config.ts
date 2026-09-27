import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 상위 폴더(NDS 앱)와 별개의 프로젝트임을 명시합니다.
  turbopack: { root: import.meta.dirname },
  // 글 파일(content/)을 서버에서 읽을 수 있도록 배포 번들에 포함합니다.
  outputFileTracingIncludes: { "/**": ["./content/**/*"] },
};

export default nextConfig;
