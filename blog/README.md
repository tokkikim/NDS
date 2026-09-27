# 매일 한 걸음 공부노트

세 가지 주제를 하루에 하나씩 돌아가며 공부하고 기록하는, 직접 운영하는 블로그입니다.
AI(Claude CLI)는 **조사와 초안**을 맡고, **직접 해본 경험과 사실 확인**은 사람이 합니다.
검토하지 않은 글은 빌드 단계에서 막혀서 게시되지 않습니다.

**운영비 0원**이 기본입니다.

| 항목 | 사용하는 것 | 비용 |
|---|---|---|
| 호스팅 | Cloudflare Pages (정적 사이트, 상업적 이용 가능) | 무료 |
| 주소 | `프로젝트명.pages.dev` | 무료 |
| 자동화 | GitHub Actions | 무료 |
| AI 초안 | 이미 쓰고 있는 Claude 구독의 CLI (`claude -p`) | 추가 비용 없음 |
| 썸네일·폰트 | 빌드할 때 자동 생성, Pretendard(OFL) | 무료 |
| 개인 도메인 | 애드센스 신청할 때만 필요 (연 1~2만 원) | 선택 |

## 전체 흐름

```
[1] 시장 분석 (주제 정할 때)   npm run research -- "주제A" "주제B"
      주제별 검색 수요·경쟁·수익성·AI 대체 내성·확장성·적합성 점수 → 비교표 → 운영할 주제 결정
[2] 카테고리·커리큘럼          대시보드 "카테고리"에 등록 → "커리큘럼"에서 AI 설계(단계 → 레슨) 후 내가 수정·승인
      달력이 레슨을 카테고리 차례가 오는 날에 순서대로 배정 → 날마다 "오늘 할 일"이 정해짐
[3] 초안 (매일)                npm run draft
      달력에 배정된 오늘의 레슨으로 Claude CLI가 조사·출처 확인 후 초안 작성 (draft: true)
[4] 검토 (매일)                직접 해보기 + 스크린샷(선택) + 사실 확인 + TODO 삭제 + draft: false
[5] 게시                       git push → Cloudflare Pages가 검사 → 빌드 → 배포
      날짜가 미래인 글은 매일 00:05 KST 재빌드 때 자동 공개
```

## 관리자 대시보드

대시보드는 **내 PC에서 직접 실행**해야 열립니다. (Node.js 20 이상 필요)

```bash
git clone https://github.com/tokkikim/NDS.git     # 처음 한 번 (이미 있으면 git pull)
cd NDS
git checkout claude/sweet-lamport-3lgbzt          # main에 합치기 전까지
cd blog                                           # ← 꼭 blog 폴더 안에서
npm install                                       # 처음 한 번
npm run admin                                     # → 브라우저에서 http://localhost:4000
```

- 터미널 창을 닫으면 대시보드도 꺼집니다. 쓰는 동안 열어두세요.
- 4000번 포트를 다른 프로그램이 쓰고 있으면 `npm run admin -- --port 4001` 후 http://localhost:4001
- Windows(PowerShell·cmd)에서도 같은 명령으로 동작합니다.

아래 명령들을 화면에서 버튼으로 쓸 수 있습니다. 오래 걸리는 작업(시장분석·커리큘럼·AI 초안)은 백그라운드에서 돌고, 오른쪽 아래 작업 패널에서 진행 로그를 볼 수 있습니다.

| 탭 | 할 수 있는 것 |
|---|---|
| 홈 | 오늘 할 일(카테고리·레슨·할 일)과 초안 버튼, 다음 7일, 커리큘럼 진행률·레슨 소진 알림, 연속 공부 일수, 도구 상태 |
| 달력 | 월별 달력. 날짜마다 카테고리·레슨·상태(게시/초안/오늘/예정/놓침), 날짜를 눌러 할 일 보기·그 날짜로 초안 만들기 |
| 시장분석 | 주제 입력 → 분석 실행, 날짜별 비교표, 행을 누르면 리포트 전문, 주제별 재분석, "카테고리로 등록" |
| 카테고리 | 카테고리 추가·수정·삭제(글이 있으면 불가)·순서 변경, 순환 시작일 |
| 커리큘럼 | 카테고리별 목표·단계·레슨, 레슨마다 상태와 배정 날짜, 수정·추가·삭제·순서 변경, AI로 설계/이어서 추가 |
| 글 | AI 초안/빈 템플릿 만들기(주제·날짜·소재 지정), 글 목록과 상태, 편집기(미리보기·검사 결과·이미지 넣기·게시 준비) |
| 키워드 | 네이버 연관 키워드·검색량, 12개월 추세, 광고 입찰가 조회 |
| 프로필 | 운영자 프로필 편집 |

"게시 준비"는 검사를 통과할 때만 `draft: false`로 바꿉니다. 실제 배포는 지금처럼 `git push`로 합니다.

## [1] 시장 분석

```bash
npm run research -- "투자" "회사원 업무자동화" "일본어"
```

- 주제마다 `research/<날짜>-<주제>.md`(리포트)와 `.json`(점수)이 생기고, `research/<날짜>-비교.md`에 순위가 정리됩니다.
- 리포트 내용: 결론, 점수 근거, 키워드별 검색량, 경쟁 현황, 입문자 질문, 수익화 방법, 개인 블로그가 이길 수 있는 틈새, 첫 30개 소재, 위험 요소, 출처.
- **분석 전에 `research/profile.md`를 채워두세요.** "운영자 적합성" 점수와 틈새 추천이 정확해집니다.
- 점수 가중치와 판정 기준(70점 이상 GO)은 `scripts/scoring.ts`, 조사 지시는 `prompts/research.md`에서 바꿉니다.

| 항목 | 가중치 | 데이터 |
|---|---|---|
| 검색 수요 | 25% | 네이버 검색광고 월간 검색량, 데이터랩 12개월 추세 |
| 경쟁 여유 | 20% | 실제 검색 결과 상위 사이트 조사 |
| 수익성 | 20% | 광고 입찰가, 광고 경쟁도, 제휴 상품 조사 |
| AI 대체 내성 | 15% | 질문 유형 분석 (AI 한 줄 답변 vs 직접 경험 필요) |
| 확장성 | 10% | 연관 키워드·하위 소재의 폭 |
| 운영자 적합성 | 10% | `research/profile.md` |

## [2] 카테고리와 커리큘럼

- **카테고리**: `content/topics.json` (대시보드 "카테고리" 탭에서 편집). 위에서부터 하루씩 돌아가며 씁니다.
- **커리큘럼**: `content/curriculum/<카테고리>.json`. 목표 → 단계 → 레슨 순서가 정해진 학습 계획입니다.
  - 레슨 1개 = 글 1편. 레슨의 "할 일"은 같은 카테고리가 다시 돌아올 때(카테고리 3개면 3일 뒤)까지 실천할 분량입니다.
  - 초안을 만들면 글에 `lesson: <레슨 id>`가 붙어 커리큘럼과 연결됩니다.
- **달력**: 지난 날은 실제로 쓴 글 기준, 오늘부터는 아직 안 쓴 레슨을 카테고리 차례가 오는 날에 순서대로 배정합니다.
  하루를 놓쳐도 레슨은 사라지지 않고 같은 카테고리의 다음 차례로 밀립니다.

```bash
npm run curriculum -- --topic marathon               # AI로 커리큘럼 설계 (레슨 30개)
npm run curriculum -- --topic marathon --lessons 45
npm run curriculum -- --topic marathon --append 15   # 기존 뒤에 레슨 15개 이어서 추가
```

다시 설계해도 이미 글로 쓴 레슨은 그대로 보존되고, 지울 수도 없습니다. 프로필을 채운 뒤 다시 설계하면 내 수준에 맞게 바뀝니다.

## 네이버 API 키 (무료)

시장 분석과 커리큘럼 설계에서 실제 검색량을 쓰려면 `.env.local`에 넣으세요. 없으면 웹 조사 기반 "추정"으로 표시됩니다.

| 키 | 발급 |
|---|---|
| `NAVER_AD_API_KEY`, `NAVER_AD_SECRET`, `NAVER_AD_CUSTOMER_ID` | [네이버 검색광고](https://searchad.naver.com) 가입(광고비 결제 불필요) → 도구 → API 사용 관리 |
| `NAVER_CLIENT_ID`, `NAVER_CLIENT_SECRET` | [네이버 개발자센터](https://developers.naver.com) → 애플리케이션 등록 → API: 데이터랩(검색어트렌드) |

직접 조회도 됩니다: `npm run -s naver -- keywords 재테크 ISA계좌` / `trend` / `bid`

## 시작하기

```bash
cd blog
npm install
cp .env.example .env.local   # 값 채우기
npm run dev                  # http://localhost:3000
```

| 명령 | 하는 일 |
|---|---|
| `npm run admin` | 관리자 대시보드 (http://localhost:4000) |
| `npm run research -- "주제" …` | 주제별 시장 분석 리포트 + 비교표 |
| `npm run curriculum -- --topic <slug>` | 카테고리 커리큘럼 설계·레슨 추가 (`--lessons`, `--append`) |
| `npm run draft` | 달력에 배정된 레슨으로 초안 생성 (`--topic`, `--date`, `--subject`, `--model`) |
| `npm run new` | AI 없이 빈 템플릿 생성 (`--topic`, `--date`, `--title`) |
| `npm run check` | 모든 글의 형식·게시 조건 검사 (빌드 전에 자동 실행) |
| `npm run build` | 검사 후 정적 사이트 생성 (`out/`) |

`npm run draft`를 쓰려면 [Claude Code CLI](https://docs.claude.com/en/docs/claude-code)가 설치되고 로그인돼 있어야 합니다.
초안의 문체와 규칙은 `prompts/draft.md`만 고치면 바뀝니다.

## 카테고리·사이트 정보 바꾸기

카테고리와 순환 시작일은 대시보드 "카테고리" 탭(`content/topics.json`)에서 바꿉니다.
사이트 이름, 운영자 이름, 설명은 `src/blog.config.ts`에 있습니다.

## 글 형식

`content/posts/YYYY-MM-DD-주제.md`

```markdown
---
title: "검색에 걸리는 구체적인 제목"
date: 2026-10-01
topic: ai            # blog.config.ts의 slug
tags: [태그1, 태그2]
summary: "검색 결과에 보일 요약 (160자 이하)"
sources:
  - title: "참고한 자료"
    url: "https://..."
affiliate: false     # 제휴 링크가 있으면 true → 수수료 고지 문구 자동 표시
draft: false         # true면 게시되지 않음
---

## 오늘 공부한 것
## 핵심 정리
## 직접 해보기      ← 필수, 100자 이상 직접 작성
## 헷갈렸던 점
## 다음에 공부할 것
```

게시 조건 (`npm run check`):
- `draft: false`이고 게시일이 오늘이거나 지났을 것
- `<!-- TODO` 주석이 하나도 남아 있지 않을 것
- `## 직접 해보기` 섹션이 100자 이상, 본문이 800자 이상일 것
- 이미지는 설명(alt)이 있고, 파일이 실제로 있고, 외부 링크가 아닐 것

## 이미지

- **썸네일은 자동**입니다. 글마다 제목·주제 색으로 공유용 이미지(1200×630)가 만들어집니다.
- **본문 이미지는 직접 찍은 스크린샷이나 직접 만든 표·차트만** 넣습니다. 초안에 `<!-- 이미지 제안: ... -->` 메모가 있으면 참고하세요. 메모는 페이지에 보이지 않고 게시도 막지 않습니다.

```
public/images/posts/2026-10-01-ai/terminal.png
```
```markdown
![claude -p 실행 결과 터미널 화면](/images/posts/2026-10-01-ai/terminal.png)
```

- 인터넷 이미지 링크는 저작권 때문에 검사에서 막힙니다.
- 스크린샷은 1MB 이하로 줄여서 넣어주세요. 저장소와 페이지가 가벼워집니다.

## 배포 (Cloudflare Pages, 무료)

1. [Cloudflare Pages](https://pages.cloudflare.com)에서 이 GitHub 저장소 연결
2. 빌드 설정
   - Root directory: `blog`
   - Build command: `npm run build`
   - Build output directory: `out`
   - 환경변수: `NODE_VERSION=22`, `NEXT_PUBLIC_SITE_URL=https://프로젝트명.pages.dev`
3. [Google Search Console](https://search.google.com/search-console)에 사이트 등록 후 `sitemap.xml` 제출

> Vercel 무료(Hobby) 요금제는 비상업적 용도만 허용해서, 광고 수익을 낼 블로그에는 Cloudflare Pages를 씁니다.

## GitHub Actions 설정

| 워크플로 | 하는 일 | 필요한 시크릿 |
|---|---|---|
| `blog-daily-publish.yml` | 매일 00:05 KST 재빌드 → 예약 글 공개 | `CF_PAGES_DEPLOY_HOOK` (Cloudflare Pages → Settings → Builds → Deploy hooks) |
| `blog-ci.yml` | PR마다 글 검사·린트·빌드 | 없음 |
| `blog-daily-draft.yml` (선택) | 매일 06:00 KST 초안 PR 자동 생성 | `CLAUDE_CODE_OAUTH_TOKEN` (로컬에서 `claude setup-token`으로 발급, 없으면 빈 템플릿) |

- 초안 PR을 쓰려면 Settings → Actions → General → "Allow GitHub Actions to create and approve pull requests"를 켜세요.
- 예약 실행은 워크플로 파일이 기본 브랜치(main)에 있어야 동작합니다.

## 수익화 체크리스트

- [ ] 소개(`/about`)와 개인정보처리방침(`/privacy`)의 이름·연락처 수정
- [ ] 글 20~30편이 쌓이면 개인 도메인 연결 후 애드센스 신청 (`ads.txt`는 자동 생성)
- [ ] 제휴 링크(쿠팡파트너스 등)를 넣은 글은 `affiliate: true` (링크에는 `rel="sponsored"`가 자동으로 붙음)
- [ ] Search Console에서 색인 상태와 검색어를 주 1회 확인
