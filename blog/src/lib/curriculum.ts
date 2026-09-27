// 카테고리별 커리큘럼: 단계(stage) → 레슨(lesson) 순서가 정해진 학습 계획.
// content/curriculum/<카테고리 slug>.json 에 저장되며, 달력은 이 순서대로 날짜에 레슨을 배정합니다.
import fs from "node:fs";
import path from "node:path";

export const CURRICULUM_DIR = path.join(process.cwd(), "content", "curriculum");

export type Lesson = {
  /** 글과 연결하는 고유 id (순서를 바꿔도 유지됨) */
  id: string;
  /** 글 제목 후보 (검색에 걸리는 구체적인 제목) */
  title: string;
  /** 이번 차례에 실제로 할 일. 다음 차례(보통 3일 뒤)까지 실천할 분량 */
  task: string;
  /** 제목·본문에 넣을 검색 키워드 (검색량 메모 포함 가능) */
  keywords: string[];
};

export type Stage = { title: string; goal: string; lessons: Lesson[] };

export type Curriculum = {
  topic: string;
  /** 커리큘럼 전체 목표 (예: 6개월 뒤 하프마라톤 완주) */
  goal: string;
  /** 출발 수준 (예: 달리기 경험 없음) */
  level: string;
  stages: Stage[];
};

export function curriculumPath(slug: string): string {
  return path.join(CURRICULUM_DIR, `${slug}.json`);
}

export function readCurriculum(slug: string): Curriculum | null {
  const file = curriculumPath(slug);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as Curriculum;
  } catch {
    // AI가 파일을 쓰는 도중이거나 손으로 고치다 깨진 경우: 커리큘럼 없음으로 취급합니다.
    console.warn(`⚠ 커리큘럼 파일을 읽을 수 없습니다: ${file}`);
    return null;
  }
}

/** 형식을 검사하고, id가 없거나 겹치는 레슨에 새 id를 붙여 저장합니다. */
export function writeCurriculum(slug: string, c: Curriculum): Curriculum {
  const errors = validateCurriculum(c);
  if (errors.length) throw new Error(errors.join(", "));
  const normalized = normalizeIds(slug, c);
  fs.mkdirSync(CURRICULUM_DIR, { recursive: true });
  fs.writeFileSync(curriculumPath(slug), `${JSON.stringify(normalized, null, 2)}\n`);
  return normalized;
}

export function validateCurriculum(c: unknown): string[] {
  const o = c as Partial<Curriculum>;
  if (!o || typeof o !== "object") return ["커리큘럼이 객체가 아닙니다"];
  const errors: string[] = [];
  if (!Array.isArray(o.stages)) return ["stages가 배열이 아닙니다"];
  o.stages.forEach((s, i) => {
    if (!s?.title?.trim()) errors.push(`${i + 1}단계 제목이 비어 있습니다`);
    if (!Array.isArray(s?.lessons)) return errors.push(`${i + 1}단계 lessons가 배열이 아닙니다`);
    s.lessons.forEach((l, j) => {
      if (!l?.title?.trim()) errors.push(`${i + 1}단계 ${j + 1}번 레슨 제목이 비어 있습니다`);
      if (!l?.task?.trim()) errors.push(`${i + 1}단계 ${j + 1}번 레슨의 할 일이 비어 있습니다`);
    });
  });
  return errors;
}

function normalizeIds(slug: string, c: Curriculum): Curriculum {
  const seen = new Set<string>();
  const nums = allLessons(c)
    .map((l) => Number(l.id?.match(new RegExp(`^${slug}-(\\d+)$`))?.[1]))
    .filter((n) => Number.isFinite(n));
  let next = (nums.length ? Math.max(...nums) : 0) + 1;
  return {
    topic: c.topic ?? slug,
    goal: c.goal ?? "",
    level: c.level ?? "",
    stages: c.stages.map((s) => ({
      title: s.title.trim(),
      goal: (s.goal ?? "").trim(),
      lessons: s.lessons.map((l) => {
        let id = l.id?.trim();
        if (!id || seen.has(id)) id = `${slug}-${String(next++).padStart(3, "0")}`;
        seen.add(id);
        return {
          id,
          title: l.title.trim(),
          task: l.task.trim(),
          keywords: Array.isArray(l.keywords) ? l.keywords.map(String).filter(Boolean) : [],
        };
      }),
    })),
  };
}

/** 모든 레슨을 순서대로 (단계 정보 포함) */
export function allLessons(c: Curriculum): (Lesson & { stage: string; stageIndex: number })[] {
  return c.stages.flatMap((s, i) => s.lessons.map((l) => ({ ...l, stage: s.title, stageIndex: i })));
}
