import { SITE, TOPICS } from "@/blog.config";
import { OG_SIZE, renderOgImage } from "@/lib/og";

export const dynamic = "force-static";
export const size = OG_SIZE;
export const contentType = "image/png";
export const alt = SITE.name;

export default function Image() {
  return renderOgImage({
    title: SITE.description,
    label: TOPICS.map((t) => t.name).join(" · "),
    color: TOPICS[0].color,
  });
}
