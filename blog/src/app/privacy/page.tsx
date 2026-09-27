import type { Metadata } from "next";
import { SITE } from "@/blog.config";

export const metadata: Metadata = { title: "개인정보처리방침", alternates: { canonical: "/privacy" } };

// 애드센스 등 광고를 게재하려면 쿠키 사용을 안내하는 개인정보처리방침이 필요합니다.
export default function PrivacyPage() {
  return (
    <article className="prose">
      <h1>개인정보처리방침</h1>
      <p>{SITE.name}(이하 &quot;블로그&quot;)는 방문자의 개인정보를 소중히 여기며, 다음과 같이 처리합니다.</p>

      <h2>1. 수집하는 정보</h2>
      <p>
        블로그는 회원가입이나 댓글 기능이 없으며, 방문자가 직접 입력하는 개인정보를 수집하지 않습니다. 다만 방문
        통계와 광고 제공을 위해 아래의 제3자 서비스가 쿠키 등을 통해 정보를 수집할 수 있습니다.
      </p>

      <h2>2. 광고 (Google 애드센스)</h2>
      <ul>
        <li>Google을 포함한 제3자 광고 사업자는 쿠키를 사용하여 사용자의 이전 방문 기록을 바탕으로 광고를 게재합니다.</li>
        <li>
          Google은 광고 쿠키를 사용하여 사용자가 이 블로그나 다른 웹사이트를 방문한 기록을 바탕으로 적절한 광고를
          제공할 수 있습니다.
        </li>
        <li>
          사용자는{" "}
          <a href="https://adssettings.google.com" target="_blank" rel="noopener">
            Google 광고 설정
          </a>
          에서 맞춤 광고를 사용 중지할 수 있습니다.
        </li>
      </ul>

      <h2>3. 제휴 링크</h2>
      <p>
        일부 글에는 제휴 마케팅 링크가 포함될 수 있으며, 이 경우 글 상단에 수수료 수령 사실을 표시합니다. 제휴 사이트로
        이동한 이후의 정보 처리는 해당 사이트의 방침을 따릅니다.
      </p>

      <h2>4. 문의</h2>
      <p>개인정보 관련 문의: your-email@example.com</p>

      <p>시행일: 2026년 10월 1일</p>
    </article>
  );
}
