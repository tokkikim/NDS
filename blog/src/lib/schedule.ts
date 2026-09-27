// 달력 일정 계산: 날짜마다 카테고리(순환)와 그날 할 레슨을 정합니다.
// - 지난 날: 실제로 쓴 글 기준 (글이 없으면 "놓침")
// - 오늘·앞으로: 아직 안 쓴 레슨을 카테고리 차례가 오는 날에 순서대로 배정
// 그래서 하루를 놓쳐도 레슨이 사라지지 않고 다음 차례로 밀립니다.
// - 날짜가 고정된 레슨(대회 당일·접수일 등)은 순환과 상관없이 그 날짜에 배정하고,
//   그날 원래 차례였던 카테고리의 레슨은 다음 차례로 밀립니다.
// - 고정 레슨보다 뒤 순서인 레슨(예: 대회 후 기록 분석)은 그 날짜 전에 당겨 쓰지 않고, 그 차례는 "여유"로 둡니다.
import type { Topic } from "../blog.config";
import { allLessons, type Curriculum, type Lesson } from "./curriculum";
import { addDays, daysBetween } from "./dates";
import type { Post } from "./posts";

export type DayStatus = "게시" | "예약" | "초안" | "오늘" | "예정" | "놓침" | "여유" | "레슨 없음" | "시작 전";

export type DayPlan = {
  date: string;
  topic: Topic | null;
  status: DayStatus;
  lesson?: Lesson & { stage: string; stageIndex: number; number: number; total: number };
  post?: { slug: string; title: string };
};

type Input = {
  startDate: string;
  topics: Topic[];
  curricula: Record<string, Curriculum | null>;
  posts: Post[];
  today: string;
  from: string;
  to: string;
};

export function topicForDateIn(startDate: string, topics: Topic[], date: string): Topic | null {
  if (!topics.length || date < startDate) return null;
  return topics[daysBetween(startDate, date) % topics.length];
}

export function buildSchedule({ startDate, topics, curricula, posts, today, from, to }: Input): DayPlan[] {
  const postByDate = new Map<string, Post>();
  for (const p of [...posts].sort((a, b) => a.slug.localeCompare(b.slug))) if (!postByDate.has(p.date)) postByDate.set(p.date, p);

  const lessonsByTopic = new Map(topics.map((t) => [t.slug, curricula[t.slug] ? allLessons(curricula[t.slug]!) : []]));
  const lessonInfo = (topic: string, id: string) => {
    const list = lessonsByTopic.get(topic) ?? [];
    const i = list.findIndex((l) => l.id === id);
    return i === -1 ? undefined : { ...list[i], number: i + 1, total: list.length };
  };

  // 이미 글로 쓴(초안 포함) 레슨은 다시 배정하지 않습니다.
  const used = new Set(posts.filter((p) => p.lesson).map((p) => `${p.topic}:${p.lesson}`));
  // 오늘 이후로 날짜가 고정된 레슨. (고정 날짜가 지났는데 못 쓴 레슨은 일반 레슨처럼 다음 차례에 배정)
  const pinned = new Map<string, { topic: Topic; id: string }>();
  for (const t of topics) {
    for (const l of lessonsByTopic.get(t.slug) ?? []) {
      if (l.date && l.date >= today && !used.has(`${t.slug}:${l.id}`) && !pinned.has(l.date)) pinned.set(l.date, { topic: t, id: l.id });
    }
  }
  const pinnedIds = new Set([...pinned.values()].map((p) => `${p.topic.slug}:${p.id}`));
  const queues = new Map(
    topics.map((t) => [
      t.slug,
      (lessonsByTopic.get(t.slug) ?? []).filter((l) => !used.has(`${t.slug}:${l.id}`) && !pinnedIds.has(`${t.slug}:${l.id}`)),
    ]),
  );

  const days: DayPlan[] = [];
  const first = from < startDate ? from : startDate;
  for (let date = first; date <= to; date = addDays(date, 1)) {
    const post = postByDate.get(date);
    const rotation = topicForDateIn(startDate, topics, date);
    let plan: DayPlan;

    if (post) {
      const topic = topics.find((t) => t.slug === post.topic) ?? rotation;
      const status: DayStatus = post.draft ? "초안" : post.date > today ? "예약" : "게시";
      plan = { date, topic, status, post: { slug: post.slug, title: post.title }, lesson: post.lesson ? lessonInfo(post.topic, post.lesson) : undefined };
    } else if (!rotation) {
      plan = { date, topic: null, status: "시작 전" };
    } else if (pinned.has(date) && date >= today) {
      const pin = pinned.get(date)!;
      plan = { date, topic: pin.topic, status: date === today ? "오늘" : "예정", lesson: lessonInfo(pin.topic.slug, pin.id) };
    } else if (date < today) {
      plan = { date, topic: rotation, status: "놓침" };
    } else {
      const queue = queues.get(rotation.slug) ?? [];
      const peek = queue[0];
      const order = (id: string) => (lessonsByTopic.get(rotation.slug) ?? []).findIndex((l) => l.id === id);
      const waiting =
        peek &&
        [...pinned.entries()].some(([pinDate, pin]) => pin.topic.slug === rotation.slug && pinDate > date && order(pin.id) < order(peek.id));
      const next = waiting ? undefined : queue.shift();
      plan = waiting
        ? { date, topic: rotation, status: "여유" }
        : next
        ? { date, topic: rotation, status: date === today ? "오늘" : "예정", lesson: lessonInfo(rotation.slug, next.id) }
        : { date, topic: rotation, status: "레슨 없음" };
    }
    if (date >= from) days.push(plan);
  }
  return days;
}

/** 특정 날짜·카테고리에 쓸 레슨. 달력에 배정된 레슨을 우선하고, 없으면 아직 안 쓴 첫 레슨. */
export function lessonForDate(input: Omit<Input, "from" | "to">, date: string, topicSlug: string): DayPlan["lesson"] {
  const day = buildSchedule({ ...input, from: date, to: date })[0];
  if (day?.topic?.slug === topicSlug && day.lesson && !day.post) return day.lesson;
  const c = input.curricula[topicSlug];
  if (!c) return undefined;
  const used = new Set(input.posts.filter((p) => p.topic === topicSlug && p.lesson).map((p) => p.lesson));
  const list = allLessons(c);
  const i = list.findIndex((l) => !used.has(l.id));
  return i === -1 ? undefined : { ...list[i], number: i + 1, total: list.length };
}

/** 앞으로 며칠 동안 달력이 어디까지 채워져 있는지 (커리큘럼 보충 알림용) */
export function daysUntilEmpty(days: DayPlan[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const d of days) {
    if (!d.topic || d.status !== "레슨 없음" || out[d.topic.slug] !== undefined) continue;
    out[d.topic.slug] = daysBetween(days[0].date, d.date);
  }
  return out;
}
