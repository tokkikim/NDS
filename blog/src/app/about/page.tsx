import type { Metadata } from "next";
import Link from "next/link";
import { SITE, TOPICS } from "@/blog.config";

export const metadata: Metadata = { title: "소개", alternates: { canonical: "/about" } };

// 애드센스 심사와 독자 신뢰를 위해 운영자·운영 방식을 솔직하게 밝혀두는 페이지입니다.
// 본인 이야기로 자유롭게 고쳐 쓰세요.
export default function AboutPage() {
  return (
    <article className="prose">
      <h1>소개</h1>
      <p>
        <strong>{SITE.name}</strong>은 {SITE.author}가 세 가지 주제를 하루에 하나씩 공부하면서 남기는 기록입니다.
        전문가가 가르치는 블로그가 아니라, 배우는 사람이 직접 해보고 헷갈린 점까지 솔직하게 적는 블로그입니다.
      </p>

      <h2>공부하는 주제</h2>
      <ul>
        {TOPICS.map((t) => (
          <li key={t.slug}>
            <Link href={`/topics/${t.slug}`}>{t.name}</Link> — {t.description}
          </li>
        ))}
      </ul>

      <h2>글을 쓰는 방식</h2>
      <ul>
        <li>매일 한 주제씩 돌아가며 공부하고 기록합니다.</li>
        <li>
          자료 조사와 초안 정리에 AI 도구를 활용할 수 있지만, 모든 글은 직접 확인하고 &quot;직접 해보기&quot;
          섹션에 제 경험을 덧붙인 뒤에 게시합니다.
        </li>
        <li>참고한 자료는 글 하단에 출처를 남깁니다. 틀린 내용을 발견하시면 알려주세요.</li>
        <li>경제·재테크 글은 공부 기록이며 투자 권유가 아닙니다. 중요한 결정은 전문가와 상의하세요.</li>
      </ul>

      <h2>연락처</h2>
      <p>문의: your-email@example.com</p>
    </article>
  );
}
