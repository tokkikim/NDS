// 매일 할 일의 상세 가이드를 Claude CLI로 만듭니다 (레슨 하나 = 가이드 파일 하나).
// Claude는 결과 JSON을 답변으로만 돌려주고, 파일은 이 스크립트가 검사한 뒤 저장합니다.
//   npm run guide -- --topic marathon --lesson marathon-001
//   npm run guide -- --date 2026-09-28            # 그날 모든 카테고리 레슨 중 가이드가 없거나 오래된 것
//   npm run guide -- --date 2026-09-28 --force    # 있어도 다시 만들기
//   npm run guide -- --date 2026-09-28 --only marathon-003,english-002   # 그날 레슨 중 이것만
import fs from "node:fs";
import path from "node:path";
import { SITE, TOPICS, type Topic } from "../src/blog.config";
import { readCurriculum, type Curriculum, type Lesson } from "../src/lib/curriculum";
import { dailyPlan, readDailyLog } from "../src/lib/daily";
import { addDays, todayString } from "../src/lib/dates";
import { normalizeGuideItem, readGuide, writeGuide, type Guide } from "../src/lib/guide";
import { getAllPostFiles, parsePostFile } from "../src/lib/posts";
import { buildSchedule } from "../src/lib/schedule";
import { ensureClaudeCli, loadPrompt, runClaude, runWithLimit } from "./claude";
import { fail, parseArgs } from "./lib";

type Target = { topic: Topic; curriculum: Curriculum; lesson: Lesson; stage: string; number: number; total: number };

const args = parseArgs();
const force = args.force !== undefined;

function findLesson(topic: Topic, lessonId: string): Target | null {
  const curriculum = readCurriculum(topic.slug);
  if (!curriculum) return null;
  const total = curriculum.stages.reduce((n, s) => n + s.lessons.length, 0);
  let number = 0;
  for (const stage of curriculum.stages) {
    for (const lesson of stage.lessons) {
      number++;
      if (lesson.id === lessonId) return { topic, curriculum, lesson, stage: stage.title, number, total };
    }
  }
  return null;
}

/** 가이드를 만들 할 일 목록 (daily가 없으면 레슨 task 하나) */
const tasksOf = (lesson: Lesson) => (lesson.daily?.length ? lesson.daily : [lesson.task]);

/** 가이드가 없거나, 커리큘럼이 바뀌어 할 일 문장과 맞지 않으면 새로 만들어야 합니다. */
function needsGuide(t: Target): boolean {
  if (force) return true;
  const guide = readGuide(t.topic.slug, t.lesson.id);
  if (!guide) return true;
  const tasks = tasksOf(t.lesson);
  return tasks.length !== guide.items.length || tasks.some((task, i) => guide.items[i]?.task !== task);
}

let targets: Target[] = [];
if (args.lesson) {
  const topic = TOPICS.find((t) => t.slug === args.topic);
  if (!topic) fail(`--topic을 지정하세요 (가능: ${TOPICS.map((t) => t.slug).join(", ")})`);
  const t = findLesson(topic, args.lesson);
  if (!t) fail(`레슨을 찾을 수 없습니다: ${args.lesson}`);
  targets = [t];
} else {
  const date = args.date ?? todayString();
  const curricula = Object.fromEntries(TOPICS.map((t) => [t.slug, readCurriculum(t.slug)]));
  const posts = getAllPostFiles().map(parsePostFile);
  const schedule = buildSchedule({ startDate: SITE.rotationStart, topics: TOPICS, curricula, posts, today: todayString(), from: addDays(date, -21), to: addDays(date, 60) });
  const topics = args.topic ? TOPICS.filter((t) => t.slug === args.topic) : TOPICS;
  targets = dailyPlan(date, topics, schedule, readDailyLog(), SITE.rotationStart)
    .map((d) => (d.lesson ? findLesson(d.topic, d.lesson.id) : null))
    .filter((t): t is Target => !!t);
}

// 대시보드는 이미 만드는 중인 레슨을 빼고 넘깁니다.
const only = args.only ? new Set(args.only.split(",")) : null;
const todo = targets.filter((t) => (!only || only.has(t.lesson.id)) && (only ? true : needsGuide(t)));
if (!todo.length) {
  console.log("✔ 만들 가이드가 없습니다 (모두 최신입니다). 다시 만들려면 --force");
  process.exit(0);
}
ensureClaudeCli();

// 프로필은 프롬프트에 바로 넣습니다 (Claude가 파일을 찾느라 시간을 쓰지 않도록).
const profileFile = path.join(process.cwd(), "research", "profile.md");
const profile = fs.existsSync(profileFile) ? fs.readFileSync(profileFile, "utf8").trim() : "(프로필 없음)";

/** 답변에서 JSON 객체만 꺼냅니다 (코드블록·앞뒤 설명이 붙어도 동작). */
function extractJson(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("답변에 JSON이 없습니다");
  return JSON.parse(text.slice(start, end + 1));
}

async function generate(t: Target): Promise<boolean> {
  const tasks = tasksOf(t.lesson);
  const event = t.curriculum.event;
  const prompt = loadPrompt("guide", {
    topicName: t.topic.name,
    topicDescription: t.topic.description,
    goal: t.curriculum.goal ?? "",
    stage: t.stage,
    number: String(t.number),
    total: String(t.total),
    lessonTitle: t.lesson.title,
    lessonTask: t.lesson.task,
    keywords: t.lesson.keywords.join(", ") || "(없음)",
    event: event ? `- 목표 대회: ${event.name} (${event.date})${t.lesson.date ? ` · 이 레슨은 ${t.lesson.date}에 고정` : ""}` : "",
    items: tasks.map((task, i) => `${i + 1}. (${i + 1}일차${i === tasks.length - 1 ? " · 글 쓰는 날" : ""}) ${task}`).join("\n"),
    year: todayString().slice(0, 4),
    profile,
  });
  console.log(`… ${t.topic.name} · 레슨 ${t.number} "${t.lesson.title}" 가이드 ${tasks.length}개 작성 중`);
  const { code, output } = await runClaude(prompt, { allowedTools: ["WebSearch", "WebFetch"], model: args.model });
  if (code !== 0) {
    console.log(`  ✖ ${t.lesson.id}: claude 실행 실패 (종료 코드 ${code}) ${output.slice(0, 200)}`);
    return false;
  }
  try {
    const raw = extractJson(output) as { items?: unknown[] };
    const items = Array.isArray(raw.items) ? raw.items : [];
    if (items.length !== tasks.length) throw new Error(`가이드 수(${items.length})가 할 일 수(${tasks.length})와 다릅니다`);
    const guide: Guide = {
      topic: t.topic.slug,
      lessonId: t.lesson.id,
      lessonTitle: t.lesson.title,
      createdAt: todayString(),
      items: tasks.map((task, i) => normalizeGuideItem(items[i], task)),
    };
    writeGuide(guide);
    console.log(`  ✔ ${t.lesson.id}: 가이드 ${guide.items.length}개 저장 (단계 ${guide.items.map((g) => g.steps.length).join("·")})`);
    return true;
  } catch (err) {
    console.log(`  ✖ ${t.lesson.id}: ${(err as Error).message}`);
    return false;
  }
}

runWithLimit(todo, 2, generate).then((results) => {
  const ok = results.filter(Boolean).length;
  console.log(`\n${ok === results.length ? "✔" : "⚠"} 가이드 ${ok}/${results.length}개 레슨 완료`);
  if (ok < results.length) process.exit(1);
});
