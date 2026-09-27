import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fail } from "./lib";
import { claudeCommand } from "./proc";

/** prompts/<name>.md 를 읽어 {{키}} 자리를 값으로 채웁니다. */
export function loadPrompt(name: string, values: Record<string, string>): string {
  const template = fs.readFileSync(path.join(process.cwd(), "prompts", `${name}.md`), "utf8");
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => values[key] ?? `{{${key}}}`);
}

export function ensureClaudeCli(): void {
  const cmd = claudeCommand(["--version"]);
  const r = spawnSync(cmd.command, cmd.args, { stdio: "ignore", shell: cmd.shell });
  if (r.error || r.status !== 0) {
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

/** Claude가 도구를 쓸 때마다 진행 상황을 한 줄로 보여줍니다 (대시보드 작업 로그에 실시간 표시). */
function describeTool(name: string, input: Record<string, unknown>): string {
  const str = (v: unknown) => String(v ?? "").slice(0, 90);
  const base = (v: unknown) => str(v).split(/[\\/]/).pop();
  switch (name) {
    case "WebSearch":
      return `🔎 웹 검색: ${str(input.query)}`;
    case "WebFetch":
      return `🌐 페이지 확인: ${str(input.url)}`;
    case "Read":
      return `📖 읽기: ${base(input.file_path)}`;
    case "Glob":
    case "Grep":
      return `🔍 파일 찾기: ${str(input.pattern)}`;
    case "Edit":
    case "Write":
      return `✏️ 작성: ${base(input.file_path)}`;
    case "Bash":
      return String(input.command ?? "").includes("naver") ? `📊 네이버 데이터: ${str(input.command).replace(/^npm run -s naver -- /, "")}` : `⚙️ 실행: ${str(input.command)}`;
    default:
      return `· ${name}`;
  }
}

/**
 * Claude CLI를 헤드리스 모드(`claude -p`)로 실행합니다. 구독 계정으로 동작해 추가 비용이 없습니다.
 * 실시간 이벤트(stream-json)를 읽어 도구 사용을 진행 로그로 출력하고, 끝나면 최종 답변을 반환합니다.
 */
export function runClaude(prompt: string, opts: RunOptions): Promise<{ code: number; output: string }> {
  const cmd = claudeCommand([
    "-p",
    "--output-format",
    "stream-json",
    "--verbose",
    "--allowedTools",
    ...opts.allowedTools,
    ...(opts.model ? ["--model", opts.model] : []),
  ]);
  const started = Date.now();
  const elapsed = () => {
    const s = Math.round((Date.now() - started) / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  };
  return new Promise((resolve) => {
    const child = spawn(cmd.command, cmd.args, { cwd: process.cwd(), shell: cmd.shell, stdio: ["pipe", "pipe", "inherit"] });
    let buffer = "";
    let result: { text: string; isError: boolean } | null = null;
    const handle = (line: string) => {
      if (!line.trim()) return;
      let event: { type?: string; message?: { content?: { type: string; name?: string; input?: Record<string, unknown> }[] }; result?: string; is_error?: boolean };
      try {
        event = JSON.parse(line);
      } catch {
        return;
      }
      if (event.type === "assistant") {
        for (const c of event.message?.content ?? []) {
          if (c.type === "tool_use" && c.name) console.log(`  [${elapsed()}] ${describeTool(c.name, c.input ?? {})}`);
        }
      } else if (event.type === "result") {
        result = { text: String(event.result ?? ""), isError: !!event.is_error };
      }
    };
    child.stdout?.on("data", (d: Buffer) => {
      buffer += d.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      lines.forEach(handle);
    });
    child.on("error", (err) => resolve({ code: 1, output: err.message }));
    child.on("close", (code) => {
      handle(buffer);
      const r = result as { text: string; isError: boolean } | null;
      if (r && opts.inheritOutput) console.log(`\n${r.text}`);
      resolve({ code: r?.isError ? 1 : (code ?? 1), output: r?.text ?? "" });
    });
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
