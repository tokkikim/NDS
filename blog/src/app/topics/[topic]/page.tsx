import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTopic, TOPICS } from "@/blog.config";
import { PostCard } from "@/components/PostCard";
import { getPostsByTopic } from "@/lib/posts";

export const revalidate = 3600;
export const dynamicParams = false;

type Props = { params: Promise<{ topic: string }> };

export function generateStaticParams() {
  return TOPICS.map((t) => ({ topic: t.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const topic = getTopic((await params).topic);
  if (!topic) return {};
  return {
    title: topic.name,
    description: topic.description,
    alternates: { canonical: `/topics/${topic.slug}` },
  };
}

export default async function TopicPage({ params }: Props) {
  const topic = getTopic((await params).topic);
  if (!topic) notFound();
  const posts = getPostsByTopic(topic.slug);

  return (
    <>
      <section className="hero">
        <h1 style={{ color: topic.color }}>{topic.name}</h1>
        <p>
          {topic.description} · 지금까지 {posts.length}개의 기록
        </p>
      </section>
      {posts.length === 0 ? (
        <p className="notice">아직 이 주제의 글이 없습니다.</p>
      ) : (
        <ul className="post-list">
          {posts.map((p) => (
            <PostCard key={p.slug} post={p} />
          ))}
        </ul>
      )}
    </>
  );
}
