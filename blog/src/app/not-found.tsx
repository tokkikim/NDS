import Link from "next/link";

export default function NotFound() {
  return (
    <section className="hero">
      <h1>페이지를 찾을 수 없습니다</h1>
      <p>
        주소가 바뀌었거나 아직 게시되지 않은 글입니다. <Link href="/">홈으로 돌아가기</Link>
      </p>
    </section>
  );
}
