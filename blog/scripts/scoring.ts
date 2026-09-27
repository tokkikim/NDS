// 시장 분석 점수 기준. 가중치를 바꾸면 비교표 순위가 바뀝니다.
export const CRITERIA = [
  { key: "demand", name: "검색 수요", weight: 0.25, guide: "5 = 핵심 키워드 합계 월 10만+ & 유지/성장, 1 = 월 5천 미만 또는 뚜렷한 하락" },
  { key: "competition", name: "경쟁 여유", weight: 0.2, guide: "5 = 상위 결과에 개인 블로그·오래된 글이 많음, 1 = 공식기관·대형매체·대형 블로거가 장악" },
  { key: "monetization", name: "수익성", weight: 0.2, guide: "5 = 광고 입찰가 높고 제휴 상품 풍부, 1 = 광고 단가 낮고 팔 것이 없음" },
  { key: "aiResistance", name: "AI 대체 내성", weight: 0.15, guide: "5 = 직접 경험·실습·최신 정보가 핵심, 1 = AI 한 줄 답변으로 끝나는 질문 위주" },
  { key: "breadth", name: "확장성", weight: 0.1, guide: "5 = 하위 소재 100개 이상 쉽게 나옴, 1 = 20개 안팎에서 고갈" },
  { key: "fit", name: "운영자 적합성", weight: 0.1, guide: "5 = 프로필상 직접 해볼 수 있고 관심이 지속됨, 1 = 경험 불가·관심 낮음 (프로필 미작성이면 3)" },
] as const;

export type CriterionKey = (typeof CRITERIA)[number]["key"];

export type ResearchResult = {
  topic: string;
  date: string;
  dataMode: "naver" | "estimate";
  summary: string;
  scores: Record<CriterionKey, { score: number; reason: string }>;
  keywords: { keyword: string; monthly: number | null; competition: string | null; intent: string }[];
  trend: string;
  audienceQuestions: string[];
  firstTopics: string[];
  monetizationIdeas: string[];
  risks: string[];
};

/** 100점 만점 종합 점수 */
export function totalScore(r: ResearchResult): number {
  return Math.round(CRITERIA.reduce((sum, c) => sum + r.scores[c.key].score * c.weight, 0) * 20);
}

export function verdict(total: number): "GO" | "보류" | "제외" {
  return total >= 70 ? "GO" : total >= 55 ? "보류" : "제외";
}

/** Claude가 쓴 JSON이 약속한 형식인지 검사합니다. 문제 목록을 반환합니다. */
export function validateResearch(r: unknown): string[] {
  const errors: string[] = [];
  const o = r as Partial<ResearchResult>;
  if (!o || typeof o !== "object") return ["JSON 객체가 아닙니다"];
  if (!o.topic) errors.push("topic 없음");
  if (o.dataMode !== "naver" && o.dataMode !== "estimate") errors.push("dataMode는 naver 또는 estimate");
  for (const c of CRITERIA) {
    const s = o.scores?.[c.key];
    if (!s || !Number.isInteger(s.score) || s.score < 1 || s.score > 5) errors.push(`scores.${c.key}.score는 1~5 정수`);
  }
  for (const key of ["keywords", "audienceQuestions", "firstTopics", "monetizationIdeas", "risks"] as const) {
    if (!Array.isArray(o[key])) errors.push(`${key}는 배열이어야 합니다`);
  }
  return errors;
}
