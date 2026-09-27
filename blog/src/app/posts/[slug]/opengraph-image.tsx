import { getTopic, SITE, TOPICS } from "@/blog.config";
import { OG_SIZE, renderOgImage } from "@/lib/og";
import { getPost, getStaticSlugs } from "@/lib/posts";

export const dynamicParams = false;
export const size = OG_SIZE;
export const contentType = "image/png";
export const alt = "글 썸네일";

export function generateStaticParams() {
  return getStaticSlugs();
}

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const post = getPost((await params).slug);
  const topic = (post && getTopic(post.topic)) || TOPICS[0];
  return renderOgImage({ title: post?.title ?? SITE.name, label: topic.name, color: topic.color });
}
