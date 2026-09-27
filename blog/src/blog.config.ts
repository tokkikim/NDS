// 블로그 전체 설정. 주제·사이트 정보는 여기만 바꾸면 됩니다.

export type Topic = {
  /** URL과 파일에 쓰이는 영문 키 */
  slug: string;
  name: string;
  description: string;
  /** 카드·배지에 쓰이는 색 */
  color: string;
};

export const TOPICS: Topic[] = [
  {
    slug: "ai",
    name: "AI 활용 공부",
    description: "매일 하나씩 AI 도구와 자동화를 직접 써보고 기록합니다.",
    color: "#6d5dfc",
  },
  {
    slug: "money",
    name: "경제·재테크 공부",
    description: "경제 개념과 재테크 제도를 공부하고 내 상황에 적용해 봅니다.",
    color: "#0f9d74",
  },
  {
    slug: "english",
    name: "영어 공부",
    description: "실제로 써먹을 표현을 매일 하나씩 익히고 예문을 만듭니다.",
    color: "#e0703a",
  },
];

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
  rotationStart: "2026-01-01",
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
