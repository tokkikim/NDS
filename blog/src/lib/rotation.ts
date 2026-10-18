// 카테고리 순환: 진행 중인 카테고리만 하루씩 돌아가며 글을 씁니다.
// 진행/보류나 순서를 바꾸면 그날부터 새 순환 구간이 시작되고, 지난 날의 순환은 그대로 남습니다.
import type { Topic } from "../blog.config";

// dates.ts가 이 파일을 쓰므로 순환 import를 피하려고 날짜 차이는 여기서 직접 계산합니다.
const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

/** from 날짜부터 topics(slug) 순서로 하루씩 순환 */
export type Rotation = { from: string; topics: string[] };

export type Categories = { startDate: string; topics: Topic[]; rotations?: Rotation[] };

export const activeTopics = (c: Pick<Categories, "topics">) => c.topics.filter((t) => !t.paused);

/** 순환 구간 목록 (예전 설정 파일처럼 구간이 없으면 시작일부터 지금 진행 중인 카테고리로 한 구간) */
export function rotationsOf(c: Categories): Rotation[] {
  if (c.rotations?.length) return [...c.rotations].sort((a, b) => a.from.localeCompare(b.from));
  return [{ from: c.startDate, topics: activeTopics(c).map((t) => t.slug) }];
}

/** 그날 차례인 카테고리 (시작 전이거나 진행 중인 카테고리가 없으면 null) */
export function rotationTopic(c: Categories, date: string): Topic | null {
  const segment = rotationsOf(c)
    .filter((r) => r.from <= date)
    .pop();
  if (!segment) return null;
  const topics = segment.topics.map((s) => c.topics.find((t) => t.slug === s)).filter((t): t is Topic => !!t);
  if (!topics.length) return null;
  return topics[daysBetween(segment.from, date) % topics.length];
}

/**
 * 카테고리 설정을 바꿀 때 순환 구간을 정리합니다.
 * - 시작일을 바꾸거나 아직 시작 전이면: 구간을 새로 시작 (과거가 없으므로)
 * - 진행 중 카테고리 목록·순서가 바뀌면: 오늘부터 새 구간 (지난 날은 그대로)
 */
export function nextRotations(prev: Categories, next: { startDate: string; topics: Topic[] }, today: string): Rotation[] | undefined {
  const active = activeTopics(next).map((t) => t.slug);
  if (next.startDate !== prev.startDate || today <= next.startDate) return undefined;
  const segments = rotationsOf(prev);
  const current = segments.filter((r) => r.from <= today).pop();
  if (current && current.topics.join(",") === active.join(",")) return prev.rotations;
  return [...segments.filter((r) => r.from < today), { from: today, topics: active }];
}
