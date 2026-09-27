// 로컬 관리자 대시보드. 내 PC에서만 열리며 배포되는 블로그에는 포함되지 않습니다.
//   npm run admin   →  http://localhost:4000
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import matter from "gray-matter";
import type { Topic } from "../src/blog.config";
import { allLessons, readCurriculum, writeCurriculum, type Curriculum } from "../src/lib/curriculum";
import { addDays, todayString } from "../src/lib/dates";
import { renderMarkdown } from "../src/lib/markdown";
import { getAllPostFiles, getStreak, IMAGE_ALT_PLACEHOLDER, isPublished, parsePostFile, POSTS_DIR, PUBLIC_DIR, validatePost } from "../src/lib/posts";
import { claudeCommand, loadEnv, tsxCommand } from "../scripts/proc";
import { CRITERIA, type ResearchResult, totalScore, validateResearch, verdict } from "../scripts/scoring";
import { buildSchedule, daysUntilEmpty, type DayPlan } from "../src/lib/schedule";
import { dailyPlan, readDailyLog, writeDailyEntry } from "../src/lib/daily";
import { guideItemFor, readGuide } from "../src/lib/guide";

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
const CATEGORIES_FILE = path.join(ROOT, "content", "topics.json");

// ── 카테고리·커리큘럼·일정 (대시보드에서 바뀌므로 매번 파일에서 새로 읽습니다) ──

type Categories = { startDate: string; topics: Topic[] };

function readCategories(): Categories {
  return JSON.parse(fs.readFileSync(CATEGORIES_FILE, "utf8")) as Categories;
}

function schedule(from: string, to: string): DayPlan[] {
  const { startDate, topics } = readCategories();
  const curricula = Object.fromEntries(topics.map((t) => [t.slug, readCurriculum(t.slug)]));
  const posts = getAllPostFiles().map(parsePostFile);
  return buildSchedule({ startDate, topics, curricula, posts, today: todayString(), from, to });
}

// ── 백그라운드 작업 (시장분석·커리큘럼·초안은 몇 분씩 걸립니다) ──────────────────

type Job = {
  id: number;
  kind: string;
  label: string;
  status: "running" | "done" | "failed" | "stopped";
  log: string;
  startedAt: string;
  finishedAt?: string;
  /** 시장분석 작업이 다루는 주제들 (같은 주제를 동시에 두 번 분석하지 않도록) */
  topics?: string[];
};
const jobs: Job[] = [];
const JOB_TIMEOUT_MIN = Number(process.env.JOB_TIMEOUT_MIN ?? 30);
// 실행 중인 작업 프로세스 (중지 버튼용)
const processes = new Map<number, ReturnType<typeof spawn>>();

/** 작업과 그 안에서 실행된 claude 등 하위 프로세스까지 모두 끝냅니다. */
function killTree(child: ReturnType<typeof spawn>) {
  if (!child.pid) return;
  if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
  else {
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
      child.kill("SIGTERM");
    }
  }
}

/** 작업이 고칠 파일들의 시작 전 상태 (중지하면 되돌림). null = 원래 없던 파일 */
const snapshots = new Map<number, { files: Map<string, string | null>; posts: Set<string> }>();

function takeSnapshot(jobId: number, files: string[]) {
  const map = new Map(files.map((f) => [f, fs.existsSync(f) ? fs.readFileSync(f, "utf8") : null]));
  snapshots.set(jobId, { files: map, posts: new Set(getAllPostFiles()) });
}

function restoreSnapshot(jobId: number) {
  const snap = snapshots.get(jobId);
  if (!snap) return;
  for (const [file, content] of snap.files) {
    if (content === null) fs.rmSync(file, { force: true });
    else fs.writeFileSync(file, content);
  }
  // 작업 중에 새로 생긴 글(초안) 파일은 지웁니다.
  for (const f of getAllPostFiles()) if (!snap.posts.has(f)) fs.rmSync(path.join(POSTS_DIR, f), { force: true });
}

function startJob(kind: string, label: string, script: string, args: string[], topics?: string[], guard: string[] = []): Job {
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
  // 리눅스·맥에서는 별도 프로세스 그룹으로 띄워야 하위 프로세스까지 한 번에 중지할 수 있습니다.
  const child = spawn(cmd.command, cmd.args, { cwd: ROOT, env: process.env, detached: process.platform !== "win32" });
  processes.set(job.id, child);
  takeSnapshot(job.id, guard);
  // 너무 오래 걸리면(보통 3~10분) 헤매는 중일 가능성이 높아 자동으로 멈추고 파일을 되돌립니다.
  const timer = setTimeout(() => {
    if (job.status !== "running") return;
    job.status = "stopped";
    job.log += `\n[${JOB_TIMEOUT_MIN}분이 지나 자동으로 중지했습니다. 파일은 작업 전 상태로 되돌렸습니다]`;
    killTree(child);
  }, JOB_TIMEOUT_MIN * 60_000);
  child.on("close", () => clearTimeout(timer));
  const append = (d: Buffer) => (job.log += d.toString());
  child.stdout.on("data", append);
  child.stderr.on("data", append);
  child.on("error", (err) => {
    job.status = "failed";
    job.log += `\n[실행 실패] ${err.message}`;
  });
  child.on("close", (code) => {
    processes.delete(job.id);
    if (job.status === "stopped") restoreSnapshot(job.id);
    snapshots.delete(job.id);
    job.finishedAt = new Date().toISOString();
    if (job.status === "running") job.status = code === 0 ? "done" : "failed";
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

// ── 매일 실천 ──────────────────────────────────────────────────────────────

function dailyFor(date: string) {
  const { startDate, topics } = readCategories();
  return dailyPlan(date, topics, schedule(addDays(date, -21), addDays(date, 60)), readDailyLog(), startDate);
}

/** 오늘(아직 다 못 했으면 어제)부터 거꾸로, 모든 카테고리 할 일을 체크한 연속 일수 */
function practiceStreak(): number {
  const { startDate, topics } = readCategories();
  const log = readDailyLog();
  const allDone = (d: string) => topics.every((t) => log[d]?.[t.slug]?.done);
  let d = todayString();
  if (!allDone(d)) d = addDays(d, -1);
  let n = 0;
  while (d >= startDate && allDone(d)) {
    n++;
    d = addDays(d, -1);
  }
  return n;
}

/** 실행 중인 가이드 작업이 다루는 레슨 id */
function guideJobsRunning(): Set<string> {
  return new Set(jobs.filter((j) => j.kind === "guide" && j.status === "running").flatMap((j) => j.topics ?? []));
}

function todayView(date: string) {
  const { topics } = readCategories();
  const log = readDailyLog();
  const generating = guideJobsRunning();
  const tasks = dailyFor(date).map((t) => {
    const found = t.lesson ? guideItemFor(readGuide(t.topic.slug, t.lesson.id), t.index, t.task) : null;
    return {
    topic: t.topic,
    task: t.task,
    day: t.day,
    days: t.days,
    isPostDay: t.isPostDay,
    postDate: t.postDate,
    lesson: t.lesson ? { id: t.lesson.id, title: t.lesson.title, number: t.lesson.number, total: t.lesson.total, stage: t.lesson.stage, date: t.lesson.date, task: t.lesson.task } : null,
    post: t.post ? { status: t.post.status, slug: t.post.post?.slug ?? null, title: t.post.post?.title ?? null } : null,
    done: t.done,
    note: t.note ?? "",
    steps: t.steps,
    answers: t.answers,
    guide: found?.item ?? null,
    guideStale: !!found?.stale,
    guideGenerating: !!t.lesson && generating.has(t.lesson.id),
  };
  });
  // 선택한 날 기준 앞뒤 일주일의 실천 현황
  const week = Array.from({ length: 7 }, (_, i) => {
    const d = addDays(date, i - 3);
    return { date: d, topics: topics.map((t) => ({ slug: t.slug, color: t.color, done: !!log[d]?.[t.slug]?.done })) };
  });
  const events = topics
    .map((t) => ({ topic: t, event: readCurriculum(t.slug)?.event }))
    .filter((e): e is { topic: Topic; event: NonNullable<Curriculum["event"]> } => !!e.event);
  return { date, today: todayString(), tasks, week, streak: practiceStreak(), events };
}

function status() {
  const today = todayString();
  const { topics } = readCategories();
  const ahead = schedule(today, addDays(today, 90));
  const posts = allPosts();
  const published = getAllPostFiles().map(parsePostFile).filter((p) => isPublished(p, today));
  const claude = claudeCommand(["--version"]);
  const probe = spawnSync(claude.command, claude.args, { stdio: "ignore", shell: claude.shell });
  const hasClaude = !probe.error && probe.status === 0;
  return {
    today,
    todayPlan: ahead[0],
    todayPost: posts.find((p) => p.date === today) ?? null,
    week: ahead.slice(1, 8),
    streak: getStreak(published),
    counts: Object.fromEntries(["게시", "예약", "초안", "문제"].map((s) => [s, posts.filter((p) => p.status === s).length])),
    curricula: (() => {
      const empty = daysUntilEmpty(ahead);
      return topics.map((t) => {
        const c = readCurriculum(t.slug);
        const used = new Set(getAllPostFiles().map(parsePostFile).filter((p) => p.topic === t.slug && p.lesson).map((p) => p.lesson));
        const lessons = c ? allLessons(c) : [];
        return { ...t, lessons: lessons.length, done: lessons.filter((l) => used.has(l.id)).length, daysLeft: empty[t.slug] ?? null, hasCurriculum: !!c, event: c?.event ?? null };
      });
    })(),
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
  const topic = slug ? readCategories().topics.find((t) => t.slug === slug) : undefined;
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
  ["GET", /^\/api\/topics$/, () => readCategories().topics],

  // 카테고리
  [
    "GET",
    /^\/api\/categories$/,
    () => {
      const data = readCategories();
      const posts = getAllPostFiles().map(parsePostFile);
      return { ...data, topics: data.topics.map((t) => ({ ...t, posts: posts.filter((p) => p.topic === t.slug).length })) };
    },
  ],
  [
    "PUT",
    /^\/api\/categories$/,
    async (req) => {
      const body = await readJson<Categories>(req);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(body.startDate ?? "")) throw new HttpError(400, "시작일 형식이 잘못됐습니다");
      if (!Array.isArray(body.topics) || !body.topics.length) throw new HttpError(400, "카테고리가 하나 이상 있어야 합니다");
      const topics = body.topics.map((t) => ({
        slug: String(t.slug ?? "").trim(),
        name: String(t.name ?? "").trim(),
        description: String(t.description ?? "").trim(),
        color: String(t.color ?? "").trim(),
      }));
      for (const t of topics) {
        if (!/^[a-z0-9][a-z0-9-]{1,29}$/.test(t.slug)) throw new HttpError(400, `주소용 영문 이름이 잘못됐습니다: "${t.slug}" (영어 소문자·숫자·하이픈 2~30자)`);
        if (!t.name) throw new HttpError(400, `이름이 비어 있는 카테고리가 있습니다 (${t.slug})`);
        if (!/^#[0-9a-fA-F]{6}$/.test(t.color)) throw new HttpError(400, `색상 형식이 잘못됐습니다 (${t.name})`);
      }
      if (new Set(topics.map((t) => t.slug)).size !== topics.length) throw new HttpError(400, "주소용 영문 이름이 겹칩니다");
      // 글이 있는 카테고리를 지우면 그 글들이 갈 곳이 없어집니다.
      const posts = getAllPostFiles().map(parsePostFile);
      const removed = readCategories().topics.filter((old) => !topics.some((t) => t.slug === old.slug));
      const blocked = removed.filter((t) => posts.some((p) => p.topic === t.slug));
      if (blocked.length) throw new HttpError(409, `글이 있는 카테고리는 지울 수 없습니다: ${blocked.map((t) => t.name).join(", ")}`);
      fs.writeFileSync(CATEGORIES_FILE, `${JSON.stringify({ startDate: body.startDate, topics }, null, 2)}\n`);
      return readCategories();
    },
  ],

  // 커리큘럼
  [
    "GET",
    /^\/api\/curriculum$/,
    (_req, url) => {
      const topic = topicOrThrow(url.searchParams.get("topic"));
      const curriculum = readCurriculum(topic.slug);
      const today = todayString();
      const posts = getAllPostFiles().map(parsePostFile).filter((p) => p.topic === topic.slug && p.lesson);
      // 레슨별 상태: 글이 있으면 그 글, 없으면 달력에 배정된 날짜
      const planned = new Map(
        schedule(today, addDays(today, 730))
          .filter((d) => d.topic?.slug === topic.slug && d.lesson && !d.post)
          .map((d) => [d.lesson!.id, d.date]),
      );
      const lessonStatus = Object.fromEntries(
        (curriculum ? allLessons(curriculum) : []).map((l) => {
          const post = posts.find((p) => p.lesson === l.id);
          if (post) return [l.id, { status: post.draft ? "작성 중" : "완료", date: post.date, slug: post.slug }];
          return [l.id, planned.has(l.id) ? { status: "예정", date: planned.get(l.id) } : { status: "미배정" }];
        }),
      );
      return { topic, curriculum, lessonStatus };
    },
  ],
  [
    "PUT",
    /^\/api\/curriculum$/,
    async (req, url) => {
      const topic = topicOrThrow(url.searchParams.get("topic"));
      const body = await readJson<Curriculum>(req);
      const used = getAllPostFiles().map(parsePostFile).filter((p) => p.topic === topic.slug && p.lesson).map((p) => p.lesson!);
      const ids = new Set((body.stages ?? []).flatMap((s) => (s.lessons ?? []).map((l) => l.id)));
      const lost = used.filter((id) => !ids.has(id));
      if (lost.length) throw new HttpError(409, "이미 글로 쓴 레슨은 지울 수 없습니다");
      try {
        return writeCurriculum(topic.slug, { ...body, topic: topic.slug });
      } catch (err) {
        throw new HttpError(400, (err as Error).message);
      }
    },
  ],
  [
    "POST",
    /^\/api\/curriculum\/generate$/,
    async (req) => {
      const { topic, lessons, append, daily } = await readJson<{ topic: string; lessons?: number; append?: boolean; daily?: boolean }>(req);
      const t = topicOrThrow(topic);
      const guard = [path.join(ROOT, "content", "curriculum", `${t.slug}.json`)];
      if (daily) return startJob("curriculum", `커리큘럼: ${t.name} 매일 할 일 채우기`, "curriculum", ["--topic", t.slug, "--daily"], [t.slug], guard);
      const n = String(Math.min(60, Math.max(5, Number(lessons) || 30)));
      const args = ["--topic", t.slug, ...(append ? ["--append", n] : ["--lessons", n])];
      return startJob("curriculum", `커리큘럼: ${t.name} ${append ? `레슨 ${n}개 추가` : "설계"}`, "curriculum", args, [t.slug], guard);
    },
  ],

  // 매일 실천
  [
    "GET",
    /^\/api\/today$/,
    (_req, url) => {
      const date = url.searchParams.get("date") ?? todayString();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new HttpError(400, "날짜 형식이 잘못됐습니다");
      return todayView(date);
    },
  ],
  [
    "PUT",
    /^\/api\/daily$/,
    async (req) => {
      const { date, topic, done, note, steps, answers } = await readJson<{ date: string; topic: string; done: boolean; note?: string; steps?: number[]; answers?: Record<string, string> }>(req);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? "")) throw new HttpError(400, "날짜 형식이 잘못됐습니다");
      topicOrThrow(topic);
      writeDailyEntry(date, topic, {
        done: !!done,
        note: typeof note === "string" ? note.slice(0, 2000) : undefined,
        steps: Array.isArray(steps) ? steps.map(Number) : undefined,
        answers: answers && typeof answers === "object" ? Object.fromEntries(Object.entries(answers).map(([k, v]) => [String(k), String(v ?? "")])) : undefined,
      });
      return { ok: true, streak: practiceStreak() };
    },
  ],

  // 할 일 가이드: 레슨 하나(topic+lesson) 또는 그날의 모든 레슨(date)
  [
    "POST",
    /^\/api\/guide\/generate$/,
    async (req) => {
      const { topic, lesson, date, force } = await readJson<{ topic?: string; lesson?: string; date?: string; force?: boolean }>(req);
      const flag = force ? ["--force"] : [];
      if (lesson) {
        const t = topicOrThrow(topic ?? null);
        if (!/^[A-Za-z0-9_-]+$/.test(lesson)) throw new HttpError(400, "잘못된 레슨 id입니다");
        const title = readCurriculum(t.slug)?.stages.flatMap((s) => s.lessons).find((l) => l.id === lesson)?.title ?? lesson;
        return startJob("guide", `가이드: ${t.name} · ${title}`, "guide", ["--topic", t.slug, "--lesson", lesson, ...flag], [lesson]);
      }
      const d = date ?? todayString();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new HttpError(400, "날짜 형식이 잘못됐습니다");
      const busy = guideJobsRunning();
      const need = dailyFor(d).filter((t) => {
        if (!t.lesson || busy.has(t.lesson.id)) return false;
        const found = guideItemFor(readGuide(t.topic.slug, t.lesson.id), t.index, t.task);
        return force || !found || found.stale;
      });
      if (!need.length) throw new HttpError(409, "만들 가이드가 없습니다 (모두 있거나 만드는 중입니다)");
      return startJob("guide", `가이드: ${d} 할 일 ${need.length}개`, "guide", ["--date", d, "--only", need.map((t) => t.lesson!.id).join(","), ...flag], need.map((t) => t.lesson!.id));
    },
  ],

  // 달력
  [
    "GET",
    /^\/api\/calendar$/,
    (_req, url) => {
      const month = url.searchParams.get("month") ?? todayString().slice(0, 7);
      if (!/^\d{4}-\d{2}$/.test(month)) throw new HttpError(400, "월 형식이 잘못됐습니다");
      const from = `${month}-01`;
      const to = addDays(addDays(from, 31).slice(0, 7) + "-01", -1);
      const log = readDailyLog();
      const { topics } = readCategories();
      const days = schedule(from, to).map((d) => ({ ...d, practice: topics.map((t) => ({ slug: t.slug, color: t.color, done: !!log[d.date]?.[t.slug]?.done })) }));
      return { month, today: todayString(), days };
    },
  ],

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
    "POST",
    /^\/api\/jobs\/(\d+)\/stop$/,
    (_req, _url, [id]) => {
      const job = jobs.find((j) => j.id === Number(id));
      const child = processes.get(Number(id));
      if (!job || !child || job.status !== "running") throw new HttpError(404, "실행 중인 작업이 아닙니다");
      job.status = "stopped";
      job.log += "\n[사용자가 중지했습니다]";
      killTree(child);
      return { ok: true };
    },
  ],
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
  // 코드를 업데이트하면 바로 반영되도록 브라우저가 화면 파일을 캐시하지 않게 합니다.
  res.writeHead(200, { "Content-Type": `${MIME[path.extname(file)] ?? "application/octet-stream"}; charset=utf-8`, "Cache-Control": "no-store" });
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
          res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
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
// 대시보드를 끄면(Ctrl+C) 돌고 있던 작업도 함께 정리합니다.
process.on("SIGINT", () => {
  for (const child of processes.values()) killTree(child);
  process.exit(0);
});
server.listen(PORT, "127.0.0.1", () => {
  console.log(`✔ 관리자 대시보드: http://localhost:${PORT}  (이 창을 닫으면 대시보드도 꺼집니다)`);
});
