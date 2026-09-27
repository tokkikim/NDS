// Claude CLI(`claude -p`)로 오늘의 공부노트 "초안"을 만듭니다.
// 구독 중인 Claude 계정으로 로그인된 CLI를 그대로 쓰므로 API 키나 추가 비용이 없습니다.
// 소재는 --subject > 콘텐츠 계획(content/plan/<주제>.md) 대기 맨 위 > Claude 자동 선택 순으로 정해집니다.
// 결과는 항상 draft: true로 저장되며, "직접 해보기"와 사실 확인은 사람이 채워야 게시됩니다.
//   npm run draft
//   npm run draft -- --topic english --subject "현재완료 vs 과거시제"
//   npm run draft -- --date 2026-10-02        # 미리 써두기
import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { getAllPostFiles, parsePostFile, validatePost } from "../src/lib/posts";
import { ensureClaudeCli, loadPrompt, runClaude } from "./claude";
import { fail, parseArgs, postPath, resolveDateAndTopic } from "./lib";
import { markDone, pendingItems, planPath } from "./plan-file";

const args = parseArgs();
const { date, topic } = resolveDateAndTopic(args);
const file = postPath(date, topic);
const relFile = path.relative(process.cwd(), file);
const slug = path.basename(file, ".md");
if (fs.existsSync(file)) fail(`이미 파일이 있습니다: ${relFile}`);
ensureClaudeCli();

// 같은 주제의 이전 글: 중복을 피하고, 관련 글끼리 내부 링크를 걸 수 있게 넘깁니다.
const previous = getAllPostFiles()
  .map(parsePostFile)
  .filter((p) => p.topic === topic.slug)
  .sort((a, b) => b.date.localeCompare(a.date))
  .slice(0, 40)
  .map((p) => `- ${p.title} (/posts/${p.slug})`);

const planFile = planPath(topic);
const planItem = args.subject ? undefined : pendingItems(planFile)[0];
const subject = args.subject
  ? args.subject
  : planItem
    ? [`${planItem.title} (콘텐츠 계획에서 선택된 소재)`, ...planItem.details.map((d) => `  - ${d}`)].join("\n")
    : "이전 글과 겹치지 않으면서 자연스럽게 이어지는 소재를 직접 골라 주세요.";

const prompt = loadPrompt("draft", {
  date,
  year: date.slice(0, 4),
  file: relFile,
  slug,
  topicSlug: topic.slug,
  topicName: topic.name,
  topicDescription: topic.description,
  subject,
  previous: previous.length ? previous.join("\n") : "(아직 없음 - 입문자가 처음 공부하기 좋은 소재로 시작)",
});

console.log(`… ${topic.name} 초안 작성 중${planItem ? ` [계획: ${planItem.title}]` : ""} (조사 때문에 몇 분 걸릴 수 있어요)`);
// 조사용 도구와, 오늘 글 파일 하나에 대한 쓰기 권한만 허용합니다. (Edit 규칙이 Write까지 포함)
runClaude(prompt, {
  allowedTools: ["WebSearch", "WebFetch", "Read", "Glob", "Grep", `Edit(./${relFile})`, "Bash(npm run check)"],
  model: args.model,
  inheritOutput: true,
}).then(({ code }) => {
  if (code !== 0) fail(`claude 실행이 실패했습니다 (종료 코드 ${code}).`);
  if (!fs.existsSync(file)) fail(`초안 파일이 만들어지지 않았습니다: ${relFile}`);

  // 어떤 경우에도 초안은 draft: true로 둡니다. 게시 여부는 사람이 정합니다.
  const raw = matter(fs.readFileSync(file, "utf8"));
  if (raw.data.draft !== true) {
    // gray-matter는 파싱 결과를 캐시해 공유하므로 data를 직접 바꾸지 않고 복사합니다.
    fs.writeFileSync(file, matter.stringify(raw.content, { ...raw.data, draft: true }));
  }
  if (planItem) markDone(planFile, planItem, date, path.basename(file));

  const post = parsePostFile(path.basename(file));
  const errors = validatePost(post);
  console.log(`\n✔ 초안 생성: ${relFile} (${topic.name})`);
  console.log(`  제목: ${post.title}`);
  if (planItem) console.log(`  계획 완료 처리: ${path.relative(process.cwd(), planFile)}`);
  if (errors.length) {
    console.log("  ⚠ 형식 문제가 있어 직접 고쳐야 합니다:");
    for (const e of errors) console.log(`    - ${e}`);
  }
  console.log("  → 직접 해보기를 채우고, 출처를 확인하고, TODO를 지우고, draft: false로 바꾸면 게시됩니다.");
});
