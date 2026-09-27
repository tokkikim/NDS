import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTopic, SITE } from "@/blog.config";
import { AdSlot } from "@/components/AdSlot";
import { TopicBadge } from "@/components/PostCard";
import { formatKoreanDate } from "@/lib/dates";
import { renderMarkdown } from "@/lib/markdown";
import { getAdjacentPosts, getPost, getStaticSlugs } from "@/lib/posts";

// 정적 빌드: 빌드 시점에 게시된 글만 페이지로 만듭니다.
export const dynamicParams = false;

type Props = { params: Promise<{ slug: string }> };

export function generateStaticParams() {
  return getStaticSlugs();
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const post = getPost((await params).slug);
  if (!post) return {};
  return {
    title: post.title,
    description: post.summary,
    keywords: post.tags,
    alternates: { canonical: `/posts/${post.slug}` },
    openGraph: {
      type: "article",
      title: post.title,
      description: post.summary,
      publishedTime: post.date,
      modifiedTime: post.updated ?? post.date,
      tags: post.tags,
    },
  };
}

export default async function PostPage({ params }: Props) {
  const post = getPost((await params).slug);
  if (!post) notFound();

  const { newer, older } = getAdjacentPosts(post.slug);
  const topic = getTopic(post.topic);
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: post.title,
    description: post.summary,
    datePublished: post.date,
    dateModified: post.updated ?? post.date,
    author: { "@type": "Person", name: SITE.author },
    keywords: post.tags.join(", "),
    articleSection: topic?.name,
    mainEntityOfPage: `${SITE.url}/posts/${post.slug}`,
  };

  return (
    <article>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />

      <header className="post-header">
        <div className="meta">
          <Link href={`/topics/${post.topic}`}>
            <TopicBadge topic={post.topic} />
          </Link>
          <time dateTime={post.date}>{formatKoreanDate(post.date)}</time>
          {post.updated && <span>(수정 {formatKoreanDate(post.updated)})</span>}
          <span>· {post.readingMinutes}분</span>
        </div>
        <h1>{post.title}</h1>
      </header>

      {post.affiliate && (
        <p className="notice">
          이 글에는 제휴 링크가 포함되어 있으며, 링크를 통해 구매하시면 운영자가 일정액의 수수료를 받을 수 있습니다.
        </p>
      )}

      <div className="prose" dangerouslySetInnerHTML={{ __html: renderMarkdown(post.content) }} />

      {post.sources.length > 0 && (
        <section className="sources">
          <h2 className="section-title">참고 자료</h2>
          <ul>
            {post.sources.map((s) => (
              <li key={s.url}>
                <a href={s.url} target="_blank" rel="noopener">
                  {s.title}
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}

      {post.tags.length > 0 && (
        <div className="tags">
          {post.tags.map((t) => (
            <span key={t} className="tag">
              #{t}
            </span>
          ))}
        </div>
      )}

      <AdSlot />

      <nav className="pager">
        {newer && (
          <Link href={`/posts/${newer.slug}`}>
            <span>다음 기록</span>
            {newer.title}
          </Link>
        )}
        {older && (
          <Link href={`/posts/${older.slug}`} className="older">
            <span>이전 기록</span>
            {older.title}
          </Link>
        )}
      </nav>
    </article>
  );
}
