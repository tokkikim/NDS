import Link from "next/link";
import { getTopic } from "@/blog.config";
import { formatKoreanDate } from "@/lib/dates";
import type { Post } from "@/lib/posts";

export function TopicBadge({ topic }: { topic: string }) {
  const t = getTopic(topic);
  if (!t) return null;
  return (
    <span className="badge" style={{ background: t.color }}>
      {t.name}
    </span>
  );
}

export function PostCard({ post }: { post: Post }) {
  return (
    <li>
      <Link href={`/posts/${post.slug}`} className="post-card">
        <div className="meta">
          <TopicBadge topic={post.topic} />
          <time dateTime={post.date}>{formatKoreanDate(post.date)}</time>
          <span>· {post.readingMinutes}분</span>
        </div>
        <h3>{post.title}</h3>
        <p>{post.summary}</p>
      </Link>
    </li>
  );
}
