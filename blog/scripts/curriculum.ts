// 카테고리 커리큘럼(단계 → 레슨)을 Claude CLI로 설계합니다.
//   npm run curriculum -- --topic marathon               # 새로 만들기 (레슨 30개)
//   npm run curriculum -- --topic marathon --lessons 45
//   npm run curriculum -- --topic marathon --append 15   # 기존 뒤에 레슨 15개 이어서 추가
//   npm run curriculum -- --topic marathon --event "2027 대구마라톤" --event-date 2027-02-28 --registration 2026-10-12
//     → 목표 대회에 맞춰 레슨 수를 계산하고, 접수일·대회 당일 레슨을 그 날짜에 고정합니다.
//   npm run curriculum -- --topic marathon --daily        # 레슨은 그대로 두고 레슨별 매일 할 일만 채우기
// 이미 글로 쓴 레슨은 다시 만들 때도 그대로 보존됩니다.
import fs from "node:fs";
import path from "node:path";
import { getTopic, SITE, TOPICS } from "../src/blog.config";
import { allLessons, curriculumPath, readCurriculum, writeCurriculum, type Curriculum } from "../src/lib/curriculum";
import { addDays, todayString } from "../src/lib/dates";
import { topicForDateIn } from "../src/lib/schedule";
import { getAllPostFiles, parsePostFile } from "../src/lib/posts";
import { editRule, ensureClaudeCli, loadPrompt, NAVER_TOOL, runClaude } from "./claude";
import { fail, parseArgs } from "./lib";

const args = parseArgs();
const fillDaily = args.daily !== undefined;
const topic = args.topic ? getTopic(args.topic) : undefined;
if (!topic) fail(`--topic을 지정하세요 (가능: ${TOPICS.map((t) => t.slug).join(", ")})`);
ensureClaudeCli();

const file = curriculumPath(topic.slug);
const relFile = path.relative(process.cwd(), file).split(path.sep).join("/");
const existing = readCurriculum(topic.slug);
const append = args.append !== undefined;
let count = Number(append ? args.append : (args.lessons ?? 30)) || 30;
const existingCount = existing ? allLessons(existing).length : 0;

// 목표 대회: 인자로 주면 새로 설정, 없으면 기존 커리큘럼의 것을 씁니다.
const event = args["event-date"]
  ? {
      name: args.event ?? "목표 대회",
      date: args["event-date"],
      ...(args.registration ? { registrationDate: args.registration } : {}),
      ...(args["event-url"] ? { url: args["event-url"] } : {}),
    }
  : existing?.event;
// 대회가 있으면: 오늘(또는 시작일)부터 대회 전날까지 이 카테고리 차례 수 + 대회 당일 + 대회 후 회복·분석 4개
const from = todayString() > SITE.rotationStart ? todayString() : SITE.rotationStart;
let turnsBeforeEvent = 0;
if (event) for (let d = from; d < event.date; d = addDays(d, 1)) if (topicForDateIn(SITE.rotationStart, TOPICS, d)?.slug === topic.slug) turnsBeforeEvent++;
if (event && !append && args.lessons === undefined) count = turnsBeforeEvent + 1 + 4;

// 글로 이미 쓴 레슨 id (초안 포함) — 다시 만들 때 반드시 남아 있어야 합니다.
const usedIds = getAllPostFiles()
  .map(parsePostFile)
  .filter((p) => p.topic === topic.slug && p.lesson)
  .map((p) => p.lesson!);

const researchDir = path.join(process.cwd(), "research");
const reports = fs.existsSync(researchDir)
  ? fs
      .readdirSync(researchDir)
      .filter((f) => f.endsWith(".md") && f !== "profile.md" && !f.includes("비교"))
      .map((f) => `research/${f}`)
  : [];

if (fillDaily && !existing) fail("매일 할 일을 채우려면 먼저 커리큘럼이 있어야 합니다.");

const keepRule = append
  ? `기존 단계와 레슨은 한 글자도 바꾸지 말고 그대로 두세요. 그 뒤에 새 레슨 ${count}개를 이어서 추가하세요 (기존 마지막 단계에 이어 붙이거나 새 단계를 만드세요).`
  : usedIds.length
    ? `이미 글로 쓴 레슨(id: ${usedIds.join(", ")})은 id·제목·할 일을 그대로 두고 커리큘럼 앞쪽에 유지하세요. 나머지는 새로 설계해도 됩니다.`
    : "처음부터 새로 설계하세요. 모든 레슨의 id는 빈 문자열로 두세요.";

const prompt = fillDaily
  ? loadPrompt("daily", {
      topicName: topic.name,
      topicDescription: topic.description,
      file: relFile,
      cadence: String(TOPICS.length),
      last: String(TOPICS.length - 1),
      others: String(TOPICS.length - 1),
    })
  : loadPrompt("curriculum", {
  topicName: topic.name,
  topicDescription: topic.description,
  topicSlug: topic.slug,
  file: relFile,
  mode: append ? `기존 커리큘럼 뒤에 레슨 ${count}개 추가` : existing ? "커리큘럼 다시 설계" : "커리큘럼 새로 만들기",
  date: todayString(),
  topicCount: String(TOPICS.length),
  cadence: String(TOPICS.length),
  research: reports.length ? reports.join(", ") : "(없음)",
  existing: existing ? JSON.stringify(existing, null, 1) : "(없음)",
  lessonCount: append ? `기존 레슨 뒤에 ${count}개 추가` : `총 ${count}개 안팎`,
  duration: append
    ? `기존 레슨 ${existingCount}개(약 ${existingCount * TOPICS.length}일) 뒤에 이어서 ${count}개 × ${TOPICS.length}일 = 약 ${count * TOPICS.length}일(${Math.round((count * TOPICS.length) / 7)}주)을 추가합니다. 새 레슨은 시작 후 ${existingCount * TOPICS.length}일째부터입니다.`
    : `레슨 ${count}개 × ${TOPICS.length}일 = 전체 약 ${count * TOPICS.length}일(약 ${Math.round((count * TOPICS.length) / 7)}주, ${Math.round((count * TOPICS.length) / 30)}개월)입니다.`,
  keepRule,
  event: event
    ? [
        `- 목표 대회: ${event.name} — ${event.date}${event.url ? ` (${event.url})` : ""}`,
        event.registrationDate ? `- 접수 시작: ${event.registrationDate}` : "",
        `- 대회 전까지 이 카테고리 차례는 약 ${turnsBeforeEvent}번 (${from} 기준)입니다.`,
        "- 대회 당일 레슨에는 \"date\": \"" + event.date + "\" 를 넣어 그 날짜에 고정하세요.",
        event.registrationDate ? "- 접수 시작일 레슨(대회 고르기·접수 방법·접수 후기)에는 \"date\": \"" + event.registrationDate + "\" 를 넣어 고정하세요." : "",
        "- 대회 전 레슨은 대회 날짜에서 거꾸로 계산해 훈련 주기(기초 → 강화 → 테이퍼링)를 맞추고, 대회 후에는 회복·기록 분석·다음 목표 레슨 4개를 두세요.",
        "- 커리큘럼 JSON 최상위에 \"event\" 필드를 위 정보 그대로 넣으세요.",
      ]
        .filter(Boolean)
        .join("\n")
    : "(없음 — 날짜가 정해진 목표가 있다면 그 날짜를 향하도록 설계하는 것이 좋습니다)",
});

const backup = existing ? fs.readFileSync(file, "utf8") : null;
const restore = (reason: string): never => {
  if (backup) fs.writeFileSync(file, backup);
  else fs.rmSync(file, { force: true });
  return fail(`${reason} (이전 커리큘럼으로 되돌렸습니다)`);
};

console.log(`… ${topic.name} 커리큘럼 ${fillDaily ? "매일 할 일 채우기" : append ? `레슨 ${count}개 추가` : "설계"} 중 (몇 분 걸릴 수 있어요)`);
runClaude(prompt, {
  allowedTools: fillDaily ? ["Read", editRule(file)] : ["WebSearch", "WebFetch", "Read", "Glob", "Grep", NAVER_TOOL, editRule(file)],
  model: args.model,
  inheritOutput: true,
}).then(({ code }) => {
  if (code !== 0) restore(`claude 실행이 실패했습니다 (종료 코드 ${code})`);
  if (!fs.existsSync(file)) restore("커리큘럼 파일이 만들어지지 않았습니다");
  // 파일 쓰기가 막히면 Claude는 결과를 답변으로만 보여주고 끝납니다. 기존 파일을 성공으로 착각하지 않게 막습니다.
  if (backup !== null && fs.readFileSync(file, "utf8") === backup) restore("Claude가 커리큘럼 파일을 고치지 못했습니다 (파일 쓰기 권한 거부 등, 위 로그의 ⚠ 실패 확인)");

  let data: Curriculum;
  try {
    data = JSON.parse(fs.readFileSync(file, "utf8")) as Curriculum;
  } catch {
    return restore("커리큘럼 JSON을 읽을 수 없습니다");
  }
  let saved: Curriculum;
  try {
    // 목표 대회 정보는 AI가 빠뜨려도 유지합니다.
    saved = writeCurriculum(topic.slug, { ...data, topic: topic.slug, ...(event ? { event: { ...event, ...(data.event ?? {}), date: event.date } } : {}) });
  } catch (err) {
    return restore(`형식 오류: ${(err as Error).message}`);
  }
  const ids = new Set(allLessons(saved).map((l) => l.id));
  const lost = usedIds.filter((id) => !ids.has(id));
  if (lost.length) restore(`이미 글로 쓴 레슨이 사라졌습니다: ${lost.join(", ")}`);
  if (fillDaily) {
    // daily만 추가하고 나머지는 그대로여야 합니다.
    const before = allLessons(existing!).map((l) => `${l.id}|${l.title}|${l.task}|${l.date ?? ""}`).join("\n");
    const after = allLessons(saved).map((l) => `${l.id}|${l.title}|${l.task}|${l.date ?? ""}`).join("\n");
    if (before !== after) restore("매일 할 일을 채우는 중에 레슨 내용이 바뀌었습니다");
    const missing = allLessons(saved).filter((l) => (l.daily?.length ?? 0) !== TOPICS.length).length;
    if (missing) console.log(`  ⚠ daily가 ${TOPICS.length}개가 아닌 레슨 ${missing}개 — 커리큘럼 탭에서 확인하세요`);
  }

  const total = allLessons(saved).length;
  console.log(`\n✔ ${relFile}: ${saved.stages.length}단계 · 레슨 ${total}개 (약 ${total * TOPICS.length}일 분량)`);
  console.log(`  목표: ${saved.goal}`);
});
