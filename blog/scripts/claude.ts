import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fail } from "./lib";

/** prompts/<name>.md 를 읽어 {{키}} 자리를 값으로 채웁니다. */
export function loadPrompt(name: string, values: Record<string, string>): string {
  const template = fs.readFileSync(path.join(process.cwd(), "prompts", `${name}.md`), "utf8");
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => values[key] ?? `{{${key}}}`);
}

export function ensureClaudeCli(): void {
  if (spawnSync("claude", ["--version"], { stdio: "ignore" }).error) {
    fail("claude 명령을 찾을 수 없습니다. `npm install -g @anthropic-ai/claude-code` 후 `claude`로 한 번 로그인하세요.");
  }
}

/** 네이버 데이터 도구를 Claude가 부를 수 있게 하는 권한 규칙 */
export const NAVER_TOOL = "Bash(npm run -s naver -- *)";

type RunOptions = {
  /** 미리 허용할 도구. 목록에 없는 도구는 자동으로 거부됩니다. */
  allowedTools: string[];
  model?: string;
  /** true면 Claude의 최종 답변을 터미널에 바로 보여줍니다. false면 모아서 반환합니다. */
  inheritOutput?: boolean;
};

/** Claude CLI를 헤드리스 모드(`claude -p`)로 실행합니다. 구독 계정으로 동작해 추가 비용이 없습니다. */
export function runClaude(prompt: string, opts: RunOptions): Promise<{ code: number; output: string }> {
  const args = ["-p", "--allowedTools", ...opts.allowedTools, ...(opts.model ? ["--model", opts.model] : [])];
  return new Promise((resolve) => {
    const child = spawn("claude", args, {
      cwd: process.cwd(),
      stdio: ["pipe", opts.inheritOutput ? "inherit" : "pipe", "inherit"],
    });
    let output = "";
    child.stdout?.on("data", (d) => (output += d));
    child.on("close", (code) => resolve({ code: code ?? 1, output }));
    child.stdin?.end(prompt);
  });
}

/** 여러 작업을 동시에 최대 limit개씩 실행합니다. */
export async function runWithLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return results;
}
