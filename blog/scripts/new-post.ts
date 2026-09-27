// 오늘 쓸 글의 빈 템플릿을 만듭니다. AI 없이 직접 쓸 때 사용하세요.
//   npm run new                      # 오늘 날짜 + 로테이션 주제
//   npm run new -- --topic money     # 주제 지정
//   npm run new -- --date 2026-10-02 # 날짜 지정 (미리 써두고 예약 게시)
import fs from "node:fs";
import path from "node:path";
import { experiencePlaceholder, fail, parseArgs, postPath, resolveDateAndTopic, writePost } from "./lib";

const args = parseArgs();
const { date, topic } = resolveDateAndTopic(args);
const file = postPath(date, topic);
if (fs.existsSync(file)) fail(`이미 파일이 있습니다: ${path.relative(process.cwd(), file)}`);

writePost(file, date, topic, {
  title: args.title ?? `${topic.name}: 오늘의 주제`,
  summary: "검색 결과에 보일 한두 문장 요약 (160자 이하)",
  tags: [topic.name],
  sources: [],
  body: `
<!-- TODO: 도입 2~3문장. 누구의 어떤 고민을 위한 글인지, 결론을 먼저 쓰세요. -->

## 이 글에서 알 수 있는 것

<!-- TODO: 독자가 이 글에서 얻는 것을 3줄로 쓰세요. -->

## 핵심 정리

<!-- TODO: 개념, 예시, 표 등으로 핵심을 정리하세요. 소제목은 독자가 검색할 질문 형태로. -->

## 따라 해보기

<!-- TODO: 준비물·소요 시간 → 번호 단계 → 완료 기준. 독자가 그대로 따라 할 수 있게. -->

## 직접 해보기

${experiencePlaceholder([
  "실제로 무엇을 해봤나요? (명령어, 계산, 예문, 스크린샷 등)",
  "결과는 어땠고, 예상과 달랐던 점은 무엇인가요?",
  "내 상황에 적용하면 어떻게 되나요?",
])}

## 자주 하는 실수

<!-- TODO: 처음 하는 사람이 헷갈리거나 실수하기 쉬운 점과 해결 방법을 쓰세요. -->

## 다음 단계

<!-- TODO: 다음 ${topic.name} 차례에 이어서 볼 내용을 쓰세요. -->
`,
});

console.log(`✔ 템플릿 생성: ${path.relative(process.cwd(), file)} (${topic.name})`);
console.log("  내용을 채우고 draft: false로 바꾼 뒤 npm run check로 확인하세요.");
