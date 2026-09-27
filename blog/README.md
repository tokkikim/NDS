# 매일 한 걸음 공부노트

세 가지 주제를 하루에 하나씩 돌아가며 공부하고 기록하는, 직접 운영하는 블로그입니다.
AI는 **초안과 조사**를 맡고, **직접 해본 경험과 사실 확인**은 사람이 합니다.
검토하지 않은 글은 빌드 단계에서 막혀서 게시되지 않습니다.

## 하루 흐름

```
06:00  GitHub Actions가 오늘 주제의 초안 PR 생성 (AI 또는 빈 템플릿)
  ↓
나     PR에서 "직접 해보기" 작성 → 사실·출처 확인 → TODO 주석 삭제 → draft: false
  ↓
merge  Vercel이 자동 배포 (빌드 전에 글 검사 → 미완성 글이면 배포 실패)
```

미리 써둔 글은 `date`를 미래 날짜로 두면 그날 자동으로 공개됩니다(1시간 간격 갱신).

## 시작하기

```bash
cd blog
npm install
cp .env.example .env.local   # 값 채우기
npm run dev                  # http://localhost:3000
```

| 명령 | 하는 일 |
|---|---|
| `npm run new` | 오늘 날짜와 로테이션 주제로 빈 템플릿 생성 (`--topic`, `--date`, `--title`) |
| `npm run draft` | Claude로 오늘의 공부노트 초안 생성 (`--topic`, `--date`, `--subject`) |
| `npm run check` | 모든 글의 형식·게시 조건 검사 (빌드 전에 자동 실행) |
| `npm run build` | 검사 후 프로덕션 빌드 |

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
- `## 직접 해보기` 섹션이 100자 이상일 것, 본문 800자 이상일 것

## 배포 (Vercel)

1. Vercel에서 이 저장소를 가져오고 **Root Directory를 `blog`**로 지정
2. 환경변수 `NEXT_PUBLIC_SITE_URL` 설정 (애드센스 승인 후 `NEXT_PUBLIC_ADSENSE_CLIENT`, `NEXT_PUBLIC_ADSENSE_SLOT`)
3. 도메인 연결 → [Google Search Console](https://search.google.com/search-console)에 `sitemap.xml` 제출

## 자동 초안 PR 설정 (GitHub Actions)

`.github/workflows/blog-daily-draft.yml`

1. 저장소 Settings → Secrets → Actions에 `ANTHROPIC_API_KEY` 추가 (없으면 빈 템플릿으로 PR 생성)
2. Settings → Actions → General → "Allow GitHub Actions to create and approve pull requests" 켜기
3. 워크플로 파일이 기본 브랜치(main)에 있어야 예약 실행됩니다. Actions 탭에서 수동 실행도 됩니다.

> 봇이 만든 PR에는 Blog CI가 바로 돌지 않습니다. 내용을 수정해서 push하면 그때 검사가 실행되고, Vercel 빌드에서도 한 번 더 검사합니다.

## 수익화 체크리스트

- [ ] 소개(`/about`)와 개인정보처리방침(`/privacy`)의 이름·연락처 수정
- [ ] 글 20~30편이 쌓이면 애드센스 신청 (`ads.txt`는 자동 생성)
- [ ] 제휴 링크(쿠팡파트너스 등)를 넣은 글은 `affiliate: true` (링크에는 `rel="sponsored"`가 자동으로 붙음)
- [ ] Search Console에서 색인 상태와 검색어를 주 1회 확인
