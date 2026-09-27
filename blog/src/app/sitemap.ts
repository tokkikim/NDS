import type { MetadataRoute } from "next";
import { SITE, TOPICS } from "@/blog.config";
import { getPublishedPosts } from "@/lib/posts";

export const dynamic = "force-static";

export default function sitemap(): MetadataRoute.Sitemap {
  const posts = getPublishedPosts();
  return [
    { url: SITE.url, lastModified: posts[0]?.date },
    ...TOPICS.map((t) => ({ url: `${SITE.url}/topics/${t.slug}` })),
    { url: `${SITE.url}/about` },
    ...posts.map((p) => ({ url: `${SITE.url}/posts/${p.slug}`, lastModified: p.updated ?? p.date })),
  ];
}
