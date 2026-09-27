"use client";

import { useEffect } from "react";
import { ADSENSE } from "@/blog.config";

declare global {
  interface Window {
    adsbygoogle?: unknown[];
  }
}

/** 애드센스 본문 광고. 클라이언트 ID와 슬롯이 설정돼 있을 때만 표시됩니다. */
export function AdSlot() {
  useEffect(() => {
    if (!ADSENSE.client || !ADSENSE.slot) return;
    try {
      (window.adsbygoogle = window.adsbygoogle || []).push({});
    } catch {
      // 광고 차단기 등으로 실패해도 페이지는 그대로 둡니다.
    }
  }, []);

  if (!ADSENSE.client || !ADSENSE.slot) return null;
  return (
    <div className="ad-slot">
      <ins
        className="adsbygoogle"
        style={{ display: "block" }}
        data-ad-client={ADSENSE.client}
        data-ad-slot={ADSENSE.slot}
        data-ad-format="auto"
        data-full-width-responsive="true"
      />
    </div>
  );
}
