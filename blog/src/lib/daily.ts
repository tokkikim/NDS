// 매일 실천 계획과 기록.
// 글은 카테고리마다 차례가 오는 날 쓰지만, 공부·훈련은 모든 카테고리를 매일 합니다.
// 카테고리별로 "다음 레슨 글을 쓰는 날"까지의 기간이 그 레슨의 실천 블록이고,
// 블록의 날마다 레슨의 daily[i] 할 일을 합니다. 블록 마지막 날이 글 쓰는 날입니다.
import fs from "node:fs";
import path from "node:path";
import type { Topic } from "../blog.config";
import { addDays, daysBetween } from "./dates";
import type { DayPlan } from "./schedule";

export const DAILY_LOG_FILE = path.join(process.cwd(), "content", "daily-log.json");

/** 날짜 → 카테고리 → 체크 여부와 메모 */
export type DailyLog = Record<string, Record<string, { done: boolean; note?: string }>>;

export function readDailyLog(): DailyLog {
  if (!fs.existsSync(DAILY_LOG_FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(DAILY_LOG_FILE, "utf8")) as DailyLog;
  } catch {
    return {};
  }
}

export function writeDailyEntry(date: string, topic: string, entry: { done: boolean; note?: string }): DailyLog {
  const log = readDailyLog();
  const note = entry.note?.trim();
  log[date] = { ...(log[date] ?? {}), [topic]: { done: entry.done, ...(note ? { note } : {}) } };
  if (!entry.done && !note) delete log[date][topic];
  if (!Object.keys(log[date]).length) delete log[date];
  // 날짜 순으로 정렬해 저장하면 git에서 변경 내용을 보기 쉽습니다.
  const sorted = Object.fromEntries(Object.entries(log).sort(([a], [b]) => a.localeCompare(b)));
  fs.writeFileSync(DAILY_LOG_FILE, `${JSON.stringify(sorted, null, 2)}\n`);
  return sorted;
}

export type DailyTask = {
  topic: Topic;
  /** 이 블록이 향하는 레슨 (그 레슨 글을 쓰는 날까지 실천) */
  lesson?: NonNullable<DayPlan["lesson"]>;
  /** 레슨 글을 쓰는 날 */
  postDate?: string;
  /** 블록 안에서 몇째 날인지 (1부터) / 블록 길이 */
  day: number;
  days: number;
  task: string;
  isPostDay: boolean;
  /** 오늘 글 쓰는 날이면 그 날의 일정 (글 상태 포함) */
  post?: DayPlan;
  done: boolean;
  note?: string;
};

/**
 * 하루치 실천 계획. schedule은 date 이전 최소 한 차례부터 date 이후 충분히(레슨 여러 개) 뒤까지 포함해야 합니다.
 * (보통 date - 14일 ~ date + 45일)
 */
export function dailyPlan(date: string, topics: Topic[], schedule: DayPlan[], log: DailyLog, startDate: string): DailyTask[] {
  return topics.map((topic) => {
    const turns = schedule.filter((d) => d.topic?.slug === topic.slug);
    // 오늘 이후(오늘 포함) 이 카테고리 레슨 글을 쓰는 첫날
    const next = turns.find((d) => d.date >= date && d.lesson);
    // 직전에 글을 쓴(또는 쓰기로 한) 날. 놓침·여유일은 블록을 끊지 않습니다. (없으면 시작일부터)
    const prev = [...turns].reverse().find((d) => d.date < date && (d.lesson || d.post));
    const blockStart = prev ? addDays(prev.date, 1) : date < startDate ? date : startDate;
    const entry = log[date]?.[topic.slug];
    if (!next?.lesson) {
      return { topic, day: 1, days: 1, task: "커리큘럼 레슨이 없습니다. 커리큘럼에 레슨을 추가하세요.", isPostDay: false, done: !!entry?.done, note: entry?.note };
    }
    const days = Math.max(1, daysBetween(blockStart, next.date) + 1);
    const day = Math.min(days, Math.max(1, daysBetween(blockStart, date) + 1));
    const daily = next.lesson.daily?.length ? next.lesson.daily : null;
    // 블록 길이가 daily 수와 다르면(날짜 고정·여유일 등) 비율로 맞춥니다.
    const task = daily ? daily[Math.min(daily.length - 1, Math.floor(((day - 1) * daily.length) / days))] : next.lesson.task;
    const isPostDay = next.date === date;
    return { topic, lesson: next.lesson, postDate: next.date, day, days, task, isPostDay, post: isPostDay ? next : undefined, done: !!entry?.done, note: entry?.note };
  });
}

/** 한 레슨 블록 동안 남긴 실천 메모 (글 초안의 "직접 해보기" 재료) */
export function blockNotes(topicSlug: string, postDate: string, schedule: DayPlan[], log: DailyLog, startDate: string): { date: string; done: boolean; note?: string }[] {
  const turns = schedule.filter((d) => d.topic?.slug === topicSlug && d.date < postDate && (d.lesson || d.post));
  const prev = turns[turns.length - 1];
  const out = [];
  for (let d = prev ? addDays(prev.date, 1) : startDate; d <= postDate; d = addDays(d, 1)) {
    const e = log[d]?.[topicSlug];
    if (e) out.push({ date: d, done: e.done, note: e.note });
  }
  return out;
}
