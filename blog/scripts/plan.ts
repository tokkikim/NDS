// 카테고리의 콘텐츠 계획(소재 목록)을 만들거나 보충합니다.
//   npm run plan -- --topic money             # 소재 20개 추가
//   npm run plan -- --topic money --count 30
// 결과는 content/plan/<주제>.md 의 "대기" 목록에 추가됩니다. 순서를 바꾸거나 지워서 승인하세요.
import fs from "node:fs";
import path from "node:path";
import { getTopic, TOPICS } from "../src/blog.config";
import { todayString } from "../src/lib/dates";
import { getAllPostFiles, parsePostFile } from "../src/lib/posts";
import { ensureClaudeCli, loadPrompt, NAVER_TOOL, runClaude } from "./claude";
import { fail, parseArgs } from "./lib";
import { createPlanFile, doneCount, pendingItems, planPath } from "./plan-file";

const args = parseArgs();
const topic = args.topic ? getTopic(args.topic) : undefined;
if (!topic) fail(`--topic을 지정하세요 (가능: ${TOPICS.map((t) => t.slug).join(", ")})`);
ensureClaudeCli();

const file = planPath(topic);
const relFile = path.relative(process.cwd(), file);
if (!fs.existsSync(file)) createPlanFile(topic);
const before = pendingItems(file).length;

const posts = getAllPostFiles()
  .map(parsePostFile)
  .filter((p) => p.topic === topic.slug)
  .map((p) => `- (작성함) ${p.title}`);
const planned = pendingItems(file).map((i) => `- (계획됨) ${i.title}`);

const researchDir = path.join(process.cwd(), "research");
const reports = fs.existsSync(researchDir)
  ? fs
      .readdirSync(researchDir)
      .filter((f) => f.endsWith(".md") && f !== "profile.md" && !f.includes("비교"))
      .map((f) => `research/${f}`)
  : [];

const prompt = loadPrompt("plan", {
  topicName: topic.name,
  topicDescription: topic.description,
  planFile: relFile,
  count: args.count ?? "20",
  date: todayString(),
  research: args.research ?? (reports.length ? reports.join(", ") : "(없음)"),
  existing: [...posts, ...planned].join("\n") || "(없음)",
});

console.log(`… ${topic.name} 콘텐츠 계획 작성 중 (키워드 조사 때문에 몇 분 걸릴 수 있어요)`);
runClaude(prompt, {
  allowedTools: ["WebSearch", "WebFetch", "Read", "Glob", "Grep", NAVER_TOOL, `Edit(./${relFile})`],
  model: args.model,
  inheritOutput: true,
}).then(({ code }) => {
  if (code !== 0) fail(`claude 실행이 실패했습니다 (종료 코드 ${code}).`);
  const after = pendingItems(file).length;
  console.log(`\n✔ ${relFile}: 대기 ${before} → ${after}개 (완료 ${doneCount(file)}개)`);
  console.log("  → 파일을 열어 순서를 바꾸거나 빼서 승인하세요. npm run draft가 대기 맨 위부터 씁니다.");
});
