export const dynamic = "force-static";

import { ADSENSE } from "@/blog.config";

// 애드센스 승인 후 필요한 ads.txt. NEXT_PUBLIC_ADSENSE_CLIENT가 있으면 자동으로 채워집니다.
export function GET() {
  const pub = ADSENSE.client.replace(/^ca-/, "");
  const body = pub ? `google.com, ${pub}, DIRECT, f08c47fec0942fa0\n` : "";
  return new Response(body, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
