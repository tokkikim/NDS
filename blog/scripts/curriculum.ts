// 카테고리 커리큘럼(단계 → 레슨)을 Claude CLI로 설계합니다.
//   npm run curriculum -- --topic marathon               # 새로 만들기 (레슨 30개)
//   npm run curriculum -- --topic marathon --lessons 45
//   npm run curriculum -- --topic marathon --append 15   # 기존 뒤에 레슨 15개 이어서 추가
// 이미 글로 쓴 레슨은 다시 만들 때도 그대로 보존됩니다.
import fs from "node:fs";
import path from "node:path";
import { getTopic, TOPICS } from "../src/blog.config";
import { allLessons, curriculumPath, readCurriculum, writeCurriculum, type Curriculum } from "../src/lib/curriculum";
import { todayString } from "../src/lib/dates";
import { getAllPostFiles, parsePostFile } from "../src/lib/posts";
import { ensureClaudeCli, loadPrompt, NAVER_TOOL, runClaude } from "./claude";
import { fail, parseArgs } from "./lib";

const args = parseArgs();
const topic = args.topic ? getTopic(args.topic) : undefined;
if (!topic) fail(`--topic을 지정하세요 (가능: ${TOPICS.map((t) => t.slug).join(", ")})`);
ensureClaudeCli();

const file = curriculumPath(topic.slug);
const relFile = path.relative(process.cwd(), file);
const existing = readCurriculum(topic.slug);
const append = args.append !== undefined;
const count = Number(append ? args.append : (args.lessons ?? 30)) || 30;
const existingCount = existing ? allLessons(existing).length : 0;

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

const keepRule = append
  ? `기존 단계와 레슨은 한 글자도 바꾸지 말고 그대로 두세요. 그 뒤에 새 레슨 ${count}개를 이어서 추가하세요 (기존 마지막 단계에 이어 붙이거나 새 단계를 만드세요).`
  : usedIds.length
    ? `이미 글로 쓴 레슨(id: ${usedIds.join(", ")})은 id·제목·할 일을 그대로 두고 커리큘럼 앞쪽에 유지하세요. 나머지는 새로 설계해도 됩니다.`
    : "처음부터 새로 설계하세요. 모든 레슨의 id는 빈 문자열로 두세요.";

const prompt = loadPrompt("curriculum", {
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
});

const backup = existing ? fs.readFileSync(file, "utf8") : null;
const restore = (reason: string): never => {
  if (backup) fs.writeFileSync(file, backup);
  else fs.rmSync(file, { force: true });
  return fail(`${reason} (이전 커리큘럼으로 되돌렸습니다)`);
};

console.log(`… ${topic.name} 커리큘럼 ${append ? `레슨 ${count}개 추가` : "설계"} 중 (조사 때문에 몇 분 걸릴 수 있어요)`);
runClaude(prompt, {
  allowedTools: ["WebSearch", "WebFetch", "Read", "Glob", "Grep", NAVER_TOOL, `Edit(./${relFile})`],
  model: args.model,
  inheritOutput: true,
}).then(({ code }) => {
  if (code !== 0) restore(`claude 실행이 실패했습니다 (종료 코드 ${code})`);
  if (!fs.existsSync(file)) restore("커리큘럼 파일이 만들어지지 않았습니다");

  let data: Curriculum;
  try {
    data = JSON.parse(fs.readFileSync(file, "utf8")) as Curriculum;
  } catch {
    return restore("커리큘럼 JSON을 읽을 수 없습니다");
  }
  let saved: Curriculum;
  try {
    saved = writeCurriculum(topic.slug, { ...data, topic: topic.slug });
  } catch (err) {
    return restore(`형식 오류: ${(err as Error).message}`);
  }
  const ids = new Set(allLessons(saved).map((l) => l.id));
  const lost = usedIds.filter((id) => !ids.has(id));
  if (lost.length) restore(`이미 글로 쓴 레슨이 사라졌습니다: ${lost.join(", ")}`);

  const total = allLessons(saved).length;
  console.log(`\n✔ ${relFile}: ${saved.stages.length}단계 · 레슨 ${total}개 (약 ${total * TOPICS.length}일 분량)`);
  console.log(`  목표: ${saved.goal}`);
});
