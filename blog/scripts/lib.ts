import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { getTopic, TOPICS, type Topic } from "../src/blog.config";
import { todayString, topicForDate } from "../src/lib/dates";
import { POSTS_DIR, TODO_MARKER, type Source } from "../src/lib/posts";

/** --key value 형태의 명령줄 인자를 읽습니다. */
export function parseArgs(argv = process.argv.slice(2)): Record<string, string> {
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    if (!key.startsWith("--")) continue;
    const next = argv[i + 1];
    args[key.slice(2)] = next && !next.startsWith("--") ? (i++, next) : "true";
  }
  return args;
}

/** 날짜와 주제를 인자에서 정하고, 없으면 오늘 날짜와 로테이션 주제를 씁니다. */
export function resolveDateAndTopic(args: Record<string, string>): { date: string; topic: Topic } {
  const date = args.date ?? todayString();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) fail(`--date는 YYYY-MM-DD 형식이어야 합니다: ${date}`);
  const topic = args.topic ? getTopic(args.topic) : topicForDate(date);
  if (!topic) fail(`알 수 없는 주제입니다: ${args.topic} (가능: ${TOPICS.map((t) => t.slug).join(", ")})`);
  return { date, topic };
}

export function postPath(date: string, topic: Topic): string {
  return path.join(POSTS_DIR, `${date}-${topic.slug}.md`);
}

export type Draft = {
  title: string;
  summary: string;
  tags: string[];
  sources: Source[];
  body: string;
};

export function writePost(file: string, date: string, topic: Topic, draft: Draft): void {
  const frontmatter = {
    title: draft.title,
    date,
    topic: topic.slug,
    tags: draft.tags,
    summary: draft.summary,
    sources: draft.sources,
    // 검토를 마치면 false로 바꾸세요. true인 글은 게시되지 않습니다.
    draft: true,
  };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, matter.stringify(`\n${draft.body.trim()}\n`, frontmatter));
}

/** 직접 경험을 채워 넣어야 하는 자리. 이 표시가 남아 있으면 게시되지 않습니다. */
export function experiencePlaceholder(prompts: string[]): string {
  return [
    `${TODO_MARKER}: 아래 질문에 답하며 직접 해본 내용을 쓰고 이 주석을 지우세요.`,
    ...prompts.map((p) => `  - ${p}`),
    "-->",
  ].join("\n");
}

export function fail(message: string): never {
  console.error(`✖ ${message}`);
  process.exit(1);
}
