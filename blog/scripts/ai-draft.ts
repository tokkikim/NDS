// Claude로 오늘의 공부노트 "초안"을 만듭니다. 결과는 항상 draft: true로 저장되며,
// "직접 해보기" 섹션과 출처 확인은 사람이 채워야 게시됩니다.
//   ANTHROPIC_API_KEY=... npm run draft
//   npm run draft -- --topic english --subject "현재완료 vs 과거시제"
import fs from "node:fs";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import type { Topic } from "../src/blog.config";
import { getAllPostFiles, parsePostFile } from "../src/lib/posts";
import {
  type Draft,
  experiencePlaceholder,
  fail,
  parseArgs,
  postPath,
  resolveDateAndTopic,
  SECTION_HEADINGS,
  writePost,
} from "./lib";

const args = parseArgs();
const { date, topic } = resolveDateAndTopic(args);
const file = postPath(date, topic);
if (fs.existsSync(file)) fail(`이미 파일이 있습니다: ${path.relative(process.cwd(), file)}`);

// 같은 주제의 이전 글 제목을 넘겨서 중복을 피하고 연재처럼 이어지게 합니다.
const previousTitles = getAllPostFiles()
  .map(parsePostFile)
  .filter((p) => p.topic === topic.slug)
  .sort((a, b) => b.date.localeCompare(a.date))
  .slice(0, 30)
  .map((p) => `- ${p.date} ${p.title}`);

const SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string", description: "검색에 잘 걸리는 구체적인 한국어 제목 (40자 이내)" },
    summary: { type: "string", description: "검색 결과에 보일 요약, 한두 문장 (150자 이내)" },
    tags: { type: "array", items: { type: "string" }, description: "3~6개의 한국어 태그" },
    sources: {
      type: "array",
      items: {
        type: "object",
        properties: { title: { type: "string" }, url: { type: "string" } },
        required: ["title", "url"],
        additionalProperties: false,
      },
      description: "실제로 존재하는 공식 문서·기관·신뢰할 만한 출처 2~4개",
    },
    sections: {
      type: "object",
      description: "각 섹션의 마크다운 본문 (제목 줄은 제외)",
      properties: {
        learned: { type: "string", description: "오늘 공부한 것: 3줄 요약 목록" },
        core: { type: "string", description: "핵심 정리: 개념 설명, 예시, 필요하면 표. 1500~2500자" },
        tryPrompts: {
          type: "array",
          items: { type: "string" },
          description: "운영자가 직접 해보고 기록할 수 있는 구체적인 실습 과제 3개",
        },
        confusing: { type: "string", description: "초보자가 헷갈리기 쉬운 점과 해결 방법" },
        next: { type: "string", description: "다음에 이어서 공부할 내용 2~3개" },
      },
      required: ["learned", "core", "tryPrompts", "confusing", "next"],
      additionalProperties: false,
    },
  },
  required: ["title", "summary", "tags", "sources", "sections"],
  additionalProperties: false,
} as const;

type DraftResponse = {
  title: string;
  summary: string;
  tags: string[];
  sources: Draft["sources"];
  sections: { learned: string; core: string; tryPrompts: string[]; confusing: string; next: string };
};

function buildPrompt(topic: Topic): string {
  return [
    `블로그 "${topic.name}" 카테고리의 오늘(${date}) 공부노트 초안을 작성해 주세요.`,
    `카테고리 설명: ${topic.description}`,
    args.subject
      ? `오늘의 소재: ${args.subject}`
      : "오늘의 소재는 아래 이전 글과 겹치지 않으면서 자연스럽게 이어지는 것으로 하나만 골라 주세요.",
    "",
    "이전 글 목록:",
    previousTitles.length ? previousTitles.join("\n") : "(아직 없음 - 입문자가 처음 공부하기 좋은 소재로 시작)",
  ].join("\n");
}

const SYSTEM = `당신은 "배우면서 기록하는" 한국어 공부 블로그의 초안 작성을 돕습니다.
- 독자는 같은 주제를 공부하는 입문자입니다. 친절하지만 군더더기 없는 "~해요/~입니다" 체로 씁니다.
- 한 편에 한 가지 소재만 깊게 다룹니다. 목록 나열보다 이유와 예시를 설명하세요.
- 확실하지 않은 사실, 수치, 날짜, 제도 내용은 단정하지 말고 "확인 필요"라고 표시하세요.
- 경제·재테크 소재는 투자 권유가 되지 않게 쓰고, 세법·제도는 기준 연도를 밝히세요.
- 운영자의 개인 경험을 지어내지 마세요. 경험은 운영자가 "직접 해보기" 섹션에 따로 씁니다.
- 출처는 실제로 존재한다고 확신하는 공식 문서나 기관 페이지만 넣으세요.`;

async function main() {
  const client = new Anthropic();
  const message = await client.beta.messages
    .stream({
      model: "claude-opus-5",
      max_tokens: 32000,
      thinking: { type: "adaptive" },
      output_config: { effort: "high", format: { type: "json_schema", schema: SCHEMA } },
      // 안전 분류기가 요청을 거절하면 서버가 다른 모델로 자동 재시도합니다.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: SYSTEM,
      messages: [{ role: "user", content: buildPrompt(topic) }],
    })
    .finalMessage();

  if (message.stop_reason === "refusal") fail("모델이 요청을 거절했습니다. --subject를 바꿔 다시 시도하세요.");
  if (message.stop_reason === "max_tokens") fail("응답이 너무 길어 잘렸습니다. 다시 시도하세요.");

  const text = message.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
  let data: DraftResponse;
  try {
    data = JSON.parse(text) as DraftResponse;
  } catch {
    fail("모델 응답을 JSON으로 읽지 못했습니다. 다시 시도하세요.");
  }

  const s = data.sections;
  const [learned, core, experience, confusing, next] = SECTION_HEADINGS;
  const body = [
    learned,
    s.learned,
    core,
    s.core,
    experience,
    experiencePlaceholder(s.tryPrompts),
    confusing,
    s.confusing,
    next,
    s.next,
    "<!-- TODO: 본문의 사실·수치와 frontmatter의 참고 자료 링크를 직접 확인한 뒤 이 줄을 지우세요. -->",
  ].join("\n\n");

  writePost(file, date, topic, {
    title: data.title,
    summary: data.summary,
    tags: data.tags,
    sources: data.sources,
    body,
  });

  console.log(`✔ 초안 생성: ${path.relative(process.cwd(), file)} (${topic.name})`);
  console.log(`  제목: ${data.title}`);
  console.log("  → 직접 해보기 섹션을 채우고, 출처를 확인하고, draft: false로 바꾸면 게시됩니다.");
}

main().catch((err) => {
  if (err instanceof Anthropic.AuthenticationError) fail("ANTHROPIC_API_KEY가 없거나 잘못됐습니다.");
  if (err instanceof Anthropic.RateLimitError) fail("요청 한도를 넘었습니다. 잠시 후 다시 시도하세요.");
  if (err instanceof Anthropic.APIError) fail(`API 오류 ${err.status}: ${err.message}`);
  // 키가 아예 없을 때는 요청 전에 이 오류가 납니다.
  if (err instanceof Anthropic.AnthropicError) fail(`Claude API를 호출하지 못했습니다 (ANTHROPIC_API_KEY 확인): ${err.message}`);
  throw err;
});
