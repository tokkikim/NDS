import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { getTopic } from "../blog.config";
import { addDays, todayString } from "./dates";

export const POSTS_DIR = path.join(process.cwd(), "content", "posts");
/** 글 이미지는 public/images/posts/<글 파일명>/ 에 넣고 본문에서 /images/posts/... 로 불러옵니다. */
export const PUBLIC_DIR = path.join(process.cwd(), "public");

/** 사람이 직접 채워야 하는 곳에 남기는 표시. 이 표시가 남은 글은 게시되지 않습니다. */
export const TODO_MARKER = "<!-- TODO";
/** 모든 글에 반드시 있어야 하는, 직접 경험을 쓰는 섹션 */
export const EXPERIENCE_HEADING = "## 직접 해보기";
/** 대시보드에서 이미지를 올릴 때 넣는 임시 설명. 이대로는 게시되지 않습니다. */
export const IMAGE_ALT_PLACEHOLDER = "이미지 설명을 쓰세요";

export type Source = { title: string; url: string };

export type Post = {
  slug: string;
  title: string;
  date: string;
  updated?: string;
  topic: string;
  tags: string[];
  summary: string;
  draft: boolean;
  affiliate: boolean;
  sources: Source[];
  content: string;
  readingMinutes: number;
};

function toDateString(value: unknown): string {
  // gray-matter는 따옴표 없는 날짜를 Date 객체로 읽습니다.
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value ?? "");
}

export function parsePostFile(file: string): Post {
  const raw = fs.readFileSync(path.join(POSTS_DIR, file), "utf8");
  const { data, content } = matter(raw);
  const chars = content.replace(/\s+/g, "").length;
  return {
    slug: file.replace(/\.md$/, ""),
    title: String(data.title ?? ""),
    date: toDateString(data.date),
    updated: data.updated ? toDateString(data.updated) : undefined,
    topic: String(data.topic ?? ""),
    tags: Array.isArray(data.tags) ? data.tags.map(String) : [],
    summary: String(data.summary ?? ""),
    draft: data.draft === true,
    affiliate: data.affiliate === true,
    sources: Array.isArray(data.sources) ? (data.sources as Source[]) : [],
    content,
    // 한국어 기준 분당 약 500자
    readingMinutes: Math.max(1, Math.round(chars / 500)),
  };
}

export function getAllPostFiles(): string[] {
  if (!fs.existsSync(POSTS_DIR)) return [];
  return fs.readdirSync(POSTS_DIR).filter((f) => f.endsWith(".md"));
}

/** 게시 가능한 글인지: 초안이 아니고, 게시일이 지났고, 미완성 표시가 없어야 합니다. */
export function isPublished(post: Post, today = todayString()): boolean {
  return !post.draft && post.date <= today && !post.content.includes(TODO_MARKER);
}

/** 게시된 글을 최신순으로 반환합니다. 예약 글은 날짜가 되면 자동으로 포함됩니다. */
export function getPublishedPosts(): Post[] {
  const today = todayString();
  return getAllPostFiles()
    .map(parsePostFile)
    .filter((p) => isPublished(p, today))
    .sort((a, b) => (a.date === b.date ? b.slug.localeCompare(a.slug) : b.date.localeCompare(a.date)));
}

/** 정적 빌드용 글 경로 목록. 게시된 글이 하나도 없으면 Next.js 정적 빌드가 실패해서 빈 자리 하나를 넣습니다. */
export const PLACEHOLDER_SLUG = "_none";
export function getStaticSlugs(): { slug: string }[] {
  const slugs = getPublishedPosts().map((p) => ({ slug: p.slug }));
  return slugs.length ? slugs : [{ slug: PLACEHOLDER_SLUG }];
}

export function getPost(slug: string): Post | undefined {
  return getPublishedPosts().find((p) => p.slug === slug);
}

export function getPostsByTopic(topic: string): Post[] {
  return getPublishedPosts().filter((p) => p.topic === topic);
}

export function getAdjacentPosts(slug: string): { newer?: Post; older?: Post } {
  const posts = getPublishedPosts();
  const i = posts.findIndex((p) => p.slug === slug);
  return { newer: i > 0 ? posts[i - 1] : undefined, older: i >= 0 ? posts[i + 1] : undefined };
}

/** 오늘(또는 어제)까지 하루도 빠짐없이 게시한 연속 일수 */
export function getStreak(posts: Post[], today = todayString()): number {
  const dates = new Set(posts.map((p) => p.date));
  let day = dates.has(today) ? today : addDays(today, -1);
  let streak = 0;
  while (dates.has(day)) {
    streak++;
    day = addDays(day, -1);
  }
  return streak;
}

/** 게시 전 품질 검사. 문제 목록을 반환합니다 (빈 배열이면 통과). */
export function validatePost(post: Post): string[] {
  const errors: string[] = [];
  if (!post.title) errors.push("title이 비어 있습니다");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(post.date)) errors.push(`date 형식이 잘못됐습니다: "${post.date}"`);
  if (!post.slug.startsWith(post.date)) errors.push("파일명은 게시일(YYYY-MM-DD)로 시작해야 합니다");
  if (!getTopic(post.topic)) errors.push(`알 수 없는 topic입니다: "${post.topic}"`);
  if (!post.summary) errors.push("summary(검색 결과에 보일 요약)가 비어 있습니다");
  if (post.summary.length > 160) errors.push("summary는 160자 이하로 써주세요");

  for (const { alt, src } of extractImages(post.content)) {
    if (!alt.trim() || alt === IMAGE_ALT_PLACEHOLDER) errors.push(`이미지 설명(alt)을 써주세요: ${src}`);
    if (/^https?:\/\//.test(src)) {
      errors.push(`외부 이미지는 저작권 문제로 쓰지 않습니다. public/images/posts/${post.slug}/ 에 직접 만든 이미지를 넣어주세요: ${src}`);
    } else if (!src.startsWith("/")) {
      errors.push(`이미지 경로는 /images/posts/${post.slug}/ 처럼 /로 시작해야 합니다: ${src}`);
    } else if (!fs.existsSync(path.join(PUBLIC_DIR, decodeURI(src)))) {
      errors.push(`이미지 파일이 없습니다: public${src}`);
    }
  }

  // 내부 링크가 없는 글이나 아직 공개되지 않은 글을 가리키면 404가 됩니다.
  for (const [, target] of post.content.matchAll(/\]\(\/posts\/([^)#\s]+)\)/g)) {
    const file = `${target}.md`;
    if (!fs.existsSync(path.join(POSTS_DIR, file))) {
      errors.push(`없는 글로 링크했습니다: /posts/${target}`);
    } else if (!post.draft) {
      const linked = parsePostFile(file);
      if (linked.draft || linked.date > post.date) errors.push(`아직 공개되지 않은 글로 링크했습니다: /posts/${target}`);
    }
  }

  if (!post.draft) {
    if (post.content.includes(TODO_MARKER)) {
      errors.push("아직 채우지 않은 TODO 표시가 남아 있습니다");
    }
    const experience = sectionBody(post.content, EXPERIENCE_HEADING);
    if (experience === undefined) {
      errors.push(`"${EXPERIENCE_HEADING}" 섹션이 없습니다`);
    } else if (experience.replace(/\s+/g, "").length < 100) {
      errors.push(`"${EXPERIENCE_HEADING}" 섹션을 100자 이상 직접 써주세요`);
    }
    if (post.content.replace(/\s+/g, "").length < 800) {
      errors.push("본문이 너무 짧습니다 (공백 제외 800자 이상)");
    }
  }
  return errors;
}

/** 본문의 마크다운 이미지 ![설명](경로) 목록. 작성용 메모(HTML 주석) 안의 것은 제외합니다. */
export function extractImages(content: string): { alt: string; src: string }[] {
  const visible = content.replace(/<!--[\s\S]*?-->/g, "");
  return [...visible.matchAll(/!\[([^\]]*)\]\(\s*([^)\s]+)(?:\s+"[^"]*")?\s*\)/g)].map((m) => ({
    alt: m[1],
    src: m[2],
  }));
}

function sectionBody(content: string, heading: string): string | undefined {
  const start = content.indexOf(heading);
  if (start === -1) return undefined;
  const rest = content.slice(start + heading.length);
  const next = rest.search(/^## /m);
  return next === -1 ? rest : rest.slice(0, next);
}
