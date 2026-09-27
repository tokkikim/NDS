import Link from "next/link";
import { SITE, TOPICS } from "@/blog.config";
import { PostCard } from "@/components/PostCard";
import { StudyCalendar } from "@/components/StudyCalendar";
import { getPublishedPosts, getStreak } from "@/lib/posts";

// 예약한 글이 게시일이 되면 나타나도록 1시간마다 다시 생성합니다.
export const revalidate = 3600;

export default function Home() {
  const posts = getPublishedPosts();
  const streak = getStreak(posts);

  return (
    <>
      <section className="hero">
        <h1>{SITE.name}</h1>
        <p>{SITE.description}</p>
      </section>

      <div className="stats">
        <div className="stat">
          <b>{streak}일</b>
          <span>연속 공부</span>
        </div>
        <div className="stat">
          <b>{posts.length}개</b>
          <span>누적 기록</span>
        </div>
        <div className="stat">
          <b>{TOPICS.length}개</b>
          <span>공부 주제</span>
        </div>
      </div>

      <StudyCalendar posts={posts} />

      <h2 className="section-title">공부 주제</h2>
      <div className="topic-grid">
        {TOPICS.map((t) => (
          <Link key={t.slug} href={`/topics/${t.slug}`} className="topic-card" style={{ borderLeftColor: t.color }}>
            <b>{t.name}</b>
            <span>{t.description}</span>
          </Link>
        ))}
      </div>

      <h2 className="section-title">최근 기록</h2>
      {posts.length === 0 ? (
        <p className="notice">아직 게시된 글이 없습니다.</p>
      ) : (
        <ul className="post-list">
          {posts.slice(0, 20).map((p) => (
            <PostCard key={p.slug} post={p} />
          ))}
        </ul>
      )}
    </>
  );
}
