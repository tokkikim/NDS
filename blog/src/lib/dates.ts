import { SITE, TOPICS, type Topic } from "../blog.config";

const DAY_MS = 24 * 60 * 60 * 1000;

/** 블로그 시간대 기준 오늘 날짜 (YYYY-MM-DD) */
export function todayString(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: SITE.timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function addDays(date: string, days: number): string {
  const t = Date.parse(`${date}T00:00:00Z`) + days * DAY_MS;
  return new Date(t).toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
}

/** 날짜별 주제 로테이션: 기준일부터 하루씩 TOPICS를 순환합니다. */
export function topicForDate(date: string): Topic {
  const n = daysBetween(SITE.rotationStart, date);
  return TOPICS[((n % TOPICS.length) + TOPICS.length) % TOPICS.length];
}

export function formatKoreanDate(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return `${y}년 ${m}월 ${d}일`;
}
