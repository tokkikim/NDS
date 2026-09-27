import fs from "node:fs";
import path from "node:path";
import { ImageResponse } from "next/og";
import { SITE } from "../blog.config";

export const OG_SIZE = { width: 1200, height: 630 };

// 한글이 깨지지 않도록 저장소에 포함한 무료 폰트(Pretendard, OFL)를 씁니다.
const font = fs.readFileSync(path.join(process.cwd(), "assets", "fonts", "Pretendard-Bold.otf"));

/** 공유 미리보기용 썸네일 (카카오톡·SNS·검색 결과). 빌드할 때 PNG로 만들어집니다. */
export function renderOgImage({ title, label, color }: { title: string; label: string; color: string }) {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "72px 80px",
          background: "#fbfbfa",
          borderLeft: `24px solid ${color}`,
          fontFamily: "Pretendard",
        }}
      >
        <div style={{ display: "flex", fontSize: 34, color }}>{label}</div>
        <div style={{ display: "flex", fontSize: title.length > 30 ? 60 : 72, lineHeight: 1.3, color: "#1d1d1f" }}>
          {title}
        </div>
        <div style={{ display: "flex", fontSize: 30, color: "#6b6b70" }}>{SITE.name}</div>
      </div>
    ),
    { ...OG_SIZE, fonts: [{ name: "Pretendard", data: font, weight: 700, style: "normal" }] },
  );
}
