// content/plan/<주제>.md 콘텐츠 계획 파일을 읽고 고칩니다.
//
// ## 대기
// - [ ] 소재 제목
//   - 키워드: ...
//   - 의도: ...
// ## 완료
// - [x] 2026-10-01 소재 제목 → 2026-10-01-money.md
import fs from "node:fs";
import path from "node:path";
import type { Topic } from "../src/blog.config";

export const PLAN_DIR = path.join(process.cwd(), "content", "plan");
const PENDING = "## 대기";
const DONE = "## 완료";

export type PlanItem = { title: string; details: string[] };

export function planPath(topic: Topic): string {
  return path.join(PLAN_DIR, `${topic.slug}.md`);
}

export function createPlanFile(topic: Topic): void {
  fs.mkdirSync(PLAN_DIR, { recursive: true });
  fs.writeFileSync(
    planPath(topic),
    [
      `# ${topic.name} 콘텐츠 계획`,
      "",
      "<!-- npm run plan 이 대기 목록에 소재를 추가합니다. 순서를 바꾸거나 지워서 승인하세요. npm run draft 는 대기 맨 위부터 씁니다. -->",
      "",
      PENDING,
      "",
      DONE,
      "",
    ].join("\n"),
  );
}

function sectionRange(lines: string[], heading: string): [number, number] {
  const start = lines.findIndex((l) => l.trim() === heading);
  if (start === -1) return [-1, -1];
  const end = lines.findIndex((l, i) => i > start && l.startsWith("## "));
  return [start, end === -1 ? lines.length : end];
}

/** 대기 목록의 항목들 (위에서부터 순서대로) */
export function pendingItems(file: string): PlanItem[] {
  if (!fs.existsSync(file)) return [];
  const lines = fs.readFileSync(file, "utf8").split("\n");
  const [start, end] = sectionRange(lines, PENDING);
  const items: PlanItem[] = [];
  for (let i = start + 1; start !== -1 && i < end; i++) {
    const m = lines[i].match(/^- \[ \] (.+)$/);
    if (m) items.push({ title: m[1].trim(), details: [] });
    else if (items.length && /^\s+\S/.test(lines[i])) items[items.length - 1].details.push(lines[i].trim().replace(/^- /, ""));
  }
  return items;
}

/** 대기 목록을 주어진 항목들로 통째로 바꿉니다 (순서 변경·삭제·직접 추가에 사용). */
export function savePending(file: string, items: PlanItem[]): void {
  const lines = fs.readFileSync(file, "utf8").split("\n");
  const [start, end] = sectionRange(lines, PENDING);
  if (start === -1) throw new Error("계획 파일에 '## 대기' 섹션이 없습니다");
  const body = items.flatMap((i) => [`- [ ] ${i.title.trim()}`, ...i.details.map((d) => `  - ${d.trim()}`)]);
  lines.splice(start + 1, end - start - 1, "", ...body, "");
  fs.writeFileSync(file, lines.join("\n"));
}

/** 완료 목록의 줄들 (최신이 위) */
export function doneItems(file: string): string[] {
  if (!fs.existsSync(file)) return [];
  const lines = fs.readFileSync(file, "utf8").split("\n");
  const [start, end] = sectionRange(lines, DONE);
  return start === -1 ? [] : lines.slice(start + 1, end).filter((l) => l.startsWith("- [x] ")).map((l) => l.slice(6));
}

export function doneCount(file: string): number {
  return doneItems(file).length;
}

/** 대기에서 항목을 빼고 완료 목록 맨 위에 기록합니다. */
export function markDone(file: string, item: PlanItem, date: string, postFile: string): void {
  const lines = fs.readFileSync(file, "utf8").split("\n");
  const at = lines.findIndex((l) => l === `- [ ] ${item.title}`);
  if (at === -1) return;
  let end = at + 1;
  while (end < lines.length && /^\s+\S/.test(lines[end])) end++;
  lines.splice(at, end - at);

  const [doneStart] = sectionRange(lines, DONE);
  const entry = `- [x] ${date} ${item.title} → ${postFile}`;
  if (doneStart === -1) {
    lines.push("", DONE, "", entry);
  } else {
    // "## 완료" 아래 빈 줄 다음, 목록 맨 위에 넣습니다.
    let pos = doneStart + 1;
    if (lines[pos] === "") pos++;
    else lines.splice(pos++, 0, "");
    lines.splice(pos, 0, entry);
  }
  fs.writeFileSync(file, lines.join("\n"));
}
