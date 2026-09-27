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

## 하루 흐름

```
① 초안   npm run draft        Claude CLI가 웹에서 조사·출처 확인 후 초안 작성 (draft: true)
② 검토   직접 해보기 작성 + 스크린샷(선택) + 사실 확인 + TODO 삭제 + draft: false
③ 게시   git push             Cloudflare Pages가 검사 → 빌드 → 배포 (미완성 글이면 배포 실패)
④ 예약   매일 00:05 KST        날짜가 된 예약 글이 자동 공개 (GitHub Actions가 재빌드 요청)
```

## 시작하기

```bash
cd blog
npm install
cp .env.example .env.local   # 값 채우기
npm run dev                  # http://localhost:3000
```

| 명령 | 하는 일 |
|---|---|
| `npm run draft` | Claude CLI로 오늘 주제의 초안 생성 (`--topic`, `--date`, `--subject`, `--model`) |
| `npm run new` | AI 없이 빈 템플릿 생성 (`--topic`, `--date`, `--title`) |
| `npm run check` | 모든 글의 형식·게시 조건 검사 (빌드 전에 자동 실행) |
| `npm run build` | 검사 후 정적 사이트 생성 (`out/`) |

`npm run draft`를 쓰려면 [Claude Code CLI](https://docs.claude.com/en/docs/claude-code)가 설치되고 로그인돼 있어야 합니다.
초안의 문체와 규칙은 `prompts/draft.md`만 고치면 바뀝니다.

## 주제 바꾸기

`src/blog.config.ts`의 `TOPICS`를 고치면 됩니다. 로테이션은 `SITE.rotationStart`
날짜에 `TOPICS[0]`이 오도록 하루씩 순환합니다. 사이트 이름, 운영자 이름도 같은 파일에 있습니다.

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
