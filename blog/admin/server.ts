// 로컬 관리자 대시보드. 내 PC에서만 열리며 배포되는 블로그에는 포함되지 않습니다.
//   npm run admin   →  http://localhost:4000
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import matter from "gray-matter";
import { getTopic, TOPICS } from "../src/blog.config";
import { todayString, topicForDate } from "../src/lib/dates";
import { renderMarkdown } from "../src/lib/markdown";
import { getAllPostFiles, getStreak, IMAGE_ALT_PLACEHOLDER, isPublished, parsePostFile, POSTS_DIR, PUBLIC_DIR, validatePost } from "../src/lib/posts";
import { createPlanFile, doneItems, pendingItems, planPath, savePending, type PlanItem } from "../scripts/plan-file";
import { claudeCommand, loadEnv, tsxCommand } from "../scripts/proc";
import { CRITERIA, type ResearchResult, totalScore, validateResearch, verdict } from "../scripts/scoring";

loadEnv();

const portArg = process.argv.indexOf("--port");
const PORT = Number(portArg > -1 ? process.argv[portArg + 1] : (process.env.ADMIN_PORT ?? 4000));
if (Number(process.versions.node.split(".")[0]) < 20) {
  console.error(`✖ Node.js 20 이상이 필요합니다 (현재 ${process.version}). https://nodejs.org 에서 LTS 버전을 설치하세요.`);
  process.exit(1);
}
const ROOT = process.cwd();
const STATIC_DIR = path.join(ROOT, "admin", "public");
const RESEARCH_DIR = path.join(ROOT, "research");
const PROFILE = path.join(RESEARCH_DIR, "profile.md");

// ── 백그라운드 작업 (시장분석·계획·초안은 몇 분씩 걸립니다) ──────────────────

type Job = {
  id: number;
  kind: string;
  label: string;
  status: "running" | "done" | "failed";
  log: string;
  startedAt: string;
  /** 시장분석 작업이 다루는 주제들 (같은 주제를 동시에 두 번 분석하지 않도록) */
  topics?: string[];
};
const jobs: Job[] = [];

function startJob(kind: string, label: string, script: string, args: string[], topics?: string[]): Job {
  const running = jobs.filter((j) => j.kind === kind && j.status === "running");
  if (topics) {
    // 시장분석은 주제가 겹치지 않으면 여러 개를 동시에 돌릴 수 있습니다.
    const busy = running.flatMap((j) => j.topics ?? []).filter((t) => topics.includes(t));
    if (busy.length) throw new HttpError(409, `이미 분석 중인 주제입니다: ${busy.join(", ")}`);
  } else if (running.length) {
    throw new HttpError(409, `이미 실행 중인 ${label} 작업이 있습니다`);
  }

  const job: Job = { id: jobs.length + 1, kind, label, status: "running", log: "", startedAt: new Date().toISOString(), topics };
  jobs.unshift(job);
  const cmd = tsxCommand(`scripts/${script}.ts`, args);
  const child = spawn(cmd.command, cmd.args, { cwd: ROOT, env: process.env });
  const append = (d: Buffer) => (job.log += d.toString());
  child.stdout.on("data", append);
  child.stderr.on("data", append);
  child.on("error", (err) => {
    job.status = "failed";
    job.log += `\n[실행 실패] ${err.message}`;
  });
  child.on("close", (code) => {
    job.status = code === 0 ? "done" : "failed";
    job.log += `\n[종료 코드 ${code}]`;
  });
  return job;
}

// ── 데이터 ─────────────────────────────────────────────────────────────────

function postStatus(file: string) {
  const post = parsePostFile(file);
  const errors = validatePost(post);
  const today = todayString();
  const status = post.draft
    ? "초안"
    : errors.length
      ? "문제"
      : isPublished(post, today)
        ? "게시"
        : post.date > today
          ? "예약"
          : "문제";
  return {
    slug: post.slug,
    title: post.title,
    date: post.date,
    topic: post.topic,
    status,
    errors,
    todo: post.content.includes("<!-- TODO"),
    chars: post.content.replace(/\s+/g, "").length,
  };
}

function allPosts() {
  return getAllPostFiles()
    .map(postStatus)
    .sort((a, b) => b.date.localeCompare(a.date));
}

type ResearchRow = {
  topic: string;
  total: number;
  verdict: string;
  dataMode: string;
  summary: string;
  scores: Record<string, number>;
  report: string;
  /** 같은 주제의 직전 분석 결과 (재분석 전후 비교용) */
  prev?: { date: string; total: number; dataMode: string };
};

function researchResults() {
  if (!fs.existsSync(RESEARCH_DIR)) return [];
  const byDate = new Map<string, ResearchRow[]>();
  const lastByTopic = new Map<string, { date: string; total: number; dataMode: string }>();
  // 파일명이 날짜로 시작하므로 정렬하면 오래된 분석부터 읽습니다.
  for (const f of fs.readdirSync(RESEARCH_DIR).filter((f) => f.endsWith(".json")).sort()) {
    try {
      const r = JSON.parse(fs.readFileSync(path.join(RESEARCH_DIR, f), "utf8")) as ResearchResult;
      if (validateResearch(r).length) continue;
      const total = totalScore(r);
      const prev = lastByTopic.get(r.topic);
      const row: ResearchRow = {
        topic: r.topic,
        total,
        verdict: verdict(total),
        dataMode: r.dataMode,
        summary: r.summary,
        scores: Object.fromEntries(CRITERIA.map((c) => [c.key, r.scores[c.key].score])),
        report: `research/${f.replace(/\.json$/, ".md")}`,
        prev: prev && prev.date < r.date ? prev : undefined,
      };
      lastByTopic.set(r.topic, { date: r.date, total, dataMode: r.dataMode });
      byDate.set(r.date, [...(byDate.get(r.date) ?? []), row]);
    } catch {
      // 깨진 파일은 목록에서 뺍니다.
    }
  }
  return [...byDate.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([date, rows]) => ({ date, rows: rows.sort((a, b) => b.total - a.total) }));
}

function status() {
  const today = todayString();
  const posts = allPosts();
  const published = getAllPostFiles().map(parsePostFile).filter((p) => isPublished(p, today));
  const claude = claudeCommand(["--version"]);
  const probe = spawnSync(claude.command, claude.args, { stdio: "ignore", shell: claude.shell });
  const hasClaude = !probe.error && probe.status === 0;
  return {
    today,
    todayTopic: topicForDate(today),
    todayPost: posts.find((p) => p.date === today) ?? null,
    streak: getStreak(published),
    counts: Object.fromEntries(["게시", "예약", "초안", "문제"].map((s) => [s, posts.filter((p) => p.status === s).length])),
    plans: TOPICS.map((t) => ({ ...t, pending: pendingItems(planPath(t)).length, done: doneItems(planPath(t)).length })),
    tools: {
      claude: hasClaude,
      naverAd: !!(process.env.NAVER_AD_API_KEY && process.env.NAVER_AD_SECRET && process.env.NAVER_AD_CUSTOMER_ID),
      naverDatalab: !!(process.env.NAVER_CLIENT_ID && process.env.NAVER_CLIENT_SECRET),
      profile: fs.existsSync(PROFILE) && /:[ \t]*\S/.test(fs.readFileSync(PROFILE, "utf8").replace(/\(예:[^)]*\)/g, "")),
    },
    jobs: jobs.filter((j) => j.status === "running").map((j) => ({ id: j.id, kind: j.kind, label: j.label, startedAt: j.startedAt })),
  };
}

// ── HTTP ───────────────────────────────────────────────────────────────────

class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

function safeSlug(slug: string): string {
  if (!/^\d{4}-\d{2}-\d{2}-[\p{L}\p{N}-]+$/u.test(slug)) throw new HttpError(400, "잘못된 글 이름입니다");
  return slug;
}

function topicOrThrow(slug: string | null) {
  const topic = slug ? getTopic(slug) : undefined;
  if (!topic) throw new HttpError(400, "알 수 없는 주제입니다");
  return topic;
}

async function readBody(req: http.IncomingMessage, limit = 10 * 1024 * 1024): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new HttpError(413, "파일이 너무 큽니다 (최대 10MB)");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function readJson<T>(req: http.IncomingMessage): Promise<T> {
  try {
    return JSON.parse((await readBody(req)).toString("utf8")) as T;
  } catch {
    throw new HttpError(400, "요청 형식이 잘못됐습니다");
  }
}

type Handler = (req: http.IncomingMessage, url: URL, params: string[]) => Promise<unknown> | unknown;
const routes: [string, RegExp, Handler][] = [
  ["GET", /^\/api\/status$/, () => status()],
  ["GET", /^\/api\/topics$/, () => TOPICS],

  // 시장 분석
  ["GET", /^\/api\/research$/, () => researchResults()],
  [
    "GET",
    /^\/api\/research\/report$/,
    (_req, url) => {
      const file = url.searchParams.get("file") ?? "";
      if (!/^research\/[^/]+\.md$/.test(file) || !fs.existsSync(path.join(ROOT, file))) throw new HttpError(404, "리포트가 없습니다");
      return { html: renderMarkdown(fs.readFileSync(path.join(ROOT, file), "utf8")) };
    },
  ],
  [
    "POST",
    /^\/api\/research$/,
    async (req) => {
      const { topics } = await readJson<{ topics: string[] }>(req);
      const list = (topics ?? []).map((t) => t.trim()).filter(Boolean).slice(0, 10);
      if (!list.length) throw new HttpError(400, "주제를 하나 이상 입력하세요");
      const label = list.length === 1 ? `시장분석: ${list[0]}` : `시장분석: ${list.length}개 주제`;
      return startJob("research", label, "research", list, list);
    },
  ],
  ["GET", /^\/api\/profile$/, () => ({ text: fs.existsSync(PROFILE) ? fs.readFileSync(PROFILE, "utf8") : "" })],
  [
    "PUT",
    /^\/api\/profile$/,
    async (req) => {
      const { text } = await readJson<{ text: string }>(req);
      fs.mkdirSync(RESEARCH_DIR, { recursive: true });
      fs.writeFileSync(PROFILE, text);
      return { ok: true };
    },
  ],

  // 콘텐츠 계획
  [
    "GET",
    /^\/api\/plan$/,
    (_req, url) => {
      const topic = topicOrThrow(url.searchParams.get("topic"));
      return { topic, pending: pendingItems(planPath(topic)), done: doneItems(planPath(topic)) };
    },
  ],
  [
    "PUT",
    /^\/api\/plan$/,
    async (req, url) => {
      const topic = topicOrThrow(url.searchParams.get("topic"));
      const { pending } = await readJson<{ pending: PlanItem[] }>(req);
      if (!Array.isArray(pending) || pending.some((i) => !i.title?.trim() || !Array.isArray(i.details))) {
        throw new HttpError(400, "계획 항목 형식이 잘못됐습니다");
      }
      if (!fs.existsSync(planPath(topic))) createPlanFile(topic);
      savePending(planPath(topic), pending);
      return { pending: pendingItems(planPath(topic)) };
    },
  ],
  [
    "POST",
    /^\/api\/plan\/generate$/,
    async (req) => {
      const { topic, count } = await readJson<{ topic: string; count?: number }>(req);
      const t = topicOrThrow(topic);
      const n = String(Math.min(50, Math.max(5, Number(count) || 20)));
      return startJob("plan", `계획: ${t.name} ${n}개`, "plan", ["--topic", t.slug, "--count", n]);
    },
  ],

  // 글
  ["GET", /^\/api\/posts$/, () => allPosts()],
  [
    "GET",
    /^\/api\/posts\/([^/]+)$/,
    (_req, _url, [slug]) => {
      const file = path.join(POSTS_DIR, `${safeSlug(slug)}.md`);
      if (!fs.existsSync(file)) throw new HttpError(404, "글이 없습니다");
      const post = parsePostFile(`${slug}.md`);
      return { raw: fs.readFileSync(file, "utf8"), html: renderMarkdown(post.content), ...postStatus(`${slug}.md`) };
    },
  ],
  [
    "PUT",
    /^\/api\/posts\/([^/]+)$/,
    async (req, _url, [slug]) => {
      const file = path.join(POSTS_DIR, `${safeSlug(slug)}.md`);
      if (!fs.existsSync(file)) throw new HttpError(404, "글이 없습니다");
      const { raw } = await readJson<{ raw: string }>(req);
      fs.writeFileSync(file, raw);
      return { html: renderMarkdown(parsePostFile(`${slug}.md`).content), ...postStatus(`${slug}.md`) };
    },
  ],
  [
    "POST",
    /^\/api\/posts\/([^/]+)\/publish$/,
    (_req, _url, [slug]) => {
      // 검사를 통과할 때만 draft: false로 바꿉니다.
      const file = path.join(POSTS_DIR, `${safeSlug(slug)}.md`);
      if (!fs.existsSync(file)) throw new HttpError(404, "글이 없습니다");
      const original = fs.readFileSync(file, "utf8");
      const parsed = matter(original);
      // gray-matter는 파싱 결과를 캐시해 공유하므로 data를 직접 바꾸지 않고 복사합니다.
      fs.writeFileSync(file, matter.stringify(parsed.content, { ...parsed.data, draft: false }));
      const result = postStatus(`${slug}.md`);
      if (result.errors.length) {
        fs.writeFileSync(file, original);
        return { ok: false, errors: result.errors };
      }
      return { ok: true, ...result };
    },
  ],
  [
    "POST",
    /^\/api\/posts\/([^/]+)\/images$/,
    async (req, url, [slug]) => {
      safeSlug(slug);
      const name = (url.searchParams.get("name") ?? "image.png").toLowerCase().replace(/[^a-z0-9._-]/g, "-");
      if (!/\.(png|jpe?g|webp|gif)$/.test(name)) throw new HttpError(400, "png, jpg, webp, gif만 올릴 수 있습니다");
      const data = await readBody(req);
      const dir = path.join(PUBLIC_DIR, "images", "posts", slug);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, name), data);
      const src = `/images/posts/${slug}/${name}`;
      return { src, markdown: `![${IMAGE_ALT_PLACEHOLDER}](${src})`, sizeKB: Math.round(data.length / 1024) };
    },
  ],
  [
    "POST",
    /^\/api\/draft$/,
    async (req) => {
      const { topic, subject, date, mode } = await readJson<{ topic?: string; subject?: string; date?: string; mode?: string }>(req);
      const args: string[] = [];
      if (topic) args.push("--topic", topicOrThrow(topic).slug);
      if (date) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new HttpError(400, "날짜 형식이 잘못됐습니다");
        args.push("--date", date);
      }
      if (mode === "template") return startJob("draft", "빈 템플릿", "new-post", args);
      if (subject?.trim()) args.push("--subject", subject.trim());
      return startJob("draft", `AI 초안${subject ? `: ${subject}` : ""}`, "ai-draft", args);
    },
  ],

  // 키워드 도구
  [
    "GET",
    /^\/api\/naver$/,
    (_req, url) => {
      const cmd = url.searchParams.get("cmd") ?? "";
      const words = (url.searchParams.get("q") ?? "").split(",").map((w) => w.trim()).filter(Boolean);
      if (!["keywords", "trend", "bid"].includes(cmd) || !words.length) throw new HttpError(400, "명령과 키워드를 입력하세요");
      const tsx = tsxCommand("scripts/naver.ts", [cmd, ...words.slice(0, 20)]);
      const r = spawnSync(tsx.command, tsx.args, { cwd: ROOT, encoding: "utf8", env: process.env });
      try {
        return JSON.parse(r.stdout);
      } catch {
        throw new HttpError(500, r.stderr || r.stdout || "네이버 도구 실행 실패");
      }
    },
  ],

  // 작업
  ["GET", /^\/api\/jobs$/, () => jobs.slice(0, 20).map(({ log, ...j }) => ({ ...j, tail: log.slice(-300) }))],
  [
    "GET",
    /^\/api\/jobs\/(\d+)$/,
    (_req, _url, [id]) => {
      const job = jobs.find((j) => j.id === Number(id));
      if (!job) throw new HttpError(404, "작업이 없습니다");
      return job;
    },
  ],
];

const MIME: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif" };

function sendFile(res: http.ServerResponse, file: string) {
  res.writeHead(200, { "Content-Type": `${MIME[path.extname(file)] ?? "application/octet-stream"}; charset=utf-8` });
  fs.createReadStream(file).pipe(res);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
  try {
    if (url.pathname.startsWith("/api/")) {
      for (const [method, pattern, handler] of routes) {
        const m = url.pathname.match(pattern);
        if (m && req.method === method) {
          const data = await handler(req, url, m.slice(1).map(decodeURIComponent));
          res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify(data));
          return;
        }
      }
      throw new HttpError(404, "없는 API입니다");
    }
    // 글 미리보기에서 올린 이미지를 볼 수 있게 public/images 도 제공합니다.
    const base = url.pathname.startsWith("/images/") ? PUBLIC_DIR : STATIC_DIR;
    const file = path.normalize(path.join(base, url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname)));
    if (!file.startsWith(base) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) throw new HttpError(404, "없는 페이지입니다");
    sendFile(res, file);
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
  }
});

// 외부에서 접근하지 못하도록 내 PC(127.0.0.1)에서만 엽니다.
server.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "EADDRINUSE") {
    console.error(`✖ ${PORT}번 포트를 이미 쓰고 있습니다. 다른 포트로 실행하세요: npm run admin -- --port 4001`);
  } else {
    console.error(`✖ 대시보드를 시작하지 못했습니다: ${err.message}`);
  }
  process.exit(1);
});
server.listen(PORT, "127.0.0.1", () => {
  console.log(`✔ 관리자 대시보드: http://localhost:${PORT}  (이 창을 닫으면 대시보드도 꺼집니다)`);
});
