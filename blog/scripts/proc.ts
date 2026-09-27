// Windows·macOS·Linux 어디서든 같은 방식으로 환경변수를 읽고 명령을 실행하기 위한 도우미.
import fs from "node:fs";
import path from "node:path";

const IS_WINDOWS = process.platform === "win32";

/** .env.local 을 읽어 process.env 에 넣습니다. (이미 설정된 값은 덮어쓰지 않음) */
export function loadEnv(file = ".env.local"): void {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m || process.env[m[1]] !== undefined) continue;
    process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, "$2");
  }
}

/**
 * claude CLI 실행 인자. Windows에서 npm으로 설치한 claude는 claude.cmd라서 셸을 거쳐야 하고,
 * 이때 공백·괄호가 든 인자(예: "Bash(npm run -s naver -- *)")가 쪼개지지 않도록 따옴표로 감쌉니다.
 */
export function claudeCommand(args: string[]): { command: string; args: string[]; shell: boolean } {
  if (!IS_WINDOWS) return { command: "claude", args, shell: false };
  return { command: "claude", args: args.map((a) => `"${a.replace(/"/g, '\\"')}"`), shell: true };
}

/** npm을 거치지 않고 tsx로 스크립트를 직접 실행하는 인자 (Windows에서 npm.cmd 문제를 피함). */
export function tsxCommand(script: string, args: string[]): { command: string; args: string[] } {
  const cli = path.join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs");
  return { command: process.execPath, args: [cli, script, ...args] };
}
