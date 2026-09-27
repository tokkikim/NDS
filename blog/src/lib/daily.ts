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

/** 하루 한 카테고리의 실천 기록 */
export type DailyEntry = {
  done: boolean;
  /** 자유 메모 */
  note?: string;
  /** 가이드에서 체크한 단계 번호 (0부터) */
  steps?: number[];
  /** 가이드의 기록 질문 → 답 */
  answers?: Record<string, string>;
};

/** 날짜 → 카테고리 → 기록 */
export type DailyLog = Record<string, Record<string, DailyEntry>>;

export function readDailyLog(): DailyLog {
  if (!fs.existsSync(DAILY_LOG_FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(DAILY_LOG_FILE, "utf8")) as DailyLog;
  } catch {
    return {};
  }
}

export function writeDailyEntry(date: string, topic: string, entry: DailyEntry): DailyLog {
  const log = readDailyLog();
  const note = entry.note?.trim();
  const steps = [...new Set((entry.steps ?? []).filter((n) => Number.isInteger(n) && n >= 0 && n < 20))].sort((a, b) => a - b);
  const answers = Object.fromEntries(
    Object.entries(entry.answers ?? {})
      .map(([q, a]) => [q.trim().slice(0, 200), String(a ?? "").trim().slice(0, 2000)])
      .filter(([q, a]) => q && a),
  );
  const hasAnswers = Object.keys(answers).length > 0;
  log[date] = { ...(log[date] ?? {}), [topic]: { done: entry.done, ...(note ? { note } : {}), ...(steps.length ? { steps } : {}), ...(hasAnswers ? { answers } : {}) } };
  if (!entry.done && !note && !steps.length && !hasAnswers) delete log[date][topic];
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
  steps: number[];
  answers: Record<string, string>;
  /** 레슨의 daily 중 몇 번째 항목인지 (가이드 항목과 맞출 때 사용) */
  index: number;
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
    const record = { done: !!entry?.done, note: entry?.note, steps: entry?.steps ?? [], answers: entry?.answers ?? {} };
    if (!next?.lesson) {
      return { topic, day: 1, days: 1, index: 0, task: "커리큘럼 레슨이 없습니다. 커리큘럼에 레슨을 추가하세요.", isPostDay: false, ...record };
    }
    const days = Math.max(1, daysBetween(blockStart, next.date) + 1);
    const day = Math.min(days, Math.max(1, daysBetween(blockStart, date) + 1));
    const daily = next.lesson.daily?.length ? next.lesson.daily : null;
    // 블록 길이가 daily 수와 다를 때(날짜 고정·여유일 등):
    // 짧으면 글 쓰는 날(마지막 항목)부터 거꾸로 맞추고, 길면 비율로 늘립니다. 마지막 날은 항상 마지막 항목입니다.
    const index = !daily ? 0 : days <= daily.length ? daily.length - days + day - 1 : Math.floor(((day - 1) * daily.length) / days);
    const itemIndex = daily ? Math.min(daily.length - 1, Math.max(0, index)) : 0;
    const task = daily ? daily[itemIndex] : next.lesson.task;
    const isPostDay = next.date === date;
    return { topic, lesson: next.lesson, postDate: next.date, day, days, index: itemIndex, task, isPostDay, post: isPostDay ? next : undefined, ...record };
  });
}

/** 한 레슨 블록 동안 남긴 실천 메모 (글 초안의 "직접 해보기" 재료) */
export function blockNotes(topicSlug: string, postDate: string, schedule: DayPlan[], log: DailyLog, startDate: string): ({ date: string } & DailyEntry)[] {
  const turns = schedule.filter((d) => d.topic?.slug === topicSlug && d.date < postDate && (d.lesson || d.post));
  const prev = turns[turns.length - 1];
  const out = [];
  for (let d = prev ? addDays(prev.date, 1) : startDate; d <= postDate; d = addDays(d, 1)) {
    const e = log[d]?.[topicSlug];
    if (e) out.push({ date: d, ...e });
  }
  return out;
}
