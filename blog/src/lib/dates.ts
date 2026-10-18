import { ACTIVE_TOPICS, CATEGORIES, SITE, TOPICS, type Topic } from "../blog.config";
import { rotationTopic } from "./rotation";

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

/** 그날 차례인 카테고리 (진행 중인 카테고리 순환. 시작 전이면 첫 진행 카테고리) */
export function topicForDate(date: string): Topic {
  return rotationTopic(CATEGORIES, date) ?? ACTIVE_TOPICS[0] ?? TOPICS[0];
}

export function formatKoreanDate(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return `${y}년 ${m}월 ${d}일`;
}
