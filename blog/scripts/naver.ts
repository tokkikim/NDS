// 네이버 검색 데이터 도구. 시장 분석·계획 단계에서 Claude가 직접 호출합니다. 사람이 써도 됩니다.
//   npm run -s naver -- keywords 재테크 ISA계좌      연관 키워드 + 월간 검색량 + 경쟁도 (검색광고 API)
//   npm run -s naver -- trend 재테크 ISA계좌         최근 12개월 검색 추세 (데이터랩 API)
//   npm run -s naver -- bid ISA계좌 연금저축          모바일 3위 노출 평균 입찰가 (광고 단가 참고치)
// 키가 없으면 {"available": false}를 출력하고 정상 종료합니다. 발급 방법은 README 참고.
import crypto from "node:crypto";
import fs from "node:fs";

if (fs.existsSync(".env.local")) process.loadEnvFile(".env.local");

const AD_BASE = "https://api.searchad.naver.com";
const env = process.env;

function print(value: unknown): void {
  console.log(JSON.stringify(value, null, 1));
}

function unavailable(reason: string): never {
  print({ available: false, reason });
  process.exit(0);
}

/** 네이버 검색광고 API 서명 요청 */
async function adRequest(method: "GET" | "POST", uri: string, query = "", body?: unknown): Promise<unknown> {
  const { NAVER_AD_API_KEY: key, NAVER_AD_SECRET: secret, NAVER_AD_CUSTOMER_ID: customer } = env;
  if (!key || !secret || !customer) unavailable("NAVER_AD_API_KEY / NAVER_AD_SECRET / NAVER_AD_CUSTOMER_ID 환경변수 없음");

  const timestamp = Date.now().toString();
  const signature = crypto.createHmac("sha256", secret).update(`${timestamp}.${method}.${uri}`).digest("base64");
  const res = await fetch(`${AD_BASE}${uri}${query}`, {
    method,
    headers: {
      "X-Timestamp": timestamp,
      "X-API-KEY": key,
      "X-Customer": customer,
      "X-Signature": signature,
      ...(body ? { "Content-Type": "application/json; charset=UTF-8" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`검색광고 API ${res.status}: ${await res.text()}`);
  return res.json();
}

// 검색량이 10 미만이면 API가 "< 10" 문자열을 줍니다.
const count = (v: unknown): number => (typeof v === "number" ? v : 5);

type KeywordRow = {
  relKeyword: string;
  monthlyPcQcCnt: number | string;
  monthlyMobileQcCnt: number | string;
  monthlyAvePcClkCnt: number | string;
  monthlyAveMobileClkCnt: number | string;
  compIdx: string;
  plAvgDepth: number;
};

/** 연관 키워드와 월간 검색량. 한 번에 힌트 5개까지라 나눠서 요청합니다. */
async function keywords(hints: string[], limit = 60) {
  const cleaned = [...new Set(hints.map((h) => h.replace(/\s+/g, "")).filter(Boolean))];
  const rows = new Map<string, KeywordRow>();
  for (let i = 0; i < cleaned.length; i += 5) {
    const q = `?hintKeywords=${encodeURIComponent(cleaned.slice(i, i + 5).join(","))}&showDetail=1`;
    const data = (await adRequest("GET", "/keywordstool", q)) as { keywordList?: KeywordRow[] };
    for (const r of data.keywordList ?? []) rows.set(r.relKeyword, r);
  }
  const list = [...rows.values()]
    .map((r) => ({
      keyword: r.relKeyword,
      monthly: count(r.monthlyPcQcCnt) + count(r.monthlyMobileQcCnt),
      mobileShare: Math.round((count(r.monthlyMobileQcCnt) / Math.max(1, count(r.monthlyPcQcCnt) + count(r.monthlyMobileQcCnt))) * 100),
      adClicks: Math.round(count(r.monthlyAvePcClkCnt) + count(r.monthlyAveMobileClkCnt)),
      adCompetition: r.compIdx,
      adDepth: r.plAvgDepth,
    }))
    .sort((a, b) => b.monthly - a.monthly);
  print({
    available: true,
    source: "네이버 검색광고 키워드도구 (월간 검색량 = PC + 모바일, 최근 30일)",
    hints: cleaned,
    total: list.length,
    keywords: list.slice(0, limit),
  });
}

/** 최근 12개월 월별 상대 검색량(0~100)과 성장률. 키워드끼리 상대 비교가 됩니다 (최대 5개). */
async function trend(words: string[]) {
  const { NAVER_CLIENT_ID: id, NAVER_CLIENT_SECRET: secret } = env;
  if (!id || !secret) unavailable("NAVER_CLIENT_ID / NAVER_CLIENT_SECRET 환경변수 없음");

  const end = new Date();
  const start = new Date(end.getFullYear() - 1, end.getMonth(), 1);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  const res = await fetch("https://openapi.naver.com/v1/datalab/search", {
    method: "POST",
    headers: { "X-Naver-Client-Id": id, "X-Naver-Client-Secret": secret, "Content-Type": "application/json" },
    body: JSON.stringify({
      startDate: fmt(start),
      endDate: fmt(end),
      timeUnit: "month",
      keywordGroups: words.slice(0, 5).map((w) => ({ groupName: w, keywords: [w] })),
    }),
  });
  if (!res.ok) throw new Error(`데이터랩 API ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { results: { title: string; data: { period: string; ratio: number }[] }[] };

  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  print({
    available: true,
    source: "네이버 데이터랩 검색어 트렌드 (요청한 키워드 중 최대값을 100으로 한 상대값)",
    results: data.results.map((r) => {
      const ratios = r.data.map((d) => d.ratio);
      const first = avg(ratios.slice(0, 3));
      const last = avg(ratios.slice(-3));
      return {
        keyword: r.title,
        average: Math.round(avg(ratios) * 10) / 10,
        growth: first ? `${Math.round(((last - first) / first) * 100)}%` : "n/a",
        peakMonth: r.data.reduce((a, b) => (b.ratio > a.ratio ? b : a), r.data[0])?.period,
        monthly: r.data.map((d) => `${d.period.slice(0, 7)}:${Math.round(d.ratio)}`).join(" "),
      };
    }),
  });
}

/** 모바일 검색 3위 노출 평균 입찰가(원). 광고주가 비싸게 사는 키워드일수록 광고 단가가 높습니다. */
async function bid(words: string[]) {
  const data = (await adRequest("POST", "/estimate/average-position-bid/keyword", "", {
    device: "MOBILE",
    items: words.slice(0, 20).map((w) => ({ key: w.replace(/\s+/g, ""), position: 3 })),
  })) as { estimate?: { keyword: string; bid: number }[] };
  print({
    available: true,
    source: "네이버 검색광고 평균 입찰가 추정 (모바일 3위, 원)",
    bids: (data.estimate ?? []).map((e) => ({ keyword: e.keyword, bid: e.bid })),
  });
}

const [command, ...words] = process.argv.slice(2);
const commands: Record<string, (w: string[]) => Promise<void>> = { keywords, trend, bid };
if (!command || !commands[command] || words.length === 0) {
  console.error("사용법: npm run -s naver -- <keywords|trend|bid> 키워드1 키워드2 ...");
  process.exit(1);
}
commands[command](words).catch((err: Error) => {
  // Claude가 읽고 판단할 수 있도록 오류도 JSON으로 출력합니다.
  print({ available: false, error: err.message });
});
