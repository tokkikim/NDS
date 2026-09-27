// 매일 할 일의 "처음 해보는 사람용" 상세 가이드.
// 레슨 하나에 파일 하나: content/guides/<카테고리>/<레슨 id>.json
// items[i]는 레슨의 daily[i](daily가 없으면 레슨 task) 하나에 대응합니다.
// 가이드 단계는 운영자가 매일 따라 하는 체크리스트이자, 글의 "따라 해보기" 섹션(독자용 방법)의 뼈대가 됩니다.
import fs from "node:fs";
import path from "node:path";

export const GUIDES_DIR = path.join(process.cwd(), "content", "guides");

export type GuideStep = { title: string; detail: string };

export type GuideItem = {
  /** 이 가이드를 만들 때의 할 일 문장. 커리큘럼이 바뀌면 달라져서 "오래된 가이드"로 표시합니다. */
  task: string;
  /** 오늘 이걸 왜 하는지 한두 문장 */
  why: string;
  /** 예상 소요 시간(분) */
  minutes: number;
  /** 준비물·사전 준비 */
  prepare: string[];
  /** 순서대로 따라 할 단계 (체크리스트) */
  steps: GuideStep[];
  /** 처음 하는 사람이 흔히 하는 실수·주의할 점 (안전 포함) */
  pitfalls: string[];
  /** 이 정도면 오늘은 완료 */
  doneWhen: string;
  /** 해보면서 기록할 질문 — 답이 글의 "직접 해보기" 재료가 됩니다 */
  record: string[];
  sources: { title: string; url: string }[];
};

export type Guide = {
  topic: string;
  lessonId: string;
  lessonTitle: string;
  createdAt: string;
  items: GuideItem[];
};

export function guidePath(topic: string, lessonId: string): string {
  if (!/^[a-z0-9-]+$/.test(topic) || !/^[A-Za-z0-9_-]+$/.test(lessonId)) throw new Error("잘못된 가이드 이름입니다");
  return path.join(GUIDES_DIR, topic, `${lessonId}.json`);
}

export function readGuide(topic: string, lessonId: string): Guide | null {
  const file = guidePath(topic, lessonId);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as Guide;
  } catch {
    return null;
  }
}

const str = (v: unknown, max = 400) => String(v ?? "").trim().slice(0, max);
const strList = (v: unknown, n: number, max = 300) => (Array.isArray(v) ? v.map((x) => str(x, max)).filter(Boolean).slice(0, n) : []);

/** AI가 만든 가이드 항목을 검사하고 정리합니다. 쓸 수 없으면 오류를 던집니다. */
export function normalizeGuideItem(raw: unknown, task: string): GuideItem {
  const r = (raw ?? {}) as Record<string, unknown>;
  const steps = (Array.isArray(r.steps) ? r.steps : [])
    .map((s) => (typeof s === "string" ? { title: str(s, 120), detail: "" } : { title: str((s as GuideStep)?.title, 120), detail: str((s as GuideStep)?.detail, 600) }))
    .filter((s) => s.title)
    .slice(0, 8);
  if (steps.length < 2) throw new Error(`단계가 너무 적습니다: ${task}`);
  const minutes = Math.round(Number(r.minutes));
  return {
    task,
    why: str(r.why, 300),
    minutes: Number.isFinite(minutes) && minutes > 0 ? Math.min(240, minutes) : 30,
    prepare: strList(r.prepare, 6),
    steps,
    pitfalls: strList(r.pitfalls, 5),
    doneWhen: str(r.doneWhen, 200),
    record: strList(r.record, 4, 120),
    sources: (Array.isArray(r.sources) ? r.sources : [])
      .map((s) => ({ title: str((s as { title?: string })?.title, 120), url: str((s as { url?: string })?.url, 500) }))
      .filter((s) => s.title && /^https?:\/\//.test(s.url))
      .slice(0, 4),
  };
}

export function writeGuide(guide: Guide): Guide {
  const file = guidePath(guide.topic, guide.lessonId);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(guide, null, 2)}\n`);
  return guide;
}

/** 할 일 문장에 맞는 가이드 항목. 같은 문장이 없으면 같은 순서의 항목을 "오래됨"으로 돌려줍니다. */
export function guideItemFor(guide: Guide | null, index: number, task: string): { item: GuideItem; stale: boolean } | null {
  if (!guide) return null;
  const exact = guide.items.find((i) => i.task === task);
  if (exact) return { item: exact, stale: false };
  const byIndex = guide.items[index];
  return byIndex ? { item: byIndex, stale: true } : null;
}
