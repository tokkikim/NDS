// Claude CLI(`claude -p`)로 오늘의 공부노트 "초안"을 만듭니다.
// 구독 중인 Claude 계정으로 로그인된 CLI를 그대로 쓰므로 API 키나 추가 비용이 없습니다.
// 결과는 항상 draft: true로 저장되며, "직접 해보기"와 사실 확인은 사람이 채워야 게시됩니다.
//   npm run draft
//   npm run draft -- --topic english --subject "현재완료 vs 과거시제"
//   npm run draft -- --date 2026-10-02        # 미리 써두기
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { getAllPostFiles, parsePostFile, validatePost } from "../src/lib/posts";
import { fail, parseArgs, postPath, resolveDateAndTopic } from "./lib";

const args = parseArgs();
const { date, topic } = resolveDateAndTopic(args);
const file = postPath(date, topic);
const relFile = path.relative(process.cwd(), file);
const slug = path.basename(file, ".md");
if (fs.existsSync(file)) fail(`이미 파일이 있습니다: ${relFile}`);

if (spawnSync("claude", ["--version"], { stdio: "ignore" }).error) {
  fail("claude 명령을 찾을 수 없습니다. `npm install -g @anthropic-ai/claude-code` 후 `claude`로 한 번 로그인하세요.");
}

// 같은 주제의 이전 글 제목을 넘겨서 중복을 피하고 연재처럼 이어지게 합니다.
const previous = getAllPostFiles()
  .map(parsePostFile)
  .filter((p) => p.topic === topic.slug)
  .sort((a, b) => b.date.localeCompare(a.date))
  .slice(0, 30)
  .map((p) => `- ${p.date} ${p.title}`);

const values: Record<string, string> = {
  date,
  year: date.slice(0, 4),
  file: relFile,
  slug,
  topicSlug: topic.slug,
  topicName: topic.name,
  topicDescription: topic.description,
  subject: args.subject ?? "이전 글과 겹치지 않으면서 자연스럽게 이어지는 소재를 직접 골라 주세요.",
  previous: previous.length ? previous.join("\n") : "(아직 없음 - 입문자가 처음 공부하기 좋은 소재로 시작)",
};
const template = fs.readFileSync(path.join(process.cwd(), "prompts", "draft.md"), "utf8");
const prompt = template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => values[key] ?? `{{${key}}}`);

// 조사용 도구와, 오늘 글 파일 하나에 대한 쓰기 권한만 허용합니다. (Edit 규칙이 Write까지 포함)
const allowedTools = [
  "WebSearch",
  "WebFetch",
  "Read",
  "Glob",
  "Grep",
  `Edit(./${relFile})`,
  "Bash(npm run check)",
];

console.log(`… ${topic.name} 초안 작성 중 (조사와 출처 확인 때문에 몇 분 걸릴 수 있어요)`);
const result = spawnSync(
  "claude",
  ["-p", "--allowedTools", ...allowedTools, ...(args.model ? ["--model", args.model] : [])],
  { input: prompt, stdio: ["pipe", "inherit", "inherit"], cwd: process.cwd() },
);
if (result.status !== 0) fail(`claude 실행이 실패했습니다 (종료 코드 ${result.status}).`);
if (!fs.existsSync(file)) fail(`초안 파일이 만들어지지 않았습니다: ${relFile}`);

// 어떤 경우에도 초안은 draft: true로 둡니다. 게시 여부는 사람이 정합니다.
const raw = matter(fs.readFileSync(file, "utf8"));
if (raw.data.draft !== true) {
  raw.data.draft = true;
  fs.writeFileSync(file, matter.stringify(raw.content, raw.data));
}

const post = parsePostFile(path.basename(file));
const errors = validatePost(post);
console.log(`\n✔ 초안 생성: ${relFile} (${topic.name})`);
console.log(`  제목: ${post.title}`);
if (errors.length) {
  console.log("  ⚠ 형식 문제가 있어 직접 고쳐야 합니다:");
  for (const e of errors) console.log(`    - ${e}`);
}
console.log("  → 직접 해보기를 채우고, 출처를 확인하고, TODO를 지우고, draft: false로 바꾸면 게시됩니다.");
