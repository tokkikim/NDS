import { SITE } from "@/blog.config";
import { getPublishedPosts } from "@/lib/posts";

export const revalidate = 3600;

function escapeXml(s: string): string {
  return s.replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[c]!);
}

export function GET() {
  const items = getPublishedPosts()
    .slice(0, 30)
    .map((p) => {
      const url = `${SITE.url}/posts/${p.slug}`;
      return `<item><title>${escapeXml(p.title)}</title><link>${url}</link><guid>${url}</guid><pubDate>${new Date(`${p.date}T09:00:00+09:00`).toUTCString()}</pubDate><description>${escapeXml(p.summary)}</description></item>`;
    })
    .join("");

  const xml = `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>${escapeXml(SITE.name)}</title><link>${SITE.url}</link><description>${escapeXml(SITE.description)}</description><language>ko</language>${items}</channel></rss>`;
  return new Response(xml, { headers: { "Content-Type": "application/rss+xml; charset=utf-8" } });
}
