// 원하는 주제들의 블로그 시장성을 분석하고 비교표를 만듭니다.
//   npm run research -- "투자" "회사원 업무자동화" "일본어"
// 주제마다 research/<날짜>-<주제>.md(리포트)와 .json(점수)이 생기고,
// 마지막에 research/<날짜>-비교.md 에 종합 순위가 정리됩니다.
// 네이버 API 키가 있으면 실측 검색량을, 없으면 웹 조사 기반 추정치를 씁니다.
import fs from "node:fs";
import path from "node:path";
import { todayString } from "../src/lib/dates";
import { ensureClaudeCli, loadPrompt, NAVER_TOOL, runClaude, runWithLimit } from "./claude";
import { fail, parseArgs, positionals, toFileSlug } from "./lib";
import { CRITERIA, type ResearchResult, totalScore, validateResearch, verdict } from "./scoring";

const RESEARCH_DIR = path.join(process.cwd(), "research");
const args = parseArgs();
const topics = positionals();
if (topics.length === 0) fail('분석할 주제를 넣어주세요. 예: npm run research -- "투자" "일본어"');
ensureClaudeCli();

const date = args.date ?? todayString();
const profilePath = path.join(RESEARCH_DIR, "profile.md");
const profile = fs.existsSync(profilePath) ? fs.readFileSync(profilePath, "utf8") : "(프로필 없음)";
const criteria = CRITERIA.map((c) => `- ${c.key} (${c.name}, 가중치 ${c.weight * 100}%): ${c.guide}`).join("\n");

type Outcome = { topic: string; jsonFile: string; reportFile: string; result?: ResearchResult; error?: string };

async function analyze(topic: string): Promise<Outcome> {
  const base = `research/${date}-${toFileSlug(topic)}`;
  const reportFile = `${base}.md`;
  const jsonFile = `${base}.json`;
  const prompt = loadPrompt("research", { topic, date, reportFile, jsonFile, profile, criteria });
  // 같은 날 재분석하면 이전 결과를 지우고 새로 씁니다 (실패 시 옛 결과가 남아 헷갈리지 않도록).
  for (const f of [reportFile, jsonFile]) fs.rmSync(f, { force: true });

  console.log(`… [${topic}] 조사 시작`);
  const { code, output } = await runClaude(prompt, {
    allowedTools: ["WebSearch", "WebFetch", "Read", "Glob", "Grep", NAVER_TOOL, `Edit(./${reportFile})`, `Edit(./${jsonFile})`],
    model: args.model,
  });
  if (code !== 0) return { topic, jsonFile, reportFile, error: `claude 종료 코드 ${code}` };
  if (!fs.existsSync(jsonFile)) return { topic, jsonFile, reportFile, error: "점수 JSON이 만들어지지 않았습니다" };

  let data: unknown;
  try {
    data = JSON.parse(fs.readFileSync(jsonFile, "utf8"));
  } catch {
    return { topic, jsonFile, reportFile, error: "점수 JSON을 읽을 수 없습니다" };
  }
  const errors = validateResearch(data);
  if (errors.length) return { topic, jsonFile, reportFile, error: errors.join(", ") };

  console.log(`✔ [${topic}] ${output.trim().split("\n").slice(-3).join(" / ")}`);
  return { topic, jsonFile, reportFile, result: data as ResearchResult };
}

function comparisonMarkdown(outcomes: Outcome[]): string {
  const done = outcomes
    .filter((o): o is Outcome & { result: ResearchResult } => !!o.result)
    .map((o) => ({ ...o, total: totalScore(o.result) }))
    .sort((a, b) => b.total - a.total);

  const header = `| 순위 | 주제 | 종합 | 판정 | ${CRITERIA.map((c) => c.name).join(" | ")} | 데이터 |`;
  const divider = `|${" --- |".repeat(CRITERIA.length + 5)}`;
  const rows = done.map(
    (o, i) =>
      `| ${i + 1} | [${o.topic}](${path.basename(o.reportFile)}) | **${o.total}** | ${verdict(o.total)} | ${CRITERIA.map((c) => o.result.scores[c.key].score).join(" | ")} | ${o.result.dataMode === "naver" ? "실측" : "추정"} |`,
  );

  const summaries = done.map((o) => `### ${o.topic} — ${o.total}점 (${verdict(o.total)})\n\n${o.result.summary}\n`);
  const failed = outcomes.filter((o) => o.error).map((o) => `- ${o.topic}: ${o.error}`);

  return [
    `# 블로그 주제 시장 분석 비교 (${date})`,
    "",
    `종합 점수는 항목별 1~5점에 가중치(${CRITERIA.map((c) => `${c.name} ${c.weight * 100}%`).join(", ")})를 곱해 100점으로 환산했습니다.`,
    "70점 이상 GO, 55~69점 보류, 55점 미만 제외. 가중치는 `scripts/scoring.ts`에서 바꿀 수 있습니다.",
    "",
    header,
    divider,
    ...rows,
    "",
    "## 주제별 결론",
    "",
    ...summaries,
    ...(failed.length ? ["## 분석 실패", "", ...failed, ""] : []),
    "## 다음 단계",
    "",
    "1. 주제별 리포트의 근거와 추천 세부 방향을 읽고 운영할 주제를 고릅니다.",
    "2. `src/blog.config.ts`의 TOPICS에 등록합니다.",
    "3. `npm run plan -- --topic <slug>`로 콘텐츠 계획을 만듭니다.",
    "",
  ].join("\n");
}

async function main() {
  fs.mkdirSync(RESEARCH_DIR, { recursive: true });
  console.log(`주제 ${topics.length}개 분석 (동시 3개, 주제당 몇 분 걸립니다)`);
  const current = await runWithLimit(topics, 3, analyze);

  // 같은 날 따로 분석한 주제도 비교표에 함께 넣습니다.
  const earlier: Outcome[] = fs
    .readdirSync(RESEARCH_DIR)
    .filter((f) => f.startsWith(`${date}-`) && f.endsWith(".json"))
    .map((f) => `research/${f}`)
    .filter((jsonFile) => !current.some((o) => o.jsonFile === jsonFile))
    .flatMap((jsonFile) => {
      try {
        const result = JSON.parse(fs.readFileSync(jsonFile, "utf8")) as ResearchResult;
        if (validateResearch(result).length) return [];
        return [{ topic: result.topic, jsonFile, reportFile: jsonFile.replace(/\.json$/, ".md"), result }];
      } catch {
        return [];
      }
    });
  const outcomes = [...current, ...earlier];

  const comparisonFile = path.join(RESEARCH_DIR, `${date}-비교.md`);
  fs.writeFileSync(comparisonFile, comparisonMarkdown(outcomes));
  console.log(`\n✔ 비교표: ${path.relative(process.cwd(), comparisonFile)}`);
  for (const o of outcomes) {
    if (o.result) console.log(`  ${totalScore(o.result)}점 ${verdict(totalScore(o.result))}  ${o.topic}  → ${o.reportFile}`);
    else console.log(`  실패  ${o.topic}: ${o.error}`);
  }
}

main();
