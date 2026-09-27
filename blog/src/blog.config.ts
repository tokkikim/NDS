// 블로그 전체 설정.
import categories from "../content/topics.json";

export type Topic = {
  /** URL과 파일에 쓰이는 영문 키 */
  slug: string;
  name: string;
  description: string;
  /** 카드·배지에 쓰이는 색 */
  color: string;
};

// 카테고리와 순환 시작일은 content/topics.json 에 있습니다 (대시보드 "카테고리" 탭에서 편집).
export const TOPICS: Topic[] = categories.topics;

export const SITE = {
  name: "매일 한 걸음 공부노트",
  description: "세 가지 주제를 하루 하나씩, 직접 공부하며 기록하는 블로그",
  // 배포 도메인. 환경변수가 없으면 로컬 주소를 씁니다.
  url: (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/$/, ""),
  author: "공부노트 운영자",
  locale: "ko_KR",
  // 매일 게시 기준 시간대
  timeZone: "Asia/Seoul",
  // 주제 로테이션 기준일: 이 날짜의 주제가 TOPICS[0]
  rotationStart: categories.startDate,
};

export const ADSENSE = {
  // 예: ca-pub-1234567890123456 (승인 전에는 비워두세요)
  client: process.env.NEXT_PUBLIC_ADSENSE_CLIENT ?? "",
  // 본문 광고 단위 슬롯 ID (없으면 자동광고만 사용)
  slot: process.env.NEXT_PUBLIC_ADSENSE_SLOT ?? "",
};

export function getTopic(slug: string): Topic | undefined {
  return TOPICS.find((t) => t.slug === slug);
}
